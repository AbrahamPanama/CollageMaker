import { useMemo } from 'react';
import { createBlurredCanvas } from '../canvasBlur';

type EchoBitmap = HTMLImageElement | HTMLCanvasElement;

const blurCache = new WeakMap<HTMLImageElement, Map<number, HTMLCanvasElement>>();

export function useBlurredEchoImage(
  image: HTMLImageElement | undefined,
  blur: number
): EchoBitmap | undefined {
  const safeBlur = Number.isFinite(blur) ? Math.max(0, Math.min(40, Math.round(blur))) : 0;
  return useMemo(() => {
    if (!image) return undefined;
    if (safeBlur <= 0) return image;

    const cached = blurCache.get(image)?.get(safeBlur);
    if (cached) return cached;

    const canvas = createBlurredCanvas(
      image,
      image.naturalWidth || image.width,
      image.naturalHeight || image.height,
      safeBlur
    );
    let byBlur = blurCache.get(image);
    if (!byBlur) {
      byBlur = new Map();
      blurCache.set(image, byBlur);
    }
    byBlur.set(safeBlur, canvas);
    return canvas;
  }, [image, safeBlur]);
}
