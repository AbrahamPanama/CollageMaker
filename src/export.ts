// Shared export pipeline used by both Shape and Grid views.
//
// Callers rasterize their Konva stage to a data URL, then hand that off to
// `downloadExport` which dispatches per format. `hooks` lets a caller bolt on
// extra content for the formats that support it — e.g. a true vector path
// overlay for SVG/PDF, while PNG/JPG just get the bitmap.

import type { jsPDF as JsPdf } from 'jspdf';
import { isTauri } from '@tauri-apps/api/core';
import type { ExportFormat } from './components/ExportModal';

export type ExportMime = 'image/png' | 'image/jpeg';

export type ExportHooks = {
  /** Markup inserted inside the wrapping <svg>, after the bitmap <image>. */
  svgExtras?: string;
  /** Called after the bitmap is added to the PDF. Draw additional vector content. */
  pdfOverlay?: (pdf: JsPdf) => void;
};

export type DownloadExportOptions = {
  format: ExportFormat;
  dataUrl: string;
  mime: ExportMime;
  width: number;
  height: number;
  physicalWidthMm?: number;
  physicalHeightMm?: number;
  dpi?: number;
  baseName: string;     // filename stem; format extension is appended
  hooks?: ExportHooks;
  preventPureWhite?: boolean;
};

type ExportPayload = {
  bytes: Uint8Array;
  filename: string;
  mime: string;
  extension: ExportFormat;
};

export async function saveExportBytes(
  bytes: Uint8Array,
  filename: string,
  mime: string,
  extension: ExportFormat
): Promise<boolean> {
  return saveExportPayload({ bytes, filename, mime, extension });
}

