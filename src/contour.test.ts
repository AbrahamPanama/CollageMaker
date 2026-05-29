import { describe, expect, it } from 'vitest';
import {
  computeCellContour,
  computeShapeContour,
  contourLoopsToSvgPath,
} from './contour';
import type { Cell, Point } from './types';

const square: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

describe('shape contour geometry', () => {
  it('keeps the source shape exact when offset is zero', () => {
    const contour = computeShapeContour(square, 0);

    expect(contour.loops).toHaveLength(1);
    expect(contour.loops[0]).toEqual(square);
    expect(contour.bbox).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    expect(contour.path).toBe('M0 0L100 0L100 100L0 100Z');
  });

  it('expands and rounds the contour for a positive offset', () => {
    const contour = computeShapeContour(square, 10);

    expect(contour.loops).toHaveLength(1);
    expect(contour.loops[0].length).toBeGreaterThan(4);
    expect(contour.bbox.x).toBeCloseTo(-10, 1);
    expect(contour.bbox.y).toBeCloseTo(-10, 1);
    expect(contour.bbox.w).toBeCloseTo(120, 1);
    expect(contour.bbox.h).toBeCloseTo(120, 1);
  });

  it('expands outward even when the source winding is reversed', () => {
    const contour = computeShapeContour(square.slice().reverse(), 10);

    expect(contour.bbox.x).toBeCloseTo(-10, 1);
    expect(contour.bbox.y).toBeCloseTo(-10, 1);
    expect(contour.bbox.w).toBeCloseTo(120, 1);
    expect(contour.bbox.h).toBeCloseTo(120, 1);
  });

  it('contracts the contour for a negative offset', () => {
    const contour = computeShapeContour(square, -10);

    expect(contour.loops).toHaveLength(1);
    expect(contour.bbox.x).toBeCloseTo(10, 1);
    expect(contour.bbox.y).toBeCloseTo(10, 1);
    expect(contour.bbox.w).toBeCloseTo(80, 1);
    expect(contour.bbox.h).toBeCloseTo(80, 1);
  });

  it('scales loops into export-space SVG path data', () => {
    expect(contourLoopsToSvgPath([square], 2, 3)).toBe(
      'M0 0L200 0L200 300L0 300Z'
    );
  });
});

describe('cell contour geometry', () => {
  it('unions adjacent collage cells without internal edges', () => {
    const cells: Cell[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 10, y: 0, w: 10, h: 10 },
    ];

    const contour = computeCellContour(cells, 0);

    expect(contour.loops).toHaveLength(1);
    expect(contour.loops[0]).toHaveLength(4);
    expect(contour.bbox).toEqual({ x: 0, y: 0, w: 20, h: 10 });
    expect(Math.abs(loopArea(contour.loops[0]))).toBeCloseTo(200);
  });

  it('keeps stepped collage silhouettes clean and sparse', () => {
    const cells: Cell[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 10, y: 0, w: 10, h: 10 },
      { x: 0, y: 10, w: 10, h: 10 },
    ];

    const contour = computeCellContour(cells, 0);

    expect(contour.loops).toHaveLength(1);
    expect(contour.loops[0]).toHaveLength(6);
    expect(contour.bbox).toEqual({ x: 0, y: 0, w: 20, h: 20 });
    expect(Math.abs(loopArea(contour.loops[0]))).toBeCloseTo(300);
  });

  it('offsets stepped cell contours with mitered corners', () => {
    const cells: Cell[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 10, y: 0, w: 10, h: 10 },
      { x: 0, y: 10, w: 10, h: 10 },
    ];

    const contour = computeCellContour(cells, 5);

    expect(contour.loops).toHaveLength(1);
    expect(contour.bbox.x).toBeCloseTo(-5);
    expect(contour.bbox.y).toBeCloseTo(-5);
    expect(contour.bbox.w).toBeCloseTo(30);
    expect(contour.bbox.h).toBeCloseTo(30);
  });
});

function loopArea(points: Point[]): number {
  let area = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}
