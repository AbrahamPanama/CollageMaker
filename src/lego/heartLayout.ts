import { brickSize } from './bricks';
import type { BrickKind } from './types';

export type HeartLayoutBrick = {
  col: number;
  kind: BrickKind;
};

export const HEART_COLS = 15;
export const HEART_ROWS = 10;
export const HEART_ALLOWED_BRICK_KINDS = new Set<BrickKind>(['2x3', '1x2']);

export const HEART_LAYOUT: HeartLayoutBrick[][] = [
  [
    { col: 2, kind: '2x3' },
    { col: 10, kind: '2x3' },
  ],
  [
    { col: 1, kind: '2x3' },
    { col: 4, kind: '2x3' },
    { col: 8, kind: '2x3' },
    { col: 11, kind: '2x3' },
  ],
  [
    { col: 0, kind: '2x3' },
    { col: 3, kind: '2x3' },
    { col: 6, kind: '2x3' },
    { col: 9, kind: '2x3' },
    { col: 12, kind: '2x3' },
  ],
  [
    { col: 0, kind: '2x3' },
    { col: 3, kind: '2x3' },
    { col: 6, kind: '2x3' },
    { col: 9, kind: '2x3' },
    { col: 12, kind: '2x3' },
  ],
  [
    { col: 0, kind: '2x3' },
    { col: 3, kind: '2x3' },
    { col: 6, kind: '2x3' },
    { col: 9, kind: '2x3' },
    { col: 12, kind: '2x3' },
  ],
  [
    { col: 1, kind: '2x3' },
    { col: 4, kind: '2x3' },
    { col: 7, kind: '1x2' },
    { col: 8, kind: '2x3' },
    { col: 11, kind: '2x3' },
  ],
  [
    { col: 2, kind: '2x3' },
    { col: 5, kind: '1x2' },
    { col: 6, kind: '2x3' },
    { col: 9, kind: '1x2' },
    { col: 10, kind: '2x3' },
  ],
  [
    { col: 3, kind: '2x3' },
    { col: 6, kind: '2x3' },
    { col: 9, kind: '2x3' },
  ],
  [
    { col: 4, kind: '2x3' },
    { col: 7, kind: '1x2' },
    { col: 8, kind: '2x3' },
  ],
  [{ col: 6, kind: '2x3' }],
];

export function makeHeartCellMask() {
  const mask = Array.from({ length: HEART_COLS * HEART_ROWS }, () => false);
  for (let row = 0; row < HEART_LAYOUT.length; row++) {
    for (const brick of HEART_LAYOUT[row]) {
      const size = brickSize(brick.kind, 'h');
      for (let offset = 0; offset < size.cols; offset++) {
        mask[row * HEART_COLS + brick.col + offset] = true;
      }
    }
  }
  return mask;
}
