import { detectSubject } from '../smartFrame';
import { MAX_MANUAL_ZOOM } from '../photoFraming';
import type { ManualFrame, SubjectBox } from '../types';
import { DETECT_LONG_EDGE_PX, ENVELOPE_PADDING, FOLLOW_SMOOTHING } from './constants';
import type { AutoFrameMode, CropRect, FrameSubject, RawFrame } from './types';

export async function detectFrameSubjects(
  frames: RawFrame[],
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void
): Promise<FrameSubject[]> {
  const subjects: FrameSubject[] = [];
  for (let index = 0; index < frames.length; index++) {
    throwIfAborted(signal);
    const detectionCanvas = downscaleCanvas(frames[index].bitmap, DETECT_LONG_EDGE_PX);
    subjects.push(await detectSubject(detectionCanvas, { faceApiMode: 'whenNoFace' }));
    onProgress?.(index + 1, frames.length);
  }
  return subjects;
}

export function computeCropRects(
  subjects: FrameSubject[],
  mode: AutoFrameMode,
  manualFrame: ManualFrame | null,
  aspect: number,
  srcW: number,
  srcH: number
): CropRect[] {
  const count = subjects.length;
  if (count === 0) return [];
  if (manualFrame) {
    const crop = manualFrameToCropRect(manualFrame, aspect, srcW, srcH);
    return Array.from({ length: count }, () => crop);
  }

  const filledSubjects = fillMissingSubjects(subjects);
  if (!filledSubjects.some(Boolean)) {
    const crop = centeredCrop(aspect, srcW, srcH);
    return Array.from({ length: count }, () => crop);
  }

  const rects = filledSubjects.map((subject) =>
    subject ? subjectToPixelRect(subject, srcW, srcH) : centeredCrop(aspect, srcW, srcH)
  );

  if (mode === 'perFrame') {
    return rects.map((rect) => aspectFit(rect, aspect, srcW, srcH, ENVELOPE_PADDING));
  }

  const envelope = unionRects(rects);
  const locked = aspectFit(envelope, aspect, srcW, srcH, ENVELOPE_PADDING);
  if (mode === 'locked') return Array.from({ length: count }, () => locked);

  let smooth = rectCenter(rects[0]);
  return rects.map((rect, index) => {
    const next = rectCenter(rect);
    if (index === 0) {
      smooth = next;
    } else {
      smooth = {
        x: smooth.x + (next.x - smooth.x) * FOLLOW_SMOOTHING,
        y: smooth.y + (next.y - smooth.y) * FOLLOW_SMOOTHING,
      };
    }
    return cropAroundCenter(smooth.x, smooth.y, locked.w, locked.h, srcW, srcH);
  });
}

export function aspectFit(
  rect: CropRect,
  aspect: number,
  srcW: number,
  srcH: number,
  pad = 0
): CropRect {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  let w = Math.max(1, rect.w * (1 + pad * 2));
  let h = Math.max(1, rect.h * (1 + pad * 2));

  if (w / h < safeAspect) {
    w = h * safeAspect;
  } else {
    h = w / safeAspect;
  }

  const maxCrop = centeredCrop(safeAspect, srcW, srcH);
  if (w > maxCrop.w || h > maxCrop.h) {
    const scale = Math.min(maxCrop.w / w, maxCrop.h / h);
    w *= scale;
    h *= scale;
  }

  return cropAroundCenter(cx, cy, w, h, srcW, srcH);
}

export function fillMissingSubjects(subjects: FrameSubject[]): FrameSubject[] {
  const filled = subjects.slice();
  let last: SubjectBox | null = null;
  for (let i = 0; i < filled.length; i++) {
    if (filled[i]) last = filled[i];
    else if (last) filled[i] = last;
  }
  last = null;
  for (let i = filled.length - 1; i >= 0; i--) {
    if (filled[i]) last = filled[i];
    else if (last) filled[i] = last;
  }
  return filled;
}

export function manualFrameToCropRect(
  frame: ManualFrame,
  aspect: number,
  srcW: number,
  srcH: number
): CropRect {
  const base = centeredCrop(aspect, srcW, srcH);
  const zoom = clamp(frame.zoom, 1, MAX_MANUAL_ZOOM);
  const w = base.w / zoom;
  const h = base.h / zoom;
  return cropAroundCenter(frame.cx * srcW, frame.cy * srcH, w, h, srcW, srcH);
}

function subjectToPixelRect(subject: SubjectBox, srcW: number, srcH: number): CropRect {
  return {
    x: subject.x * srcW,
    y: subject.y * srcH,
    w: subject.w * srcW,
    h: subject.h * srcH,
  };
}

function centeredCrop(aspect: number, srcW: number, srcH: number): CropRect {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const sourceAspect = srcW / srcH;
  const w = sourceAspect > safeAspect ? srcH * safeAspect : srcW;
  const h = sourceAspect > safeAspect ? srcH : srcW / safeAspect;
  return {
    x: (srcW - w) / 2,
    y: (srcH - h) / 2,
    w,
    h,
  };
}

function cropAroundCenter(cx: number, cy: number, w: number, h: number, srcW: number, srcH: number): CropRect {
  const safeW = Math.min(Math.max(1, w), srcW);
  const safeH = Math.min(Math.max(1, h), srcH);
  return {
    x: clamp(cx - safeW / 2, 0, srcW - safeW),
    y: clamp(cy - safeH / 2, 0, srcH - safeH),
    w: safeW,
    h: safeH,
  };
}

function unionRects(rects: CropRect[]): CropRect {
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.w));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function rectCenter(rect: CropRect) {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

function downscaleCanvas(source: HTMLCanvasElement, longEdgePx: number): HTMLCanvasElement {
  const scale = Math.min(1, longEdgePx / Math.max(source.width, source.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(source.width * scale));
  canvas.height = Math.max(1, Math.round(source.height * scale));
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Video import aborted', 'AbortError');
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
