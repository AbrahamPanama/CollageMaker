import type { EchoFill, ManualFrame, Photo, SubjectBox } from './types';
import { buildPhotoSubjectDetection, unionSubjectBoxes } from './subjectDetection';

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
  const framingSubject = getFramingSubject(photo);

  let scale = coverScale;
  let cx = 0.5;
  let cy = 0.5;

  if (photo.manualFrame) {
    const frame = constrainManualFrame(photo.manualFrame, photo, w, h);
    scale = coverScale * frame.zoom;
    cx = frame.cx;
    cy = frame.cy;
  } else if (options.closeUp && framingSubject) {
    const subjPixW = Math.max(1, framingSubject.w * photo.naturalWidth);
    const subjPixH = Math.max(1, framingSubject.h * photo.naturalHeight);
    const closeupScale = Math.min(
      (w * options.closeUpTightness) / subjPixW,
      (h * options.closeUpTightness) / subjPixH
    );
    scale = Math.max(coverScale, Math.min(closeupScale, MAX_AUTO_UPSCALE));
    cx = framingSubject.x + framingSubject.w / 2;
    cy = framingSubject.y + framingSubject.h / 2;
  }

  const imgW = photo.naturalWidth * scale;
  const imgH = photo.naturalHeight * scale;
  const faceBox = getFaceConstraint(photo);
  if (!photo.manualFrame && faceBox) {
    cx = clampCenterToKeepBox(cx, faceBox.x, faceBox.w, imgW, w);
    cy = clampCenterToKeepBox(cy, faceBox.y, faceBox.h, imgH, h);
  } else {
    cx = clampCenter(cx, imgW, w);
    cy = clampCenter(cy, imgH, h);
  }
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
    subjectBox: framingSubject
      ? {
          x: x + framingSubject.x * imgW,
          y: y + framingSubject.y * imgH,
          w: framingSubject.w * imgW,
          h: framingSubject.h * imgH,
          source: framingSubject.source,
        }
      : null,
  };
}

export function getInitialManualFrame(
  photo: Photo,
  closeUpTightness: number,
  frameW?: number,
  frameH?: number
): ManualFrame {
  if (photo.manualFrame) return clampManualFrame(photo.manualFrame);
  if (
    frameW !== undefined &&
    frameH !== undefined &&
    frameW > 1 &&
    frameH > 1
  ) {
    const placement = computePhotoPlacement(photo, frameW, frameH, {
      closeUp: true,
      closeUpTightness,
    });
    return clampManualFrame({
      cx: placement.cx,
      cy: placement.cy,
      zoom: placement.zoom,
    });
  }
  const framingSubject = getFramingSubject(photo);
  if (!framingSubject) return { cx: 0.5, cy: 0.5, zoom: 1 };

  const subjectMax = Math.max(framingSubject.w, framingSubject.h, 0.001);
  return clampManualFrame({
    cx: framingSubject.x + framingSubject.w / 2,
    cy: framingSubject.y + framingSubject.h / 2,
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
  const framingSubject = getFramingSubject(photo);
  if (!framingSubject) {
    const containScale = Math.min(w / photo.naturalWidth, h / photo.naturalHeight);
    return constrainManualFrame(
      { cx: 0.5, cy: 0.5, zoom: containScale / Math.max(0.0001, coverScale) },
      photo,
      w,
      h
    );
  }

  const subjPixW = Math.max(1, framingSubject.w * photo.naturalWidth);
  const subjPixH = Math.max(1, framingSubject.h * photo.naturalHeight);
  const subjectFitScale = Math.min(w / subjPixW, h / subjPixH);
  const zoom = Math.min(1, subjectFitScale / Math.max(0.0001, coverScale));
  return constrainManualFrame(
    {
      cx: framingSubject.x + framingSubject.w / 2,
      cy: framingSubject.y + framingSubject.h / 2,
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
  const framingSubject = getFramingSubject(photo);
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
    subjectBox: framingSubject
      ? {
          x: x + framingSubject.x * imgW,
          y: y + framingSubject.y * imgH,
          w: framingSubject.w * imgW,
          h: framingSubject.h * imgH,
          source: framingSubject.source,
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

function clampCenterToKeepBox(
  desired: number,
  boxStart: number,
  boxSize: number,
  imageSize: number,
  frameSize: number
): number {
  const imageMin = clampCenter(0, imageSize, frameSize);
  const imageMax = clampCenter(1, imageSize, frameSize);
  const halfViewport = frameSize / (2 * Math.max(0.0001, imageSize));
  const focusMin = boxStart + boxSize - halfViewport;
  const focusMax = boxStart + halfViewport;
  const min = Math.max(imageMin, focusMin);
  const max = Math.min(imageMax, focusMax);

  if (min <= max) return clamp(desired, min, max);
  return clamp(boxStart + boxSize / 2, imageMin, imageMax);
}

function getFaceConstraint(photo: Photo): SubjectBox | null {
  const detectedFaces = photo.detections?.faces ?? [];
  if (detectedFaces.length > 0) return unionSubjectBoxes(detectedFaces, 'face');
  return photo.subject?.source === 'face' ? photo.subject : null;
}

function getFramingSubject(photo: Photo): SubjectBox | null {
  const detections = photo.detections;
  if (!detections || (detections.faces.length === 0 && detections.people.length === 0)) {
    return photo.subject;
  }
  return buildPhotoSubjectDetection(
    detections.faces,
    detections.people,
    photo.subject
  ).subject ?? photo.subject;
}

function clampOffset(value: number, imageSize: number, frameSize: number): number {
  if (imageSize >= frameSize) return clamp(value, frameSize - imageSize, 0);
  return clamp(value, 0, frameSize - imageSize);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
