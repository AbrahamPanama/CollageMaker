import type { LegoShape } from './types';
import { HEART_COLS, HEART_ROWS, makeHeartCellMask } from './heartLayout';

export const LEGO_PRESETS: LegoShape[] = [
  makeRectShape('rect-33', 'Portrait 33', 10, 11),
  makeRectShape('rect-42', 'Portrait 42', 12, 12),
  makeRectShape('rect-52', 'Portrait 52', 14, 13),
  makeHeartShape('heart', 'Heart', HEART_COLS, HEART_ROWS),
];

export function getLegoShape(id: string): LegoShape {
  return LEGO_PRESETS.find((shape) => shape.id === id) ?? LEGO_PRESETS[0];
}

export function makeRectShape(id: string, name: string, cols: number, rows: number): LegoShape {
  return {
    id,
    name,
    cols,
    rows,
    cellMask: Array.from({ length: cols * rows }, () => true),
  };
}

export function makeHeartShape(id: string, name: string, _cols = HEART_COLS, _rows = HEART_ROWS): LegoShape {
  return { id, name, cols: HEART_COLS, rows: HEART_ROWS, cellMask: makeHeartCellMask() };
}

export function isMasked(shape: Pick<LegoShape, 'cols' | 'rows' | 'cellMask'>, col: number, row: number) {
  if (col < 0 || row < 0 || col >= shape.cols || row >= shape.rows) return false;
  return Boolean(shape.cellMask[row * shape.cols + col]);
}

export function maskCellCount(shape: Pick<LegoShape, 'cellMask'>) {
  return shape.cellMask.filter(Boolean).length;
}
