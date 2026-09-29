import { describe, expect, it } from 'vitest';
import { LEGO_PRESETS } from './shapes';
import { bricksForFace, mirrorBrickForBack, mirrorCellX } from './imposition';
import { footprint, tileShape } from './tiling';

describe('lego imposition', () => {
  it('mirrors cells across X', () => {
    expect(mirrorCellX(6, { col: 0, row: 2 })).toEqual({ col: 5, row: 2 });
    expect(mirrorCellX(6, { col: 5, row: 2 })).toEqual({ col: 0, row: 2 });
  });

  it('mirrors bricks without changing footprint size', () => {
    const set = tileShape(LEGO_PRESETS[0]);
    for (const brick of set.bricks) {
      const mirrored = mirrorBrickForBack(set, brick);
      expect(footprint(mirrored)).toHaveLength(footprint(brick).length);
      const roundTrip = mirrorBrickForBack(set, mirrored);
      expect(footprint(roundTrip).sort(sortCells)).toEqual(footprint(brick).sort(sortCells));
    }
  });

  it('returns front unchanged and back mirrored', () => {
    const set = tileShape(LEGO_PRESETS[0]);
    expect(bricksForFace(set, 'front')).toBe(set.bricks);
    expect(bricksForFace(set, 'back')).not.toEqual(set.bricks);
  });
});

function sortCells(a: { col: number; row: number }, b: { col: number; row: number }) {
  return a.row - b.row || a.col - b.col;
}
