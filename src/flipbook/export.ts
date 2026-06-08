import type { jsPDF as JsPdf } from 'jspdf';
import { saveExportBytes } from '../export';
import { computePhotoPlacement } from '../photoFraming';
import type { Photo } from '../types';
import {
  FLIPBOOK_BLADE_LOCAL_COMMANDS,
  FLIPBOOK_BLADE_VIEWBOX,
  getFlipbookBladeBleedLoops,
  type FlipbookBladePathCommand,
} from './blade';
import { formatFrame, type BladeHalf, type BladeSide, type FlipbookBlade, type PrintPage } from './logic';

const MM_PER_INCH = 25.4;
const CUT_STROKE_MM = 0.2;
const FALLBACK_DPI = 300;

export type FlipbookExportFrame = {
  frame: number;
  photo: Photo | null;
  repeated?: boolean;
};

export type FlipbookExportLayout = {
  columns: number;
  rows: number;
  bladesPerPage: number;
  slotWidthMm: number;
  slotHeightMm: number;
  gapMm: number;
  marginMm: number;
};

export type SaveFlipbookPdfOptions = {
  frames: FlipbookExportFrame[];
  printPages: PrintPage<FlipbookBlade>[];
  pageWidthMm: number;
  pageHeightMm: number;
  bleedMm: number;
  printLayout: FlipbookExportLayout;
  autoFrame: boolean;
  closeUpTightness: number;
  mirrorBackArtworkX?: boolean;
  dpi?: number;
  baseName: string;
};

type SlotGeometry = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type ImageCache = Map<string, Promise<HTMLImageElement>>;

export async function saveFlipbookPdf(options: SaveFlipbookPdfOptions): Promise<boolean> {
  const { default: jsPDF } = await import('jspdf');
  const orientation = options.pageWidthMm >= options.pageHeightMm ? 'landscape' : 'portrait';
  const pdf = new jsPDF({
    unit: 'mm',
    format: [options.pageWidthMm, options.pageHeightMm],
    orientation,
  });

  const imageCache: ImageCache = new Map();
  let firstPage = true;
  for (const page of options.printPages) {
    await renderPdfPage(pdf, options, page, 'front', firstPage, imageCache);
    firstPage = false;
    await renderPdfPage(pdf, options, page, 'back', false, imageCache);
  }

  return saveExportBytes(
    new Uint8Array(pdf.output('arraybuffer')),
    `${options.baseName}.pdf`,
    'application/pdf',
    'pdf'
  );
}

async function renderPdfPage(
  pdf: JsPdf,
  options: SaveFlipbookPdfOptions,
  page: PrintPage<FlipbookBlade>,
  side: BladeSide,
  firstPage: boolean,
  imageCache: ImageCache
) {
  if (!firstPage) {
    pdf.addPage(
      [options.pageWidthMm, options.pageHeightMm],
      options.pageWidthMm >= options.pageHeightMm ? 'landscape' : 'portrait'
    );
  }

  pdf.setFillColor(255, 255, 255);
  pdf.rect(0, 0, options.pageWidthMm, options.pageHeightMm, 'F');

  const slots = side === 'front' ? page.frontSlots : page.backSlots;
  const pageLayout = {
    ...options.printLayout,
    rows: Math.max(1, Math.ceil(slots.length / options.printLayout.columns)),
  };

  for (const slot of slots) {
    if (!slot.item) continue;
    const frameIndex = side === 'front' ? slot.item.frontFrame : slot.item.backFrame;
    const half: BladeHalf = side === 'front' ? 'A' : 'D';
    const frame = options.frames[frameIndex];
    const geometry = getPrintSlotGeometry(slot.slot, options.pageWidthMm, options.pageHeightMm, pageLayout);
    const image = await renderBladeRaster({
      frame,
      blade: slot.item,
      half,
      side,
      bleedMm: options.bleedMm,
      autoFrame: options.autoFrame,
      closeUpTightness: options.closeUpTightness,
      mirrorArtworkX: side === 'back' && Boolean(options.mirrorBackArtworkX),
      dpi: options.dpi ?? FALLBACK_DPI,
      imageCache,
    });

    pdf.addImage(image, 'PNG', geometry.x, geometry.y, geometry.w, geometry.h, undefined, 'FAST');
    drawBladeContour(pdf, geometry.x + options.bleedMm, geometry.y + options.bleedMm);
  }
}

