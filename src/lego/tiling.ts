import { isMasked } from './shapes';
import { BRICK_KINDS, brickSize } from './bricks';
import { HEART_LAYOUT } from './heartLayout';
import type { BillOfMaterials, Brick, BrickKind, Cell, LegoSet, LegoShape, Orientation, TilingResult } from './types';

export function tileShape(shape: LegoShape): LegoSet {
  if (shape.id === 'rect-33') {
    return makeSet(shape, makeStaggeredWallBricks(shape, 'left'));
  }

  if (shape.id === 'rect-42') {
    return makeSet(shape, makeEdgeCapWallBricks(shape));
  }

  if (shape.id === 'rect-52') {
    return makeSet(shape, makeStaggeredWallBricks(shape, 'right'));
  }

  if (shape.id === 'heart') {
    return makeSet(shape, makeHeartWallBricks(shape));
  }

  const occupied = new Set<string>();
  const bricks: Brick[] = [];

  for (let row = 0; row < shape.rows; row++) {
    for (let col = 0; col < shape.cols; col++) {
      if (!canOccupy(shape, occupied, col, row)) continue;
      if (canOccupyBrick(shape, occupied, '2x4', col, row, 'h')) {
        addBrick(bricks, occupied, '2x4', col, row, 'h');
      }
    }
  }

  for (let row = 0; row < shape.rows; row++) {
    for (let col = 0; col < shape.cols; col++) {
      if (!canOccupy(shape, occupied, col, row)) continue;
      if (canOccupyBrick(shape, occupied, '2x4', col, row, 'v')) {
        addBrick(bricks, occupied, '2x4', col, row, 'v');
      }
    }
  }

  for (let row = 0; row < shape.rows; row++) {
    for (let col = 0; col < shape.cols; col++) {
      if (!canOccupy(shape, occupied, col, row)) continue;
      if (canOccupyBrick(shape, occupied, '2x2', col, row, 'h')) {
        addBrick(bricks, occupied, '2x2', col, row, 'h');
      } else if (canOccupyBrick(shape, occupied, '1x2', col, row, 'h')) {
        addBrick(bricks, occupied, '1x2', col, row, 'h');
      }
    }
  }

  return makeSet(shape, bricks);
}

export function splitBrick(set: LegoSet, brickIdValue: string): TilingResult {
  const brick = set.bricks.find((candidate) => candidate.id === brickIdValue);
  if (!brick) return { ok: false, reason: 'Brick not found' };
  if (brick.kind !== '2x4') return { ok: false, reason: 'Only 2x4 bricks can be split' };

  const splitCells =
    brick.orientation === 'h'
      ? [
          { col: brick.cell.col, row: brick.cell.row },
          { col: brick.cell.col + 2, row: brick.cell.row },
        ]
      : [
          { col: brick.cell.col, row: brick.cell.row },
          { col: brick.cell.col, row: brick.cell.row + 1 },
        ];
  const next = set.bricks
    .filter((candidate) => candidate.id !== brick.id)
    .concat(splitCells.map((cell) => makeBrick('2x2', cell.col, cell.row, 'h')));
  return validateAndWrap(set, sortBricks(next));
}

export function mergeBricks(set: LegoSet, firstId: string, secondId: string): TilingResult {
  const first = set.bricks.find((brick) => brick.id === firstId);
  const second = set.bricks.find((brick) => brick.id === secondId);
  if (!first || !second) return { ok: false, reason: 'Select two bricks to merge' };
  if (first.kind !== '2x2' || second.kind !== '2x2') {
    return { ok: false, reason: 'Only adjacent 2x2 bricks can be merged' };
  }

  const cells = [first.cell, second.cell].sort(compareCells);
  const sameRow = cells[0].row === cells[1].row && Math.abs(cells[0].col - cells[1].col) === 2;
  const sameCol = cells[0].col === cells[1].col && Math.abs(cells[0].row - cells[1].row) === 1;
  if (!sameRow && !sameCol) return { ok: false, reason: '2x2 bricks must share an edge' };

  const orientation: Orientation = sameRow ? 'h' : 'v';
  const cell = cells[0];
  const merged: Brick = { id: brickId('domino', cell.col, cell.row, orientation), kind: '2x4', orientation, cell };
  const next = set.bricks.filter((brick) => brick.id !== first.id && brick.id !== second.id).concat(merged);
  return validateAndWrap(set, sortBricks(next));
}

