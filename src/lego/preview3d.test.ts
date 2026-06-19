import { describe, expect, it } from 'vitest';
import { LEGO_PRESETS, maskCellCount } from './shapes';
import {
  BRICK_COURSE_HEIGHT_CELLS,
  BRICK_DEPTH_CELLS,
  BRICK_VISUAL_INSET,
  brickTransform,
  facePlaneTransform,
  panelScale,
  studPositions,
} from './preview3d';
import { tileShape } from './tiling';
import type { Brick } from './types';

describe('lego 3d geometry helpers', () => {
  it('positions and scales 2x2 bricks in centered panel space', () => {
    const brick: Brick = { id: 'mono', kind: '2x2', orientation: 'h', cell: { col: 0, row: 0 } };
    expect(brickTransform(brick, 10, 11)).toEqual({
      position: [-4, 6, 0],
      scale: [2 * BRICK_VISUAL_INSET, BRICK_COURSE_HEIGHT_CELLS * BRICK_VISUAL_INSET, BRICK_DEPTH_CELLS],
    });
  });

  it('handles horizontal and vertical 2x4 bricks', () => {
    const horizontal: Brick = { id: 'h', kind: '2x4', orientation: 'h', cell: { col: 4, row: 3 } };
    const vertical: Brick = { id: 'v', kind: '2x4', orientation: 'v', cell: { col: 4, row: 3 } };
    const horizontalTransform = brickTransform(horizontal, 12, 11);
    const verticalTransform = brickTransform(vertical, 12, 11);

    expect(horizontalTransform.position[0]).toBe(0);
    expect(horizontalTransform.position[1]).toBeCloseTo(2.4);
    expect(horizontalTransform.position[2]).toBe(0);
    expect(horizontalTransform.scale).toEqual([4 * BRICK_VISUAL_INSET, BRICK_COURSE_HEIGHT_CELLS * BRICK_VISUAL_INSET, BRICK_DEPTH_CELLS]);

    expect(verticalTransform.position[0]).toBe(-1);
    expect(verticalTransform.position[1]).toBeCloseTo(1.8);
    expect(verticalTransform.position[2]).toBe(0);
    expect(verticalTransform.scale).toEqual([2 * BRICK_VISUAL_INSET, 2 * BRICK_COURSE_HEIGHT_CELLS * BRICK_VISUAL_INSET, BRICK_DEPTH_CELLS]);
  });

  it('creates studs only on exposed top brick surfaces', () => {
    const set = tileShape(LEGO_PRESETS[0]);
    const topCells = set.cellMask.slice(0, set.cols).filter(Boolean).length;
    const studs = studPositions(set);
    expect(studs).toHaveLength(topCells * 2);
    expect(studs.length).toBeLessThan(maskCellCount(set) * 2);
    expect(Math.min(...studs.map((stud) => stud.position[1]))).toBeGreaterThan(5.9);
  });

  it('maps front and back face planes without pre-mirroring texture content', () => {
    expect(facePlaneTransform('front').rotation).toEqual([0, 0, 0]);
    expect(facePlaneTransform('back').rotation).toEqual([0, Math.PI, 0]);
    expect(facePlaneTransform('front').position[2]).toBeGreaterThan(0);
    expect(facePlaneTransform('back').position[2]).toBeLessThan(0);
  });

  it('normalizes large presets into a stable product-view scale', () => {
    expect(panelScale({ cols: 14, rows: 13 })).toBeCloseTo(10 / (13 * BRICK_COURSE_HEIGHT_CELLS));
  });
});
