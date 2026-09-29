import type { Brick, Cell, Face, LegoSet } from './types';
import { brickSize } from './bricks';

export function mirrorCellX(cols: number, cell: Cell): Cell {
  return { col: cols - 1 - cell.col, row: cell.row };
}

export function mirrorBrickForBack(set: LegoSet, brick: Brick): Brick {
  if (brick.orientation === 'h') {
    const width = brickSize(brick.kind, brick.orientation).cols;
    return {
      ...brick,
      cell: { col: set.cols - brick.cell.col - width, row: brick.cell.row },
    };
  }

  return {
    ...brick,
    cell: mirrorCellX(set.cols, brick.cell),
  };
}

export function bricksForFace(set: LegoSet, face: Face): Brick[] {
  return face === 'front' ? set.bricks : set.bricks.map((brick) => mirrorBrickForBack(set, brick));
}

export function faceLabel(face: Face) {
  return face === 'front' ? 'Front' : 'Back';
}
