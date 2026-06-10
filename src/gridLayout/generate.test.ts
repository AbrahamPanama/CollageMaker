import { describe, expect, it } from 'vitest';
import { generateLayouts, layoutFromTree } from './generate';
import type { PhotoMeta } from './types';

const metas: PhotoMeta[] = Array.from({ length: 8 }, (_, index) => ({
  id: `p${index + 1}`,
  aspect: index % 3 === 0 ? 1.6 : index % 3 === 1 ? 0.75 : 1,
  subject: index % 2 === 0 ? { x: 0.25, y: 0.25, w: 0.35, h: 0.35, source: 'face' } : null,
}));

describe('grid layout generation', () => {
  it('is deterministic for identical inputs and seed', () => {
    const a = generateLayouts(metas, 1, { topK: 5 }, 1234);
    const b = generateLayouts(metas, 1, { topK: 5 }, 1234);

    expect(a).toEqual(b);
  });

  it('respects topK and handles degenerate counts', () => {
    expect(generateLayouts([], 1, {}, 1)).toEqual([]);
    expect(generateLayouts(metas.slice(0, 1), 1, {}, 1)).toHaveLength(1);
    expect(generateLayouts(metas, 1, { topK: 3 }, 99)).toHaveLength(3);
  });

  it('reuses the same tree for another aspect without changing assignments', () => {
    const selected = generateLayouts(metas.slice(0, 5), 1, { topK: 1 }, 8)[0];
    const tall = layoutFromTree(selected.tree, metas.slice(0, 5), 9 / 16, {}, 'tall');

    expect(tall?.cells.map((cell) => cell.photoId)).toEqual(selected.cells.map((cell) => cell.photoId));
    expect(tall?.tree).toEqual(selected.tree);
  });
});
