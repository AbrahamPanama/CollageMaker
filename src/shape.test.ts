import { describe, expect, it } from 'vitest';
import { boundsFromPoints, formatViewBox } from './shape';

describe('shape geometry helpers', () => {
  it('builds a normalized viewBox from actual point bounds', () => {
    const bounds = boundsFromPoints([
      { x: 163.6, y: 201.29 },
      { x: 436.4, y: 419.87 },
      { x: 300, y: 265.24 },
    ]);

    expect(formatViewBox(bounds)).toBe('163.6 201.29 272.8 218.58');
  });

  it('rejects flat or invalid bounds', () => {
    expect(() =>
      boundsFromPoints([
        { x: 1, y: 1 },
        { x: 1, y: 1 },
      ])
    ).toThrow();
  });
});
