import type { GridCell, ScoredLayout } from './types';

export function applyStableAssignments(
  previousCells: GridCell[],
  layouts: ScoredLayout[],
  lockedPhotoIds: Set<string> = new Set()
): ScoredLayout[] {
  if (previousCells.length === 0 || layouts.length === 0) return layouts;
  return layouts.map((layout) => {
    const assigned = matchCells(previousCells, layout.cells, lockedPhotoIds);
    return {
      ...layout,
      cells: assigned,
      score: layout.score + lockPenalty(previousCells, assigned, lockedPhotoIds),
    };
  }).sort((a, b) => a.score - b.score);
}

export function iou(a: GridCell, b: GridCell) {
  const x1 = Math.max(a.rect.x, b.rect.x);
  const y1 = Math.max(a.rect.y, b.rect.y);
  const x2 = Math.min(a.rect.x + a.rect.w, b.rect.x + b.rect.w);
  const y2 = Math.min(a.rect.y + a.rect.h, b.rect.y + b.rect.h);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const union = a.rect.w * a.rect.h + b.rect.w * b.rect.h - intersection;
  return union <= 0 ? 0 : intersection / union;
}

function matchCells(previousCells: GridCell[], nextCells: GridCell[], lockedPhotoIds: Set<string>) {
  const nextPhotoIds = new Set(nextCells.map((cell) => cell.photoId));
  const unassigned = nextCells.map((cell, index) => ({ cell, index }));
  const orderedPrevious = previousCells
    .filter((cell) => nextPhotoIds.has(cell.photoId))
    .sort((a, b) => {
      const lockDelta = Number(lockedPhotoIds.has(b.photoId)) - Number(lockedPhotoIds.has(a.photoId));
      if (lockDelta !== 0) return lockDelta;
      return b.rect.w * b.rect.h - a.rect.w * a.rect.h;
    });

  const assigned = nextCells.map((cell) => ({ ...cell, photoId: '', id: cell.id }));
  const usedNext = new Set<number>();
  const usedPhotoIds = new Set<string>();

  for (const previous of orderedPrevious) {
    let bestIndex = -1;
    let bestScore = -1;
    for (const item of unassigned) {
      if (usedNext.has(item.index)) continue;
      const score = iou(previous, item.cell);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = item.index;
      }
    }
    if (bestIndex >= 0) {
      assigned[bestIndex] = { ...assigned[bestIndex], photoId: previous.photoId, id: previous.photoId };
      usedNext.add(bestIndex);
      usedPhotoIds.add(previous.photoId);
    }
  }

  const remainingPhotoIds = nextCells.map((cell) => cell.photoId).filter((photoId) => !usedPhotoIds.has(photoId));
  let remainingIndex = 0;
  for (let index = 0; index < assigned.length; index++) {
    if (usedNext.has(index)) continue;
    const nextPhotoId = remainingPhotoIds[remainingIndex++] ?? assigned[index].photoId;
    assigned[index] = { ...assigned[index], photoId: nextPhotoId, id: nextPhotoId };
  }
  return assigned;
}

function lockPenalty(previousCells: GridCell[], nextCells: GridCell[], lockedPhotoIds: Set<string>) {
  let penalty = 0;
  for (const previous of previousCells) {
    if (!lockedPhotoIds.has(previous.photoId)) continue;
    const next = nextCells.find((cell) => cell.photoId === previous.photoId);
    if (!next) continue;
    const overlap = iou(previous, next);
    if (overlap < 0.5) penalty += (0.5 - overlap) * 8;
  }
  return penalty;
}
