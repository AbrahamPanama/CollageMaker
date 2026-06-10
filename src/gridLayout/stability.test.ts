import { describe, expect, it } from 'vitest';
import { applyStableAssignments } from './stability';
import type { GridCell, ScoredLayout } from './types';

const previous: GridCell[] = [
  { id: 'p1', photoId: 'p1', rect: { x: 0, y: 0, w: 0.65, h: 1 } },
  { id: 'p2', photoId: 'p2', rect: { x: 0.65, y: 0, w: 0.35, h: 0.5 } },
  { id: 'p3', photoId: 'p3', rect: { x: 0.65, y: 0.5, w: 0.35, h: 0.5 } },
];

const nextLayout: ScoredLayout = {
  id: 'candidate',
  tree: null,
  cells: [
    { id: 'p3', photoId: 'p3', rect: { x: 0, y: 0, w: 0.5, h: 0.5 } },
    { id: 'p1', photoId: 'p1', rect: { x: 0.5, y: 0, w: 0.5, h: 0.5 } },
    { id: 'p2', photoId: 'p2', rect: { x: 0, y: 0.5, w: 1, h: 0.5 } },
  ],
  score: 1,
  breakdown: {
    aspectFit: 0,
    subjectSafety: 0,
    areaBalance: 0,
    heroBoost: 0,
    faceWeighting: 0,
    minCell: 0,
    adjacencyVariety: 0,
  },
};

describe('grid layout stability', () => {
  it('keeps every candidate photo assigned exactly once', () => {
    const [stable] = applyStableAssignments(previous, [nextLayout]);
    const ids = stable.cells.map((cell) => cell.photoId).sort();

    expect(ids).toEqual(['p1', 'p2', 'p3']);
  });
});
