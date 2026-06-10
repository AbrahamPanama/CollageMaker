import type { Photo } from '../types';
import { DECODE_LONG_EDGE_PX, VIDEO_JPEG_QUALITY } from './constants';
import type { CropRect, RawFrame } from './types';

export async function bakeFrame(
  frame: RawFrame,
  crop: CropRect,
  aspect: number,
  id: string
): Promise<Photo> {
  const size = outputSize(aspect, DECODE_LONG_EDGE_PX);
  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available for frame baking.');

  ctx.drawImage(
    frame.bitmap,
    crop.x,
    crop.y,
    crop.w,
    crop.h,
    0,
    0,
    size.width,
    size.height
  );

  const blob = await canvasToBlob(canvas, 'image/jpeg', VIDEO_JPEG_QUALITY);
  const src = URL.createObjectURL(blob);
  return {
    id,
    src,
    naturalWidth: size.width,
    naturalHeight: size.height,
    subject: null,
  };
}

export function revokePhotos(photos: Photo[]) {
  for (const photo of photos) {
    if (photo.src.startsWith('blob:')) URL.revokeObjectURL(photo.src);
  }
}

function outputSize(aspect: number, longEdgePx: number) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (safeAspect >= 1) {
    return {
      width: longEdgePx,
      height: Math.max(1, Math.round(longEdgePx / safeAspect)),
    };
  }
  return {
    width: Math.max(1, Math.round(longEdgePx * safeAspect)),
    height: longEdgePx,
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Could not bake a video frame.'));
      },
      type,
      quality
    );
  });
}
