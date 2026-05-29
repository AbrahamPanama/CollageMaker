import type { ManualFrame, Photo } from './types';

export const MAX_MANUAL_ZOOM = 4;
const MAX_AUTO_UPSCALE = 2;

export type PhotoPlacement = {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  subjectBox: { x: number; y: number; w: number; h: number; source: string } | null;
};

export function computePhotoPlacement(
  photo: Photo,
  frameW: number,
  frameH: number,
  options: {
    closeUp: boolean;
    closeUpTightness: number;
  }
): PhotoPlacement {
  const w = Math.max(1, frameW);
  const h = Math.max(1, frameH);
  const coverScale = Math.max(w / photo.naturalWidth, h / photo.naturalHeight);

  let scale = coverScale;
  let cx = 0.5;
  let cy = 0.5;

  if (photo.manualFrame) {
    const frame = constrainManualFrame(photo.manualFrame, photo, w, h);
    scale = coverScale * frame.zoom;
    cx = frame.cx;
    cy = frame.cy;
  } else if (options.closeUp && photo.subject) {
    const subjPixW = Math.max(1, photo.subject.w * photo.naturalWidth);
    const subjPixH = Math.max(1, photo.subject.h * photo.naturalHeight);
    const closeupScale = Math.min(
      (w * options.closeUpTightness) / subjPixW,
      (h * options.closeUpTightness) / subjPixH
    );
    scale = Math.max(coverScale, Math.min(closeupScale, MAX_AUTO_UPSCALE));
    cx = photo.subject.x + photo.subject.w / 2;
    cy = photo.subject.y + photo.subject.h / 2;
  }

  const imgW = photo.naturalWidth * scale;
  const imgH = photo.naturalHeight * scale;
  const x = clamp(w / 2 - cx * imgW, w - imgW, 0);
  const y = clamp(h / 2 - cy * imgH, h - imgH, 0);

  return {
    x,
    y,
    w: imgW,
    h: imgH,
    scale,
    subjectBox: photo.subject
      ? {
          x: x + photo.subject.x * imgW,
          y: y + photo.subject.y * imgH,
          w: photo.subject.w * imgW,
          h: photo.subject.h * imgH,
          source: photo.subject.source,
        }
      : null,
  };
}

export function getInitialManualFrame(
  photo: Photo,
  closeUpTightness: number
): ManualFrame {
  if (photo.manualFrame) return clampManualFrame(photo.manualFrame);
  if (!photo.subject) return { cx: 0.5, cy: 0.5, zoom: 1 };

  const subjectMax = Math.max(photo.subject.w, photo.subject.h, 0.001);
  return clampManualFrame({
    cx: photo.subject.x + photo.subject.w / 2,
    cy: photo.subject.y + photo.subject.h / 2,
    zoom: closeUpTightness / subjectMax,
  });
}

export function constrainManualFrame(
  frame: ManualFrame,
  photo: Photo,
  frameW: number,
  frameH: number
): ManualFrame {
  const base = clampManualFrame(frame);
  const w = Math.max(1, frameW);
  const h = Math.max(1, frameH);
  const coverScale = Math.max(w / photo.naturalWidth, h / photo.naturalHeight);
  const imgW = photo.naturalWidth * coverScale * base.zoom;
  const imgH = photo.naturalHeight * coverScale * base.zoom;

  return {
    cx: clampCenter(base.cx, imgW, w),
    cy: clampCenter(base.cy, imgH, h),
    zoom: base.zoom,
  };
}

export function clampManualFrame(frame: ManualFrame): ManualFrame {
  return {
    cx: clamp(frame.cx, 0, 1),
    cy: clamp(frame.cy, 0, 1),
    zoom: clamp(frame.zoom, 1, MAX_MANUAL_ZOOM),
  };
}

function clampCenter(value: number, imageSize: number, frameSize: number): number {
  if (imageSize <= frameSize + 0.001) return 0.5;
  const inset = frameSize / (2 * imageSize);
  return clamp(value, inset, 1 - inset);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
