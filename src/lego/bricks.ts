import type { Brick, BrickKind, Orientation } from './types';

export const BRICK_KINDS: BrickKind[] = ['2x4', '2x3', '2x2', '1x2'];

export const BRICK_LABELS: Record<BrickKind, string> = {
  '2x4': '2x4',
  '2x3': '2x3',
  '2x2': '2x2',
  '1x2': '1x2',
};

const HORIZONTAL_STUD_WIDTH: Record<BrickKind, number> = {
  '2x4': 4,
  '2x3': 3,
  '2x2': 2,
  '1x2': 1,
};

export function brickSize(kind: BrickKind, orientation: Orientation = 'h') {
  if (orientation === 'h') return { cols: HORIZONTAL_STUD_WIDTH[kind], rows: 1 };
  if (kind === '2x4') return { cols: 2, rows: 2 };
  return { cols: HORIZONTAL_STUD_WIDTH[kind], rows: 1 };
}

export function brickCellCount(brick: Pick<Brick, 'kind' | 'orientation'>) {
  const size = brickSize(brick.kind, brick.orientation);
  return size.cols * size.rows;
}
