// Shared export pipeline used by both Shape and Grid views.
//
// Callers rasterize their Konva stage to a data URL, then hand that off to
// `downloadExport` which dispatches per format. `hooks` lets a caller bolt on
// extra content for the formats that support it — e.g. a true vector path
// overlay for SVG/PDF, while PNG/JPG just get the bitmap.

import type { jsPDF as JsPdf } from 'jspdf';
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
  baseName: string;     // filename stem; format extension is appended
  hooks?: ExportHooks;
};

export async function downloadExport(opts: DownloadExportOptions): Promise<void> {
  const { format, dataUrl, mime, width, height, baseName, hooks } = opts;
  const filename = `${baseName}.${format}`;

  if (format === 'png' || format === 'jpg') {
    downloadDataUrl(dataUrl, filename);
    return;
  }

  if (format === 'svg') {
    const svg =
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">` +
      `<image href="${dataUrl}" width="${width}" height="${height}"/>` +
      (hooks?.svgExtras ?? '') +
      `</svg>`;
    downloadDataUrl(
      'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
      filename
    );
    return;
  }

  if (format === 'pdf') {
    const { default: jsPDF } = await import('jspdf');
    const pdf = new jsPDF({
      unit: 'px',
      format: [width, height],
      orientation: width >= height ? 'landscape' : 'portrait',
      hotfixes: ['px_scaling'],
    });
    pdf.addImage(
      dataUrl,
      mime === 'image/jpeg' ? 'JPEG' : 'PNG',
      0,
      0,
      width,
      height,
      undefined,
      'FAST'
    );
    hooks?.pdfOverlay?.(pdf);
    pdf.save(filename);
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
