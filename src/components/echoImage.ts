import { useEffect, useState } from 'react';

type EchoBitmap = HTMLImageElement | HTMLCanvasElement;

const blurCache = new WeakMap<HTMLImageElement, Map<number, HTMLCanvasElement>>();

export function useBlurredEchoImage(
  image: HTMLImageElement | undefined,
  blur: number
): EchoBitmap | undefined {
  const safeBlur = Number.isFinite(blur) ? Math.max(0, Math.min(40, Math.round(blur))) : 0;
  const [bitmap, setBitmap] = useState<EchoBitmap | undefined>(image);

  useEffect(() => {
    if (!image) {
      setBitmap(undefined);
      return;
    }
    if (safeBlur <= 0) {
      setBitmap(image);
      return;
    }

    const cached = blurCache.get(image)?.get(safeBlur);
    if (cached) {
      setBitmap(cached);
      return;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, image.naturalWidth || image.width);
    canvas.height = Math.max(1, image.naturalHeight || image.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setBitmap(image);
      return;
    }

    ctx.filter = `blur(${safeBlur}px)`;
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    let byBlur = blurCache.get(image);
    if (!byBlur) {
      byBlur = new Map();
      blurCache.set(image, byBlur);
    }
    byBlur.set(safeBlur, canvas);
    setBitmap(canvas);
  }, [image, safeBlur]);

  return bitmap;
}
