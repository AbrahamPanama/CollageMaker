import {
  computeEchoPlacement,
  computePhotoPlacement,
  normalizeEchoFill,
  placementUnderfills,
} from '../photoFraming';
import type { LoadedPhoto } from '../photoIngest';
import type { ManualFrame } from '../types';
import { footprint } from './tiling';
import type { Brick, LegoSet } from './types';
import { BRICK_HEIGHT_MM, CELL_SIZE_MM } from './units';

export const CELL_TEX_PX = 48;
export const MAX_FACE_TEXTURE_EDGE = 2048;

type SeamOptions = {
  show: boolean;
  color: string;
  width: number;
};

export type LegoFaceRenderOptions = {
  set: LegoSet;
  photo: LoadedPhoto | null;
  image?: CanvasImageSource | null;
  framing?: ManualFrame | null;
  pxW: number;
  pxH: number;
  background: string;
  transparentBg: boolean;
  closeUp: boolean;
  closeUpTightness: number;
  seams?: SeamOptions;
};

export function computeLegoFaceTextureSize(set: Pick<LegoSet, 'cols' | 'rows'>) {
  const rawW = Math.max(1, set.cols * CELL_TEX_PX);
  const rawH = Math.max(1, set.rows * CELL_TEX_PX * (BRICK_HEIGHT_MM / CELL_SIZE_MM));
  const scale = Math.min(1, MAX_FACE_TEXTURE_EDGE / Math.max(rawW, rawH));
  return {
    width: Math.max(1, Math.round(rawW * scale)),
    height: Math.max(1, Math.round(rawH * scale)),
    scale,
  };
}

export function renderLegoFaceCanvas(options: LegoFaceRenderOptions): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(options.pxW));
  canvas.height = Math.max(1, Math.round(options.pxH));

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // Everything is painted INSIDE the shape mask. Cells outside the mask stay
  // fully transparent so the 3D face plane shows only the panel silhouette
  // instead of an opaque background rectangle covering the model.
  ctx.save();
  traceMask(ctx, options.set, canvas.width / options.set.cols, canvas.height / options.set.rows);
  ctx.clip();

  if (!options.transparentBg) {
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  if (options.photo && options.image) {
    const photo = options.framing ? { ...options.photo, manualFrame: options.framing } : options.photo;
    const placement = computePhotoPlacement(photo, canvas.width, canvas.height, {
      closeUp: options.closeUp,
      closeUpTightness: options.closeUpTightness,
    });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // Echo fill: when the framing underfills the panel (zoom < cover), draw an
    // enlarged, gaussian-blurred copy of the same image behind the foreground so
    // the empty area reads as a soft continuation instead of a hard background.
    const echo = normalizeEchoFill(photo.echo);
    if (echo.mode === 'auto' && placementUnderfills(placement, canvas.width, canvas.height)) {
      const echoPlacement = computeEchoPlacement(photo, canvas.width, canvas.height, placement);
      const echoSource =
        echo.blur > 0
          ? blurToCanvas(options.image, photo.naturalWidth, photo.naturalHeight, echo.blur)
          : options.image;
      ctx.drawImage(echoSource, echoPlacement.x, echoPlacement.y, echoPlacement.w, echoPlacement.h);
      if (echo.dim > 0) {
        ctx.save();
        ctx.globalAlpha = echo.dim / 100;
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.restore();
      }
    }

    ctx.drawImage(options.image, placement.x, placement.y, placement.w, placement.h);
  }

  if (options.seams?.show) {
    drawBrickSeams(ctx, options.set, options.set.bricks, canvas.width, canvas.height, options.seams);
  }

  ctx.restore();
  return canvas;
}

// Gaussian-blur the source image into a natural-resolution canvas (matches the
// 2D builder's useBlurredEchoImage approach so the echo reads the same on the
// Konva canvas, the 3D texture, and export).
function blurToCanvas(
  image: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  blur: number
): CanvasImageSource {
  const w = Math.max(1, Math.round(naturalWidth));
  const h = Math.max(1, Math.round(naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return image;
  ctx.filter = `blur(${Math.max(0, blur)}px)`;
  ctx.drawImage(image, 0, 0, w, h);
  return canvas;
}

export function traceMask(
  ctx: Pick<CanvasRenderingContext2D, 'beginPath' | 'rect'>,
  set: Pick<LegoSet, 'cols' | 'rows' | 'cellMask'>,
  cellW: number,
  cellH: number
) {
  ctx.beginPath();
  for (let row = 0; row < set.rows; row++) {
    for (let col = 0; col < set.cols; col++) {
      if (!set.cellMask[row * set.cols + col]) continue;
      ctx.rect(col * cellW, row * cellH, cellW, cellH);
    }
  }
}

function drawBrickSeams(
  ctx: CanvasRenderingContext2D,
  set: LegoSet,
  bricks: Brick[],
  width: number,
  height: number,
  seams: SeamOptions
) {
  ctx.save();
  ctx.strokeStyle = seams.color;
  ctx.lineWidth = seams.width;
  for (const brick of bricks) {
    const cells = footprint(brick);
    const minCol = Math.min(...cells.map((cell) => cell.col));
    const minRow = Math.min(...cells.map((cell) => cell.row));
    const maxCol = Math.max(...cells.map((cell) => cell.col));
    const maxRow = Math.max(...cells.map((cell) => cell.row));
    ctx.strokeRect(
      (minCol / set.cols) * width,
      (minRow / set.rows) * height,
      ((maxCol - minCol + 1) / set.cols) * width,
      ((maxRow - minRow + 1) / set.rows) * height
    );
  }
  ctx.restore();
}