export function rotateBrick(set: LegoSet, brickIdValue: string): TilingResult {
  const brick = set.bricks.find((candidate) => candidate.id === brickIdValue);
  if (!brick) return { ok: false, reason: 'Brick not found' };
  if (brick.kind !== '2x4') return { ok: false, reason: 'Only 2x4 bricks can be rotated' };

  const nextOrientation: Orientation = brick.orientation === 'h' ? 'v' : 'h';
  const rotated: Brick = {
    ...brick,
    id: brickId('domino', brick.cell.col, brick.cell.row, nextOrientation),
    orientation: nextOrientation,
  };
  const next = set.bricks.map((candidate) => (candidate.id === brick.id ? rotated : candidate));
  return validateAndWrap(set, sortBricks(next));
}

export function validateTiling(set: LegoSet): boolean {
  const covered = new Set<string>();
  for (const brick of set.bricks) {
    for (const cell of footprint(brick)) {
      if (!isMasked(set, cell.col, cell.row)) return false;
      const key = cellKey(cell.col, cell.row);
      if (covered.has(key)) return false;
      covered.add(key);
    }
  }

  for (let row = 0; row < set.rows; row++) {
    for (let col = 0; col < set.cols; col++) {
      if (isMasked(set, col, row) && !covered.has(cellKey(col, row))) return false;
      if (!isMasked(set, col, row) && covered.has(cellKey(col, row))) return false;
    }
  }
  return true;
}

export function footprint(brick: Brick): Cell[] {
  const size = brickSize(brick.kind, brick.orientation);
  const cells: Cell[] = [];
  for (let rowOffset = 0; rowOffset < size.rows; rowOffset++) {
    for (let colOffset = 0; colOffset < size.cols; colOffset++) {
      cells.push({ col: brick.cell.col + colOffset, row: brick.cell.row + rowOffset });
    }
  }
  return cells;
}

export function billOfMaterials(set: LegoSet): BillOfMaterials {
  const byKind = Object.fromEntries(BRICK_KINDS.map((kind) => [kind, 0])) as Record<BrickKind, number>;
  for (const brick of set.bricks) byKind[brick.kind] += 1;
  return {
    total: set.bricks.length,
    byKind,
    twoByFour: byKind['2x4'],
    twoByThree: byKind['2x3'],
    twoByTwo: byKind['2x2'],
    oneByTwo: byKind['1x2'],
  };
}

export function monominoRatio(set: LegoSet) {
  if (set.bricks.length === 0) return 0;
  const bom = billOfMaterials(set);
  return (bom.twoByTwo + bom.oneByTwo) / set.bricks.length;
}

function validateAndWrap(source: LegoSet, bricks: Brick[]): TilingResult {
  const set = makeSet(source, bricks);
  return validateTiling(set) ? { ok: true, set } : { ok: false, reason: 'That edit would break the tiling' };
}

function makeStaggeredWallBricks(shape: LegoShape, firstRowMonomino: 'left' | 'right') {
  const bricks: Brick[] = [];
  for (let row = 0; row < shape.rows; row++) {
    const monominoOnLeft = row % 2 === 0 ? firstRowMonomino === 'left' : firstRowMonomino === 'right';
    const monominoCol = monominoOnLeft ? 0 : shape.cols - 2;
    const startCol = monominoOnLeft ? 2 : 0;

    for (let col = startCol; col + 3 < shape.cols; col += 4) {
      if (canOccupyFixedBrick(shape, '2x4', col, row, 'h')) {
        bricks.push(makeBrick('2x4', col, row, 'h'));
      }
    }

    if (canOccupyFixedBrick(shape, '2x2', monominoCol, row, 'h')) {
      bricks.push(makeBrick('2x2', monominoCol, row, 'h'));
    }
  }
  return bricks;
}