function getPrintSlotGeometry(
  slot: number,
  pageWidthMm: number,
  pageHeightMm: number,
  layout: FlipbookExportLayout
): SlotGeometry {
  const row = Math.floor(slot / layout.columns);
  const col = slot % layout.columns;
  const totalWidthMm = layout.columns * layout.slotWidthMm + (layout.columns - 1) * layout.gapMm;
  const totalHeightMm = layout.rows * layout.slotHeightMm + (layout.rows - 1) * layout.gapMm;
  const originXMm = (pageWidthMm - totalWidthMm) / 2;
  const originYMm = (pageHeightMm - totalHeightMm) / 2;

  return {
    x: originXMm + col * (layout.slotWidthMm + layout.gapMm),
    y: originYMm + row * (layout.slotHeightMm + layout.gapMm),
    w: layout.slotWidthMm,
    h: layout.slotHeightMm,
  };
}

async function renderBladeRaster({
  frame,
  blade,
  half,
  side,
  bleedMm,
  autoFrame,
  closeUpTightness,
  mirrorArtworkX,
  dpi,
  imageCache,
}: {
  frame: FlipbookExportFrame;
  blade: FlipbookBlade;
  half: BladeHalf;
  side: BladeSide;
  bleedMm: number;
  autoFrame: boolean;
  closeUpTightness: number;
  mirrorArtworkX: boolean;
  dpi: number;
  imageCache: ImageCache;
}) {
  const viewBox = FLIPBOOK_BLADE_VIEWBOX;
  const bleed = Math.max(0, bleedMm);
  const slotW = viewBox.w + bleed * 2;
  const slotH = viewBox.h + bleed * 2;
  const pxW = Math.max(1, Math.round((slotW / MM_PER_INCH) * dpi));
  const pxH = Math.max(1, Math.round((slotH / MM_PER_INCH) * dpi));
  const imageFrameW = viewBox.w + bleed * 2;
  const imageFrameH = viewBox.h * 2 + bleed * 2;
  const imageY = side === 'back'
    ? half === 'D'
      ? viewBox.y
      : viewBox.y - viewBox.h
    : half === 'A'
      ? viewBox.y
      : viewBox.y - viewBox.h;
  const imageCenterY = imageY + viewBox.h;
  const imageFrameX = viewBox.x - bleed;
  const imageFrameY = imageY - bleed;
  const imageCenterX = viewBox.x + viewBox.w / 2;
  const bladeId = `B${formatFrame(blade.index)}-${side === 'front' ? 'F' : 'B'}`;
  const partLabel = `${formatFrame(frame.frame)}${half}`;
  const placement = frame.photo
    ? computePhotoPlacement(frame.photo, imageFrameW, imageFrameH, {
        closeUp: autoFrame,
        closeUpTightness,
      })
    : null;
  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available');

  const pxPerMm = pxW / slotW;
  const slotOriginX = viewBox.x - bleed;
  const slotOriginY = viewBox.y - bleed;
  const artworkCenterX = (imageCenterX - slotOriginX) * pxPerMm;
  const artworkCenterY = (imageCenterY - slotOriginY) * pxPerMm;
  const imageX = (imageFrameX + (placement?.x ?? 0) - slotOriginX) * pxPerMm;
  const imageYLocal = (imageFrameY + (placement?.y ?? 0) - slotOriginY) * pxPerMm;

  ctx.save();
  ctx.clip(buildBladeClipPath(pxPerMm, bleed));
  if (frame.photo && placement) {
    const image = await loadCachedImage(frame.photo.src, imageCache).catch(() => null);
    if (image) {
      ctx.save();
      applyArtworkTransform(ctx, side, mirrorArtworkX, artworkCenterX, artworkCenterY);
      ctx.drawImage(image, imageX, imageYLocal, placement.w * pxPerMm, placement.h * pxPerMm);
      ctx.restore();
    } else {
      fillBladeFallback(ctx, pxW, pxH, half);
    }
  } else {
    fillBladeFallback(ctx, pxW, pxH, half);
  }
  ctx.restore();

  drawBladeRasterLabels(ctx, pxPerMm, bleed, partLabel, bladeId);

  return canvas.toDataURL('image/png');
}

