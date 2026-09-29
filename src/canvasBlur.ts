let nativeCanvasBlurWorks: boolean | null = null;

export function createBlurredCanvas(
  image: CanvasImageSource,
  width: number,
  height: number,
  blur: number
): HTMLCanvasElement {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const safeBlur = normalizeBlur(blur);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (safeBlur <= 0) {
    ctx.drawImage(image, 0, 0, w, h);
    return canvas;
  }

  if (supportsNativeCanvasBlur()) {
    ctx.filter = `blur(${safeBlur}px)`;
    ctx.drawImage(image, 0, 0, w, h);
    ctx.filter = 'none';
    return canvas;
  }

  drawPortableBlur(ctx, image, w, h, safeBlur);
  return canvas;
}

function normalizeBlur(blur: number): number {
  return Number.isFinite(blur) ? Math.max(0, Math.min(40, Math.round(blur))) : 0;
}

function supportsNativeCanvasBlur(): boolean {
  if (nativeCanvasBlurWorks !== null) return nativeCanvasBlurWorks;

  const source = document.createElement('canvas');
  source.width = 5;
  source.height = 5;
  const sourceCtx = source.getContext('2d');
  const target = document.createElement('canvas');
  target.width = 5;
  target.height = 5;
  const targetCtx = target.getContext('2d', { willReadFrequently: true });

  if (!sourceCtx || !targetCtx || !('filter' in targetCtx)) {
    nativeCanvasBlurWorks = false;
    return nativeCanvasBlurWorks;
  }

  sourceCtx.fillStyle = '#fff';
  sourceCtx.fillRect(2, 2, 1, 1);
  targetCtx.filter = 'blur(2px)';
  targetCtx.drawImage(source, 0, 0);

  const adjacentAlpha = targetCtx.getImageData(1, 2, 1, 1).data[3];
  nativeCanvasBlurWorks = adjacentAlpha > 0;
  return nativeCanvasBlurWorks;
}

function drawPortableBlur(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  width: number,
  height: number,
  blur: number
) {
  const scale = Math.max(0.08, Math.min(0.85, 1 / (1 + blur * 0.1)));
  const downW = Math.max(1, Math.round(width * scale));
  const downH = Math.max(1, Math.round(height * scale));
  const down = document.createElement('canvas');
  down.width = downW;
  down.height = downH;
  const downCtx = down.getContext('2d');
  if (!downCtx) {
    ctx.drawImage(image, 0, 0, width, height);
    return;
  }

  downCtx.imageSmoothingEnabled = true;
  downCtx.imageSmoothingQuality = 'high';
  downCtx.drawImage(image, 0, 0, downW, downH);
  softenSmallCanvas(down, blur, scale);

  ctx.drawImage(down, 0, 0, downW, downH, 0, 0, width, height);
}

function softenSmallCanvas(canvas: HTMLCanvasElement, blur: number, scale: number) {
  const passes = Math.max(1, Math.min(4, Math.ceil(blur / 12)));
  const spread = Math.max(1, Math.round(blur * scale * 0.18));
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const tmp = document.createElement('canvas');
  tmp.width = canvas.width;
  tmp.height = canvas.height;
  const tmpCtx = tmp.getContext('2d');
  if (!tmpCtx) return;

  const offsets = [
    [0, 0],
    [-spread, 0],
    [spread, 0],
    [0, -spread],
    [0, spread],
    [-spread, -spread],
    [spread, -spread],
    [-spread, spread],
    [spread, spread],
  ] as const;

  for (let pass = 0; pass < passes; pass++) {
    tmpCtx.clearRect(0, 0, tmp.width, tmp.height);
    tmpCtx.drawImage(canvas, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1 / offsets.length;
    for (const [dx, dy] of offsets) {
      ctx.drawImage(tmp, dx, dy);
    }
    ctx.globalAlpha = 1;
  }
}
