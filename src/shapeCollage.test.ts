import { describe, expect, it } from 'vitest';
import { assignPhotosToCells, generateCells } from './shapeCollage';
import { pointInPolygon } from './shape';
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

  it('uses fine boundary cells to preserve a curved silhouette', () => {
    const radius = 46;
    const center = 50;
    const circle = Array.from({ length: 720 }, (_, index) => {
      const angle = (index / 720) * Math.PI * 2;
      return {
        x: center + Math.cos(angle) * radius,
        y: center + Math.sin(angle) * radius,
      };
    });
    const cells = generateCells(circle, { x: 4, y: 4, w: 92, h: 92 }, {
      targetCellSize: 48,
      minCellSize: 12,
    });

    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) {
      const cellCenterX = cell.x + cell.w / 2;
      const cellCenterY = cell.y + cell.h / 2;
      expect(pointInPolygon(cellCenterX, cellCenterY, circle)).toBe(true);
    }

    const topY = Math.min(...cells.map((cell) => cell.y));
    expect(topY - (center - radius)).toBeLessThanOrEqual(6);
    const topCells = cells.filter((cell) => Math.abs(cell.y - topY) < 0.001);
    const plateau =
      Math.max(...topCells.map((cell) => cell.x + cell.w)) -
      Math.min(...topCells.map((cell) => cell.x));
    expect(plateau).toBeLessThan(radius * 0.8);
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

  it('protects the largest cells from repeated placements', () => {
    const cells: Cell[] = [
      { x: 0, y: 0, w: 40, h: 40 },
      { x: 40, y: 0, w: 30, h: 30 },
      { x: 70, y: 0, w: 20, h: 20 },
      { x: 90, y: 0, w: 15, h: 15 },
      { x: 105, y: 0, w: 10, h: 10 },
      { x: 115, y: 0, w: 5, h: 5 },
    ];

    const assignments = assignPhotosToCells(cells, 4, 9);
    const largestAssignments = assignments.slice(0, 4);

    expect(new Set(largestAssignments).size).toBe(4);
    expect(assignments[4]).toBeGreaterThanOrEqual(0);
    expect(assignments[5]).toBeGreaterThanOrEqual(0);
  });

  it('uses every cell only once when enough photos are available', () => {
    const cells: Cell[] = [
      { x: 0, y: 0, w: 20, h: 20 },
      { x: 20, y: 0, w: 10, h: 10 },
      { x: 30, y: 0, w: 5, h: 5 },
    ];

    const assignments = assignPhotosToCells(cells, 5, 4);
    expect(new Set(assignments).size).toBe(cells.length);
  });

  it('balances reuse and keeps repeated copies from touching when possible', () => {
    const cells: Cell[] = Array.from({ length: 9 }, (_, index) => ({
      x: index * 10,
      y: 0,
      w: 10,
      h: 10,
    }));

    const assignments = assignPhotosToCells(cells, 3, 17);
    const usage = [0, 0, 0];
    assignments.forEach((photo) => usage[photo]++);

    expect(usage).toEqual([3, 3, 3]);
    for (let i = 1; i < assignments.length; i++) {
      expect(assignments[i]).not.toBe(assignments[i - 1]);
    }
    for (let photo = 0; photo < 3; photo++) {
      const positions = assignments
        .map((assignment, index) => (assignment === photo ? index : -1))
        .filter((index) => index >= 0);
      for (let i = 1; i < positions.length; i++) {
        expect(positions[i] - positions[i - 1]).toBeGreaterThanOrEqual(2);
      }
    }
  });
});
