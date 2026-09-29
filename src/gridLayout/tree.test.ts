import { describe, expect, it } from 'vitest';
import { layoutTree, makeSplit, naturalAspect } from './tree';
import type { LayoutTree } from './types';

const leaf = (photoId: string, aspect: number): LayoutTree => ({ type: 'leaf', photoId, aspect });

describe('grid layout tree', () => {
  it('composes natural aspect with H and V laws', () => {
    const h = makeSplit('H', leaf('a', 2), leaf('b', 1));
    const v = makeSplit('V', leaf('a', 2), leaf('b', 1));

    expect(naturalAspect(h)).toBeCloseTo(3, 6);
    expect(naturalAspect(v)).toBeCloseTo(1 / (1 / 2 + 1 / 1), 6);
  });

  it('lays leaves into a full non-overlapping unit partition', () => {
    const tree = makeSplit(
      'H',
      leaf('a', 1),
      makeSplit('V', leaf('b', 1), leaf('c', 1))
    );
    const cells = layoutTree(tree);

    expect(cells).toHaveLength(3);
    expect(cells.reduce((sum, cell) => sum + cell.rect.w * cell.rect.h, 0)).toBeCloseTo(1, 6);
    for (let i = 0; i < cells.length; i++) {
      for (let j = i + 1; j < cells.length; j++) {
        const x = Math.max(0, Math.min(cells[i].rect.x + cells[i].rect.w, cells[j].rect.x + cells[j].rect.w) - Math.max(cells[i].rect.x, cells[j].rect.x));
        const y = Math.max(0, Math.min(cells[i].rect.y + cells[i].rect.h, cells[j].rect.y + cells[j].rect.h) - Math.max(cells[i].rect.y, cells[j].rect.y));
        expect(x * y).toBeCloseTo(0, 6);
      }
    }
  });
});