export async function downloadExport(opts: DownloadExportOptions): Promise<boolean> {
  const {
    format,
    dataUrl,
    mime,
    width,
    height,
    physicalWidthMm,
    physicalHeightMm,
    dpi,
    baseName,
    hooks,
    preventPureWhite = false,
  } = opts;
  const outputMime: ExportMime = format === 'jpg' ? 'image/jpeg' : mime;
  const filename = `${baseName}.${format}`;
  const physicalSize =
    physicalWidthMm && physicalHeightMm && physicalWidthMm > 0 && physicalHeightMm > 0
      ? { widthMm: physicalWidthMm, heightMm: physicalHeightMm }
      : null;
  const exportDpi = dpi && dpi > 0 ? dpi : computeDpi(width, physicalSize?.widthMm);
  let preparedImageData: ImageData | null = null;
  let preparedDataUrl: string | null = null;

  const getPreparedImageData = async () => {
    if (!preparedImageData) {
      preparedImageData = await dataUrlToImageData(dataUrl, width, height);
      if (preventPureWhite) preventPureWhiteInImageData(preparedImageData);
    }
    return preparedImageData;
  };

  const getPreparedDataUrl = async () => {
    if (!preventPureWhite) return dataUrl;
    if (!preparedDataUrl) {
      preparedDataUrl = imageDataToDataUrl(
        await getPreparedImageData(),
        outputMime,
        outputMime === 'image/jpeg' ? 0.92 : 1
      );
    }
    return preparedDataUrl;
  };

  if (format === 'png' || format === 'jpg') {
    const bytes = dataUrlToBytes(await getPreparedDataUrl());
    return saveExportPayload({
      bytes:
        physicalSize && exportDpi
          ? applyRasterDensityMetadata(bytes, outputMime, exportDpi)
          : bytes,
      filename,
      mime: outputMime,
      extension: format,
    });
  }

  if (format === 'tiff') {
    const imageData = await getPreparedImageData();
    return saveExportPayload({
      bytes: encodeRgbaTiff(imageData, exportDpi ?? 72),
      filename,
      mime: 'image/tiff',
      extension: 'tiff',
    });
  }

  if (format === 'svg') {
    const exportDataUrl = await getPreparedDataUrl();
    const physicalAttrs = physicalSize
      ? ` width="${fmtMm(physicalSize.widthMm)}mm" height="${fmtMm(physicalSize.heightMm)}mm"`
      : '';
    const svg =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<svg xmlns="http://www.w3.org/2000/svg"${physicalAttrs} viewBox="0 0 ${width} ${height}">` +
      `<image href="${exportDataUrl}" width="${width}" height="${height}"/>` +
      (hooks?.svgExtras ?? '') +
      `</svg>`;
    return saveExportPayload({
      bytes: new TextEncoder().encode(svg),
      filename,
      mime: 'image/svg+xml',
      extension: 'svg',
    });
  }

  if (format === 'pdf') {
    const exportDataUrl = await getPreparedDataUrl();
    const { default: jsPDF } = await import('jspdf');
    const pdfWidth = physicalSize?.widthMm ?? width;
    const pdfHeight = physicalSize?.heightMm ?? height;
    const pdf = new jsPDF({
      unit: physicalSize ? 'mm' : 'px',
      format: [pdfWidth, pdfHeight],
      orientation: pdfWidth >= pdfHeight ? 'landscape' : 'portrait',
      hotfixes: physicalSize ? undefined : ['px_scaling'],
    });
    pdf.addImage(
      exportDataUrl,
      outputMime === 'image/jpeg' ? 'JPEG' : 'PNG',
      0,
      0,
      pdfWidth,
      pdfHeight,
      undefined,
      'FAST'
    );
    hooks?.pdfOverlay?.(pdf);
    return saveExportPayload({
      bytes: new Uint8Array(pdf.output('arraybuffer')),
      filename,
      mime: 'application/pdf',
      extension: 'pdf',
    });
  }

  return false;
}

// ---------- Save helpers ----------

/**
 * Save arbitrary binary bytes (e.g. a .zip bundle) with the same native-dialog /
 * browser-download behaviour as the format exporters, but without the
 * `ExportFormat` constraint. The file extension is taken from `filename`.
 */
export async function saveBinaryArtifact(
  bytes: Uint8Array,
  filename: string,
  mime: string
): Promise<boolean> {
  if (isTauri()) {
    const [{ save }, { writeFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const ext = (filename.split('.').pop() ?? 'bin').toLowerCase();
    const selectedPath = await save({
      title: 'Export',
      defaultPath: filename,
      canCreateDirectories: true,
      filters: [{ name: `${ext.toUpperCase()} file`, extensions: [ext] }],
    });
    if (!selectedPath) return false;
    const finalPath = /\.[^./\\]+$/.test(selectedPath) ? selectedPath : `${selectedPath}.${ext}`;
    await writeFile(finalPath, bytes);
    return true;
  }

  downloadBlob(bytes, mime, filename);
  return true;
}

async function saveExportPayload(payload: ExportPayload): Promise<boolean> {
  if (isTauri()) {
    const [{ save }, { writeFile }] = await Promise.all([
      import('@tauri-apps/plugin-dialog'),
      import('@tauri-apps/plugin-fs'),
    ]);
    const selectedPath = await save({
      title: 'Export collage',
      defaultPath: payload.filename,
      canCreateDirectories: true,
      filters: [
        {
          name: `${payload.extension.toUpperCase()} file`,
          extensions: [payload.extension],
        },
      ],
    });
    if (!selectedPath) return false;
    await writeFile(ensureExtension(selectedPath, payload.extension), payload.bytes);
    return true;
  }

  downloadBlob(payload.bytes, payload.mime, payload.filename);
  return true;
}

function ensureExtension(path: string, extension: ExportFormat): string {
  const lastSegment = path.split(/[\\/]/).pop() ?? path;
  if (/\.[^./\\]+$/.test(lastSegment)) return path;
  return `${path}.${extension}`;
}

function dataUrlToBytes(url: string): Uint8Array {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/i.exec(url);
  if (!match) throw new Error('Invalid export data URL');
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? '';
  const text = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

function dataUrlToImageData(url: string, width: number, height: number): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(width));
      canvas.height = Math.max(1, Math.round(height));
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) {
        reject(new Error('Unable to create TIFF export canvas'));
        return;
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
    };
    image.onerror = () => reject(new Error('Unable to decode export bitmap for TIFF'));
    image.src = url;
  });
}

function imageDataToDataUrl(imageData: ImageData, mime: ExportMime, quality: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, imageData.width);
  canvas.height = Math.max(1, imageData.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Unable to create export normalization canvas');
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL(mime, quality);
}

export function preventPureWhiteInImageData(
  imageData: Pick<ImageData, 'data'>,
  replacement = 254
): boolean {
  const value = Math.max(0, Math.min(254, Math.round(replacement)));
  const { data } = imageData;
  let changed = false;
  for (let index = 0; index + 3 < data.length; index += 4) {
    if (
      data[index] === 255 &&
      data[index + 1] === 255 &&
      data[index + 2] === 255 &&
      data[index + 3] > 0
    ) {
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      changed = true;
    }
  }
  return changed;
}

type TiffEntry = {
  tag: number;
  type: 3 | 4 | 5;
  values: number[];
  valueOffset?: number;
  valueBytes?: Uint8Array;
};

export function encodeRgbaTiff(imageData: ImageData, dpi: number): Uint8Array {
  const { width, height, data } = imageData;
  const pixelBytes = new Uint8Array(data.length);
  pixelBytes.set(data);
  const safeDpi = Math.max(1, Math.round(dpi));

  const entries: TiffEntry[] = [
    { tag: 256, type: 4, values: [width] },
    { tag: 257, type: 4, values: [height] },
    { tag: 258, type: 3, values: [8, 8, 8, 8] },
    { tag: 259, type: 3, values: [1] },
    { tag: 262, type: 3, values: [2] },
    { tag: 273, type: 4, values: [0] },
    { tag: 277, type: 3, values: [4] },
    { tag: 278, type: 4, values: [height] },
    { tag: 279, type: 4, values: [pixelBytes.byteLength] },
    { tag: 282, type: 5, values: [safeDpi, 1] },
    { tag: 283, type: 5, values: [safeDpi, 1] },
    { tag: 284, type: 3, values: [1] },
    { tag: 296, type: 3, values: [2] },
    { tag: 338, type: 3, values: [2] },
  ];

  const ifdOffset = 8;
  const ifdBytes = 2 + entries.length * 12 + 4;
  let valueOffset = ifdOffset + ifdBytes;

  for (const entry of entries) {
    const bytes = encodeTiffValues(entry);
    if (bytes.byteLength > 4) {
      entry.valueBytes = bytes;
      entry.valueOffset = valueOffset;
      valueOffset += bytes.byteLength + (bytes.byteLength % 2);
    }
  }

  const pixelOffset = valueOffset;
  const stripOffset = entries.find((entry) => entry.tag === 273);
  if (stripOffset) stripOffset.values = [pixelOffset];

  const output = new Uint8Array(pixelOffset + pixelBytes.byteLength);
  const view = new DataView(output.buffer);
  output[0] = 0x49;
  output[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entries.length, true);

  let cursor = ifdOffset + 2;
  for (const entry of entries) {
    view.setUint16(cursor, entry.tag, true);
    view.setUint16(cursor + 2, entry.type, true);
    view.setUint32(cursor + 4, tiffValueCount(entry), true);
    if (entry.valueBytes && entry.valueOffset !== undefined) {
      view.setUint32(cursor + 8, entry.valueOffset, true);
      output.set(entry.valueBytes, entry.valueOffset);
    } else {
      output.set(encodeTiffValues(entry), cursor + 8);
    }
    cursor += 12;
  }
  view.setUint32(cursor, 0, true);
  output.set(pixelBytes, pixelOffset);
  return output;
}

function encodeTiffValues(entry: TiffEntry): Uint8Array {
  const bytes = new Uint8Array(tiffValueCount(entry) * tiffTypeSize(entry.type));
  const view = new DataView(bytes.buffer);
  if (entry.type === 3) {
    entry.values.forEach((value, index) => view.setUint16(index * 2, value, true));
  } else if (entry.type === 4) {
    entry.values.forEach((value, index) => view.setUint32(index * 4, value, true));
  } else {
    for (let index = 0; index < entry.values.length; index += 2) {
      const offset = (index / 2) * 8;
      view.setUint32(offset, entry.values[index], true);
      view.setUint32(offset + 4, entry.values[index + 1] ?? 1, true);
    }
  }
  return bytes;
}

function tiffValueCount(entry: TiffEntry): number {
  return entry.type === 5 ? Math.floor(entry.values.length / 2) : entry.values.length;
}

function tiffTypeSize(type: TiffEntry['type']): number {
  return type === 3 ? 2 : type === 4 ? 4 : 8;
}

function computeDpi(pixelWidth: number, physicalWidthMm?: number): number | undefined {
  if (!physicalWidthMm || physicalWidthMm <= 0) return undefined;
  return pixelWidth / (physicalWidthMm / 25.4);
}

function applyRasterDensityMetadata(bytes: Uint8Array, mime: ExportMime, dpi: number): Uint8Array {
  if (mime === 'image/png') return addPngDensity(bytes, dpi);
  if (mime === 'image/jpeg') return addJpegDensity(bytes, dpi);
  return bytes;
}

function addPngDensity(bytes: Uint8Array, dpi: number): Uint8Array {
  if (!isPng(bytes)) return bytes;
  const ppm = Math.max(1, Math.round(dpi / 0.0254));
  const chunkData = new Uint8Array(9);
  const view = new DataView(chunkData.buffer);
  view.setUint32(0, ppm, false);
  view.setUint32(4, ppm, false);
  chunkData[8] = 1;
  const chunk = makePngChunk('pHYs', chunkData);
  const existingPhys = findPngChunk(bytes, 'pHYs');
  if (existingPhys) {
    const output = new Uint8Array(bytes.byteLength - (existingPhys.end - existingPhys.start) + chunk.byteLength);
    output.set(bytes.slice(0, existingPhys.start), 0);
    output.set(chunk, existingPhys.start);
    output.set(bytes.slice(existingPhys.end), existingPhys.start + chunk.byteLength);
    return output;
  }
  const ihdr = findPngChunk(bytes, 'IHDR');
  if (!ihdr) return bytes;
  const output = new Uint8Array(bytes.byteLength + chunk.byteLength);
  output.set(bytes.slice(0, ihdr.end), 0);
  output.set(chunk, ihdr.end);
  output.set(bytes.slice(ihdr.end), ihdr.end + chunk.byteLength);
  return output;
}

function addJpegDensity(bytes: Uint8Array, dpi: number): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const safeDpi = Math.max(1, Math.min(65535, Math.round(dpi)));
  let offset = 2;
  while (offset + 4 <= bytes.byteLength && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break;
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.byteLength) break;
    if (marker === 0xe0 && isJfifSegment(bytes, offset)) {
      const output = new Uint8Array(bytes);
      output[offset + 11] = 1;
      output[offset + 12] = (safeDpi >> 8) & 0xff;
      output[offset + 13] = safeDpi & 0xff;
      output[offset + 14] = (safeDpi >> 8) & 0xff;
      output[offset + 15] = safeDpi & 0xff;
      return output;
    }
    offset += 2 + length;
  }

  const jfif = makeJfifSegment(safeDpi);
  const output = new Uint8Array(bytes.byteLength + jfif.byteLength);
  output.set(bytes.slice(0, 2), 0);
  output.set(jfif, 2);
  output.set(bytes.slice(2), 2 + jfif.byteLength);
  return output;
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length > 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  );
}

function findPngChunk(bytes: Uint8Array, type: string): { start: number; end: number } | null {
  const typeBytes = asciiBytes(type);
  let offset = 8;
  while (offset + 12 <= bytes.byteLength) {
    const length =
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3];
    const end = offset + 12 + length;
    if (length < 0 || end > bytes.byteLength) return null;
    if (
      bytes[offset + 4] === typeBytes[0] &&
      bytes[offset + 5] === typeBytes[1] &&
      bytes[offset + 6] === typeBytes[2] &&
      bytes[offset + 7] === typeBytes[3]
    ) {
      return { start: offset, end };
    }
    offset = end;
  }
  return null;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = asciiBytes(type);
  const chunk = new Uint8Array(12 + data.byteLength);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength, false);
  chunk.set(typeBytes, 4);
  chunk.set(data, 8);
  view.setUint32(8 + data.byteLength, crc32(chunk.slice(4, 8 + data.byteLength)), false);
  return chunk;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function isJfifSegment(bytes: Uint8Array, offset: number): boolean {
  return (
    bytes[offset + 4] === 0x4a &&
    bytes[offset + 5] === 0x46 &&
    bytes[offset + 6] === 0x49 &&
    bytes[offset + 7] === 0x46 &&
    bytes[offset + 8] === 0x00
  );
}

function makeJfifSegment(dpi: number): Uint8Array {
  const segment = new Uint8Array(18);
  segment[0] = 0xff;
  segment[1] = 0xe0;
  segment[2] = 0x00;
  segment[3] = 0x10;
  segment.set(asciiBytes('JFIF'), 4);
  segment[8] = 0x00;
  segment[9] = 0x01;
  segment[10] = 0x01;
  segment[11] = 0x01;
  segment[12] = (dpi >> 8) & 0xff;
  segment[13] = dpi & 0xff;
  segment[14] = (dpi >> 8) & 0xff;
  segment[15] = dpi & 0xff;
  segment[16] = 0x00;
  segment[17] = 0x00;
  return segment;
}

function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index++) bytes[index] = value.charCodeAt(index);
  return bytes;
}

function fmtMm(value: number): string {
  return String(Number(value.toFixed(4)));
}

function downloadBlob(bytes: Uint8Array, mime: string, filename: string): void {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const blobUrl = URL.createObjectURL(new Blob([buffer], { type: mime }));
  try {
    downloadDataUrl(blobUrl, filename);
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  }
}

// ---------- DOM helper ----------

export function downloadDataUrl(url: string, filename: string): void {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// ---------- Color helpers ----------

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}

/**
 * Returns the WCAG relative luminance of an `#rrggbb` color in [0, 1].
 * Use to pick legible foreground text against an arbitrary background.
 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  const channel = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Picks `#fff` for dark backgrounds and `#222` for light ones. */
export function pickLegibleText(hex: string, darkText = '#222', lightText = '#fff'): string {
  return relativeLuminance(hex) < 0.5 ? lightText : darkText;
}
