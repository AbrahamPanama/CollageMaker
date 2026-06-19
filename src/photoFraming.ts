import type { EchoFill, ManualFrame, Photo } from './types';

export const MAX_MANUAL_ZOOM = 4;
export const MIN_MANUAL_ZOOM = 0.25;
const MAX_AUTO_UPSCALE = 2;
export const DEFAULT_ECHO_FILL: EchoFill = {
  mode: 'auto',
  blur: 0,
  dim: 0,
  outline: false,
};

export type PhotoPlacement = {
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
  coverScale: number;
  zoom: number;
  cx: number;
  cy: number;
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
  const x = clampOffset(w / 2 - cx * imgW, imgW, w);
  const y = clampOffset(h / 2 - cy * imgH, imgH, h);

  return {
    x,
    y,
    w: imgW,
    h: imgH,
    scale,
    coverScale,
    zoom: scale / Math.max(0.0001, coverScale),
    cx,
    cy,
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
    zoom: clamp(frame.zoom, MIN_MANUAL_ZOOM, MAX_MANUAL_ZOOM),
  };
}

export function getFitSubjectsFrame(photo: Photo, frameW: number, frameH: number): ManualFrame {
  const w = Math.max(1, frameW);
  const h = Math.max(1, frameH);
  const coverScale = Math.max(w / photo.naturalWidth, h / photo.naturalHeight);
  if (!photo.subject) {
    const containScale = Math.min(w / photo.naturalWidth, h / photo.naturalHeight);
    return constrainManualFrame(
      { cx: 0.5, cy: 0.5, zoom: containScale / Math.max(0.0001, coverScale) },
      photo,
      w,
      h
    );
  }

  const subjPixW = Math.max(1, photo.subject.w * photo.naturalWidth);
  const subjPixH = Math.max(1, photo.subject.h * photo.naturalHeight);
  const subjectFitScale = Math.min(w / subjPixW, h / subjPixH);
  const zoom = Math.min(1, subjectFitScale / Math.max(0.0001, coverScale));
  return constrainManualFrame(
    {
      cx: photo.subject.x + photo.subject.w / 2,
      cy: photo.subject.y + photo.subject.h / 2,
      zoom,
    },
    photo,
    w,
    h
  );
}

export function placementUnderfills(
  placement: Pick<PhotoPlacement, 'x' | 'y' | 'w' | 'h'>,
  frameW: number,
  frameH: number,
  tolerance = 0.5
): boolean {
  return (
    placement.x > tolerance ||
    placement.y > tolerance ||
    placement.x + placement.w < frameW - tolerance ||
    placement.y + placement.h < frameH - tolerance
  );
}

export function computeEchoPlacement(
  photo: Photo,
  frameW: number,
  frameH: number,
  foreground: Pick<PhotoPlacement, 'cx' | 'cy' | 'coverScale'>
): PhotoPlacement {
  const w = Math.max(1, frameW);
  const h = Math.max(1, frameH);
  const scale = foreground.coverScale;
  const imgW = photo.naturalWidth * scale;
  const imgH = photo.naturalHeight * scale;
  const x = clampOffset(w / 2 - foreground.cx * imgW, imgW, w);
  const y = clampOffset(h / 2 - foreground.cy * imgH, imgH, h);
  return {
    x,
    y,
    w: imgW,
    h: imgH,
    scale,
    coverScale: foreground.coverScale,
    zoom: 1,
    cx: foreground.cx,
    cy: foreground.cy,
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

export function normalizeEchoFill(echo: EchoFill | undefined): EchoFill {
  if (!echo) return DEFAULT_ECHO_FILL;
  return {
    mode: echo.mode === 'off' ? 'off' : 'auto',
    blur: clamp(echo.blur, 0, 40),
    dim: clamp(echo.dim, 0, 60),
    outline: Boolean(echo.outline),
  };
}

export function isDefaultEchoFill(echo: EchoFill | undefined): boolean {
  const normalized = normalizeEchoFill(echo);
  return (
    normalized.mode === DEFAULT_ECHO_FILL.mode &&
    normalized.blur === DEFAULT_ECHO_FILL.blur &&
    normalized.dim === DEFAULT_ECHO_FILL.dim &&
    normalized.outline === DEFAULT_ECHO_FILL.outline
  );
}

function clampCenter(value: number, imageSize: number, frameSize: number): number {
  if (imageSize >= frameSize - 0.001) {
    const inset = frameSize / (2 * imageSize);
    return clamp(value, inset, 1 - inset);
  }
  const halfRange = Math.min(0.5, Math.max(0, frameSize - imageSize) / (2 * imageSize));
  const inset = 0.5 - halfRange;
  return clamp(value, inset, 1 - inset);
}

function clampOffset(value: number, imageSize: number, frameSize: number): number {
  if (imageSize >= frameSize) return clamp(value, frameSize - imageSize, 0);
  return clamp(value, 0, frameSize - imageSize);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
