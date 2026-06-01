import { describe, expect, it } from 'vitest';
import {
  isSafeUserShapeData,
  normalizeUserShapeGeometries,
  sanitizeUserShapes,
} from './userShapes';

describe('user shape persistence', () => {
  it('keeps valid saved SVG paths and normalizes their viewBox', () => {
    expect(
      sanitizeUserShapes([
        {
          id: 'user-papa',
          name: ' PAPA ',
          d: 'M0 0 L10 0 L10 10 L0 10 Z',
          viewBox: '0, 0, 10, 10',
        },
      ])
    ).toEqual([
      {
        id: 'user-papa',
        name: 'PAPA',
        d: 'M0 0 L10 0 L10 10 L0 10 Z',
        viewBox: '0 0 10 10',
      },
    ]);
  });

  it('drops malformed saved shapes before they can render at startup', () => {
    expect(
      sanitizeUserShapes([
        {
          id: 'bad-path',
          name: 'Bad',
          d: 'M0 0"><script>alert(1)</script>',
          viewBox: '0 0 10 10',
        },
        {
          id: 'bad-viewbox',
          name: 'Flat',
          d: 'M0 0 L10 0 L10 10 Z',
          viewBox: '0 0 0 10',
        },
      ])
    ).toEqual([]);
  });

  it('normalizes custom SVG scale from path bounds without DOM measurement', () => {
    expect(
      normalizeUserShapeGeometries([
        {
          id: 'small-heart',
          name: 'Heart',
          d: 'M163.6 201.29 L436.4 201.29 L436.4 419.87 L163.6 419.87 Z',
          viewBox: '0 0 600 600',
        },
      ])
    ).toEqual([
      {
        id: 'small-heart',
        name: 'Heart',
        d: 'M163.6 201.29 L436.4 201.29 L436.4 419.87 L163.6 419.87 Z',
        viewBox: '163.6 201.29 272.8 218.58',
      },
    ]);
  });

  it('rejects custom paths with too many nodes', () => {
    const giantPath = `M0 0 ${Array.from({ length: 5000 }, (_, i) => `L${i} ${i}`).join(' ')}`;
    expect(isSafeUserShapeData(giantPath, '0 0 100 100')).toBe(false);
  });

  it('accepts uppercase scientific notation in path coordinates', () => {
    expect(isSafeUserShapeData('M1E2 0 L2E2 0 L2E2 1E2 Z', '0 0 200 100')).toBe(true);
  });

  it('rejects closepath commands with stray operands', () => {
    expect(isSafeUserShapeData('M0 0 L10 0 L10 10 Z 1', '0 0 10 10')).toBe(false);
  });
});
