import type { GridCell, PhotoMeta, Rect, ScoreBreakdown, ScoreWeights } from './types';
import { clampAspect } from './tree';

const DEFAULT_WEIGHTS: Required<ScoreWeights> = {
  aspectFit: 1,
  subjectSafety: 1.4,
  areaBalance: 0.6,
  heroBoost: 0.8,
  faceWeighting: 0.4,
  minCell: 2,
  adjacencyVariety: 0.2,
};

export function scoreLayout(
  cells: GridCell[],
  metas: PhotoMeta[],
  options: {
    minCellFraction?: number;
    weights?: ScoreWeights;
    heroPhotoId?: string | null;
    targetAspect?: number;
  } = {}
) {
  const metaById = new Map(metas.map((meta) => [meta.id, meta]));
  const breakdown: ScoreBreakdown = {
    aspectFit: aspectFitPenalty(cells, metaById, options.targetAspect ?? 1),
    subjectSafety: subjectSafetyPenalty(cells, metaById, options.targetAspect ?? 1),
    areaBalance: areaBalancePenalty(cells),
    heroBoost: heroPenalty(cells, options.heroPhotoId ?? null),
    faceWeighting: faceWeightingPenalty(cells, metaById),
    minCell: minCellPenalty(cells, options.minCellFraction ?? 0.06),
    adjacencyVariety: adjacencyVarietyPenalty(cells),
  };
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights };
  const total = Object.entries(breakdown).reduce(
    (sum, [key, value]) => sum + value * weights[key as keyof ScoreBreakdown],
    0
  );
  return { total, breakdown };
}

export function cellAspect(cell: GridCell, targetAspect: number) {
  const safeTarget = Number.isFinite(targetAspect) && targetAspect > 0 ? targetAspect : 1;
  return Math.max(0.001, (cell.rect.w * safeTarget) / Math.max(0.001, cell.rect.h));
}

export function rectArea(rect: Rect) {
  return Math.max(0, rect.w) * Math.max(0, rect.h);
}

function aspectFitPenalty(cells: GridCell[], metas: Map<string, PhotoMeta>, targetAspect: number) {
  if (cells.length === 0) return 0;
  return average(cells.map((cell) => {
    const meta = metas.get(cell.photoId);
    const photoAspect = clampAspect(meta?.aspect ?? 1);
    return Math.abs(Math.log(cellAspect(cell, targetAspect) / photoAspect));
  }));
}

function subjectSafetyPenalty(cells: GridCell[], metas: Map<string, PhotoMeta>, targetAspect: number) {
  const penalties = cells.map((cell) => {
    const meta = metas.get(cell.photoId);
    if (!meta?.subject) return 0;
    const photoAspect = clampAspect(meta.aspect);
    const aspect = cellAspect(cell, targetAspect);
    const subject = meta.subject;
    const crop = coverCropWindow(subject, photoAspect, aspect);
    const outsideX = Math.max(0, crop.x - subject.x) + Math.max(0, subject.x + subject.w - (crop.x + crop.w));
    const outsideY = Math.max(0, crop.y - subject.y) + Math.max(0, subject.y + subject.h - (crop.y + crop.h));
    return Math.min(1, outsideX / Math.max(0.001, subject.w) + outsideY / Math.max(0.001, subject.h));
  });
  return average(penalties);
}

function areaBalancePenalty(cells: GridCell[]) {
  if (cells.length <= 1) return 0;
  const areas = cells.map((cell) => rectArea(cell.rect)).filter((area) => area > 0);
  const min = Math.min(...areas);
  const max = Math.max(...areas);
  const ratio = max / Math.max(0.0001, min);
  const tooFlat = ratio < 1.3 ? (1.3 - ratio) / 1.3 : 0;
  const tooExtreme = ratio > 5 ? Math.min(1, (ratio - 5) / 5) : 0;
  return tooFlat + tooExtreme;
}

function heroPenalty(cells: GridCell[], heroPhotoId: string | null) {
  if (!heroPhotoId) return 0;
  const sorted = cells.slice().sort((a, b) => rectArea(b.rect) - rectArea(a.rect));
  const rank = sorted.findIndex((cell) => cell.photoId === heroPhotoId);
  if (rank <= 0) return 0;
  return rank / Math.max(1, cells.length - 1);
}

function faceWeightingPenalty(cells: GridCell[], metas: Map<string, PhotoMeta>) {
  if (cells.length <= 1) return 0;
  const sortedAreas = cells.map((cell) => rectArea(cell.rect)).sort((a, b) => a - b);
  const median = sortedAreas[Math.floor(sortedAreas.length / 2)] ?? 0;
  const faceCells = cells.filter((cell) => {
    const source = metas.get(cell.photoId)?.subject?.source;
    return source === 'face' || source === 'hybrid';
  });
  if (faceCells.length === 0) return 0;
  return average(faceCells.map((cell) => (rectArea(cell.rect) < median ? 1 : 0)));
}

function minCellPenalty(cells: GridCell[], minCellFraction: number) {
  const minDim = Math.max(0.001, minCellFraction);
  return average(cells.map((cell) => {
    const shortSide = Math.min(cell.rect.w, cell.rect.h);
    if (shortSide >= minDim) return 0;
    return Math.min(2, (minDim - shortSide) / minDim);
  }));
}

function adjacencyVarietyPenalty(cells: GridCell[]) {
  if (cells.length <= 2) return 0;
  const pairs: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    for (let j = i + 1; j < cells.length; j++) {
      if (touch(cells[i].rect, cells[j].rect)) {
        const a = rectArea(cells[i].rect);
        const b = rectArea(cells[j].rect);
        pairs.push(Math.abs(a - b) / Math.max(a, b, 0.0001) < 0.1 ? 1 : 0);
      }
    }
  }
  return average(pairs);
}

function coverCropWindow(
  subject: { x: number; y: number; w: number; h: number },
  photoAspect: number,
  cellAspectValue: number
) {
  let w = 1;
  let h = 1;
  if (photoAspect > cellAspectValue) {
    w = cellAspectValue / photoAspect;
  } else {
    h = photoAspect / cellAspectValue;
  }
  const cx = subject.x + subject.w / 2;
  const cy = subject.y + subject.h / 2;
  return {
    x: clamp(cx - w / 2, 0, 1 - w),
    y: clamp(cy - h / 2, 0, 1 - h),
    w,
    h,
  };
}

function touch(a: Rect, b: Rect) {
  const xTouch = nearly(a.x + a.w, b.x) || nearly(b.x + b.w, a.x);
  const yOverlap = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.001;
  const yTouch = nearly(a.y + a.h, b.y) || nearly(b.y + b.h, a.y);
  const xOverlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.001;
  return (xTouch && yOverlap) || (yTouch && xOverlap);
}

function nearly(a: number, b: number) {
  return Math.abs(a - b) < 0.001;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
