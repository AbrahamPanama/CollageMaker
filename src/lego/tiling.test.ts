import { describe, expect, it } from 'vitest';
import { brickCellCount } from './bricks';
import { HEART_ALLOWED_BRICK_KINDS } from './heartLayout';
import { LEGO_PRESETS, maskCellCount } from './shapes';
import { billOfMaterials, mergeBricks, rotateBrick, splitBrick, tileShape, validateTiling } from './tiling';

describe('lego tiling', () => {
  it('tiles every preset deterministically and validly', () => {
    for (const shape of LEGO_PRESETS) {
      const first = tileShape(shape);
      const second = tileShape(shape);

      expect(validateTiling(first)).toBe(true);
      expect(first).toEqual(second);
      expect(
        first.bricks.reduce((sum, brick) => sum + brickCellCount(brick), 0)
      ).toBe(maskCellCount(shape));
    }
  });

  it('hits the rectangular SKU piece counts', () => {
    expect(tileShape(LEGO_PRESETS[0]).pieceCount).toBe(33);
    expect(tileShape(LEGO_PRESETS[1]).pieceCount).toBe(42);
    expect(tileShape(LEGO_PRESETS[2]).pieceCount).toBe(52);
  });

  it('uses the physical staggered wall layout for the 33 piece preset', () => {
    const set = tileShape(LEGO_PRESETS[0]);
    const bom = billOfMaterials(set);

    expect(set.cols).toBe(10);
    expect(set.rows).toBe(11);
    expect(bom.twoByFour).toBe(22);
    expect(bom.twoByTwo).toBe(11);
    expect(validateTiling(set)).toBe(true);

    for (let row = 0; row < set.rows; row++) {
      const rowBricks = set.bricks.filter((brick) => brick.cell.row === row);
      const mono = rowBricks.filter((brick) => brick.kind === '2x2');
      const dominoes = rowBricks.filter((brick) => brick.kind === '2x4');

      expect(rowBricks).toHaveLength(3);
      expect(mono).toHaveLength(1);
      expect(dominoes).toHaveLength(2);
      expect(mono[0].cell.col).toBe(row % 2 === 0 ? 0 : 8);
      expect(dominoes.map((brick) => brick.cell.col)).toEqual(row % 2 === 0 ? [2, 6] : [0, 4]);
      expect(dominoes.every((brick) => brick.orientation === 'h')).toBe(true);
    }
  });

  it('uses the physical edge-cap wall layout for the 42 piece preset', () => {
    const set = tileShape(LEGO_PRESETS[1]);
    const bom = billOfMaterials(set);

    expect(set.cols).toBe(12);
    expect(set.rows).toBe(12);
    expect(bom.twoByFour).toBe(30);
    expect(bom.twoByTwo).toBe(12);
    expect(validateTiling(set)).toBe(true);

    for (let row = 0; row < set.rows; row++) {
      const rowBricks = set.bricks.filter((brick) => brick.cell.row === row);
      const mono = rowBricks.filter((brick) => brick.kind === '2x2');
      const dominoes = rowBricks.filter((brick) => brick.kind === '2x4');

      if (row % 2 === 0) {
        expect(rowBricks).toHaveLength(4);
        expect(mono.map((brick) => brick.cell.col)).toEqual([0, 10]);
        expect(dominoes.map((brick) => brick.cell.col)).toEqual([2, 6]);
      } else {
        expect(rowBricks).toHaveLength(3);
        expect(mono).toHaveLength(0);
        expect(dominoes.map((brick) => brick.cell.col)).toEqual([0, 4, 8]);
      }
      expect(dominoes.every((brick) => brick.orientation === 'h')).toBe(true);
    }
  });

  it('uses the physical staggered wall layout for the 52 piece preset', () => {
    const set = tileShape(LEGO_PRESETS[2]);
    const bom = billOfMaterials(set);

    expect(set.cols).toBe(14);
    expect(set.rows).toBe(13);
    expect(bom.twoByFour).toBe(39);
    expect(bom.twoByTwo).toBe(13);
    expect(validateTiling(set)).toBe(true);

    for (let row = 0; row < set.rows; row++) {
      const rowBricks = set.bricks.filter((brick) => brick.cell.row === row);
      const mono = rowBricks.filter((brick) => brick.kind === '2x2');
      const dominoes = rowBricks.filter((brick) => brick.kind === '2x4');

      expect(rowBricks).toHaveLength(4);
      expect(mono).toHaveLength(1);
      expect(dominoes).toHaveLength(3);
      expect(mono[0].cell.col).toBe(row % 2 === 0 ? 12 : 0);
      expect(dominoes.map((brick) => brick.cell.col)).toEqual(row % 2 === 0 ? [0, 4, 8] : [2, 6, 10]);
      expect(dominoes.every((brick) => brick.orientation === 'h')).toBe(true);
    }
  });

  it('uses the physical mixed-piece heart layout', () => {
    const set = tileShape(LEGO_PRESETS[3]);
    const bom = billOfMaterials(set);

    expect(set.cols).toBe(15);
    expect(set.rows).toBe(10);
    expect(bom.twoByFour).toBe(0);
    expect(bom.twoByThree).toBe(34);
    expect(bom.twoByTwo).toBe(0);
    expect(bom.oneByTwo).toBe(4);
    expect(bom.total).toBe(38);
    expect(set.bricks.every((brick) => HEART_ALLOWED_BRICK_KINDS.has(brick.kind))).toBe(true);
    expect(validateTiling(set)).toBe(true);
  });

  it('splits and merges a 2x4 brick', () => {
    const set = tileShape(LEGO_PRESETS[0]);
    const initialBom = billOfMaterials(set);
    const brick = set.bricks.find((candidate) => candidate.kind === '2x4');
    expect(brick).toBeTruthy();

    const split = splitBrick(set, brick!.id);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    expect(validateTiling(split.set)).toBe(true);
    expect(billOfMaterials(split.set).twoByTwo).toBe(initialBom.twoByTwo + 2);

    const monos = split.set.bricks.filter((candidate) => candidate.kind === '2x2');
    const merged = mergeBricks(split.set, monos[0].id, monos[1].id);
    expect(merged.ok).toBe(true);
    if (merged.ok) expect(validateTiling(merged.set)).toBe(true);
  });

  it('rejects invalid rotation but accepts clear valid edits', () => {
    const set = tileShape(LEGO_PRESETS[0]);
    const topBrick = set.bricks.find((brick) => brick.kind === '2x4' && brick.cell.row === 0);
    expect(topBrick).toBeTruthy();
    const rejected = rotateBrick(set, topBrick!.id);
    expect(rejected.ok).toBe(false);

    const split = splitBrick(set, topBrick!.id);
    expect(split.ok).toBe(true);
    if (!split.ok) return;
    const monos = split.set.bricks.filter((brick) => brick.kind === '2x2');
    const vertical = mergeBricks(split.set, monos[0].id, split.set.bricks.find((brick) => brick.cell.col === monos[0].cell.col && brick.cell.row === monos[0].cell.row + 1 && brick.kind === '2x4')?.id ?? '');
    expect(vertical.ok).toBe(false);
  });
});