function applyArtworkTransform(
  ctx: CanvasRenderingContext2D,
  side: BladeSide,
  mirrorArtworkX: boolean,
  imageCenterX: number,
  imageCenterY: number
) {
  if (side === 'back' && mirrorArtworkX) {
    ctx.translate(imageCenterX * 2, imageCenterY * 2);
    ctx.scale(-1, -1);
    return;
  }
  if (side === 'back') {
    ctx.translate(0, imageCenterY * 2);
    ctx.scale(1, -1);
    return;
  }
  if (mirrorArtworkX) {
    ctx.translate(imageCenterX * 2, 0);
    ctx.scale(-1, 1);
  }
}

function buildBladeClipPath(pxPerMm: number, bleed: number) {
  const path = new Path2D();
  if (bleed > 0) {
    for (const loop of getFlipbookBladeBleedLoops(bleed)) {
      loop.forEach((point, index) => {
        const x = (bleed + point.x) * pxPerMm;
        const y = (bleed + point.y) * pxPerMm;
        if (index === 0) path.moveTo(x, y);
        else path.lineTo(x, y);
      });
      path.closePath();
    }
    return path;
  }

  for (const command of bladeContourCommands) {
    if (command.type === 'M') {
      path.moveTo((bleed + command.points[0]) * pxPerMm, (bleed + command.points[1]) * pxPerMm);
    } else if (command.type === 'L') {
      path.lineTo((bleed + command.points[0]) * pxPerMm, (bleed + command.points[1]) * pxPerMm);
    } else if (command.type === 'C') {
      path.bezierCurveTo(
        (bleed + command.points[0]) * pxPerMm,
        (bleed + command.points[1]) * pxPerMm,
        (bleed + command.points[2]) * pxPerMm,
        (bleed + command.points[3]) * pxPerMm,
        (bleed + command.points[4]) * pxPerMm,
        (bleed + command.points[5]) * pxPerMm
      );
    } else {
      path.closePath();
    }
  }

  return path;
}

function fillBladeFallback(ctx: CanvasRenderingContext2D, width: number, height: number, half: BladeHalf) {
  ctx.fillStyle = half === 'A' ? '#4f8cff' : '#38d39f';
  ctx.fillRect(0, 0, width, height);
}

function drawBladeRasterLabels(
  ctx: CanvasRenderingContext2D,
  pxPerMm: number,
  bleed: number,
  partLabel: string,
  bladeId: string
) {
  const viewBox = FLIPBOOK_BLADE_VIEWBOX;
  const y = (bleed + viewBox.h - 1.95) * pxPerMm;
  const fontSize = 2.15 * pxPerMm;

  ctx.save();
  ctx.font = `700 ${fontSize}px Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = 0.35 * pxPerMm;
  ctx.fillStyle = '#111';

  ctx.textAlign = 'center';
  const leftX = (bleed + 3.9) * pxPerMm;
  ctx.strokeText(partLabel, leftX, y);
  ctx.fillText(partLabel, leftX, y);

  const rightX = (bleed + viewBox.w - 3.9) * pxPerMm;
  ctx.strokeText(bladeId, rightX, y);
  ctx.fillText(bladeId, rightX, y);
  ctx.restore();
}

function loadCachedImage(src: string, cache: ImageCache): Promise<HTMLImageElement> {
  let image = cache.get(src);
  if (!image) {
    image = loadImage(src);
    cache.set(src, image);
  }
  return image;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const decoded = typeof image.decode === 'function' ? image.decode().catch(() => undefined) : Promise.resolve();
      decoded.then(() => resolve(image));
    };
    image.onerror = () => reject(new Error('Unable to load flipbook blade photo'));
    image.src = src;
  });
}

const bladeContourCommands: FlipbookBladePathCommand[] = FLIPBOOK_BLADE_LOCAL_COMMANDS;

function drawBladeContour(pdf: JsPdf, trimX: number, trimY: number) {
  pdf.setDrawColor(0, 0, 0);
  pdf.setLineWidth(CUT_STROKE_MM);
  pdf.setLineJoin('round');
  pdf.setLineCap('round');
  for (const command of bladeContourCommands) {
    if (command.type === 'M') {
      pdf.moveTo(trimX + command.points[0], trimY + command.points[1]);
    } else if (command.type === 'L') {
      pdf.lineTo(trimX + command.points[0], trimY + command.points[1]);
    } else if (command.type === 'C') {
      pdf.curveTo(
        trimX + command.points[0],
        trimY + command.points[1],
        trimX + command.points[2],
        trimY + command.points[3],
        trimX + command.points[4],
        trimY + command.points[5]
      );
    } else {
      pdf.close();
    }
  }
  pdf.stroke();
}
