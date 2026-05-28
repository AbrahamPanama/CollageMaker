import { describe, expect, it } from 'vitest';
import { assignPhotosToCells, generateCells } from './shapeCollage';
import type { Cell, Point, ViewBox } from './types';

const square: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

const squareBox: ViewBox = { x: 0, y: 0, w: 100, h: 100 };

describe('shape collage packing', () => {
  it('generates cells inside the shape bounds', () => {
    const cells = generateCells(square, squareBox, {
      targetCellSize: 50,
      minCellSize: 10,
    });

    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      expect(cell.x).toBeGreaterThanOrEqual(squareBox.x);
      expect(cell.y).toBeGreaterThanOrEqual(squareBox.y);
      expect(cell.x + cell.w).toBeLessThanOrEqual(squareBox.x + squareBox.w);
      expect(cell.y + cell.h).toBeLessThanOrEqual(squareBox.y + squareBox.h);
    }
  });

  it('assigns photos deterministically and keeps usage balanced', () => {
    const cells: Cell[] = [
      { x: 0, y: 0, w: 10, h: 10 },
      { x: 90, y: 0, w: 10, h: 10 },
      { x: 0, y: 90, w: 10, h: 10 },
      { x: 90, y: 90, w: 10, h: 10 },
    ];

    const first = assignPhotosToCells(cells, 2, 42);
    const second = assignPhotosToCells(cells, 2, 42);

    expect(first).toEqual(second);
    expect(first.every((idx) => idx === 0 || idx === 1)).toBe(true);
    expect(first.filter((idx) => idx === 0)).toHaveLength(2);
    expect(first.filter((idx) => idx === 1)).toHaveLength(2);
  });
});