function makeEdgeCapWallBricks(shape: LegoShape) {
  const bricks: Brick[] = [];
  for (let row = 0; row < shape.rows; row++) {
    if (row % 2 === 0) {
      if (canOccupyFixedBrick(shape, '2x2', 0, row, 'h')) {
        bricks.push(makeBrick('2x2', 0, row, 'h'));
      }
      if (canOccupyFixedBrick(shape, '2x2', shape.cols - 2, row, 'h')) {
        bricks.push(makeBrick('2x2', shape.cols - 2, row, 'h'));
      }
      for (let col = 2; col + 3 < shape.cols - 2; col += 4) {
        if (canOccupyFixedBrick(shape, '2x4', col, row, 'h')) {
          bricks.push(makeBrick('2x4', col, row, 'h'));
        }
      }
    } else {
      for (let col = 0; col + 3 < shape.cols; col += 4) {
        if (canOccupyFixedBrick(shape, '2x4', col, row, 'h')) {
          bricks.push(makeBrick('2x4', col, row, 'h'));
        }
      }
    }
  }
  return bricks;
}

function makeHeartWallBricks(shape: LegoShape) {
  const bricks: Brick[] = [];
  for (let row = 0; row < HEART_LAYOUT.length; row++) {
    for (const brick of HEART_LAYOUT[row]) {
      if (canOccupyFixedBrick(shape, brick.kind, brick.col, row, 'h')) {
        bricks.push(makeBrick(brick.kind, brick.col, row, 'h'));
      }
    }
  }
  return bricks;
}

function makeSet(shape: Pick<LegoSet, 'shapeId' | 'cols' | 'rows' | 'cellMask'> | LegoShape, bricks: Brick[]): LegoSet {
  return {
    shapeId: 'id' in shape ? shape.id : shape.shapeId,
    cols: shape.cols,
    rows: shape.rows,
    cellMask: shape.cellMask.slice(),
    bricks: sortBricks(bricks),
    pieceCount: bricks.length,
  };
}

function addBrick(bricks: Brick[], occupied: Set<string>, kind: BrickKind, col: number, row: number, orientation: Orientation) {
  const brick = makeBrick(kind, col, row, orientation);
  bricks.push(brick);
  for (const cell of footprint(brick)) occupied.add(cellKey(cell.col, cell.row));
}

function canOccupy(shape: LegoShape, occupied: Set<string>, col: number, row: number) {
  return isMasked(shape, col, row) && !occupied.has(cellKey(col, row));
}

function canOccupyBrick(shape: LegoShape, occupied: Set<string>, kind: BrickKind, col: number, row: number, orientation: Orientation) {
  return footprint(makeBrick(kind, col, row, orientation)).every(
    (cell) => isMasked(shape, cell.col, cell.row) && !occupied.has(cellKey(cell.col, cell.row))
  );
}

function canOccupyFixedBrick(shape: LegoShape, kind: BrickKind, col: number, row: number, orientation: Orientation) {
  return footprint(makeBrick(kind, col, row, orientation)).every((cell) => isMasked(shape, cell.col, cell.row));
}

function sortBricks(bricks: Brick[]) {
  return bricks.slice().sort((a, b) => compareCells(a.cell, b.cell) || a.kind.localeCompare(b.kind));
}

function compareCells(a: Cell, b: Cell) {
  return a.row - b.row || a.col - b.col;
}

function brickId(prefix: string, col: number, row: number, orientation = 'h') {
  return `${prefix}-${col}-${row}-${orientation}`;
}

function makeBrick(kind: BrickKind, col: number, row: number, orientation: Orientation): Brick {
  return {
    id: brickId(kind, col, row, orientation),
    kind,
    orientation,
    cell: { col, row },
  };
}

function cellKey(col: number, row: number) {
  return `${col},${row}`;
}
