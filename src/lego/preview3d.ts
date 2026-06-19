import { BRICK_HEIGHT_MM, CELL_SIZE_MM, STUD_DIAMETER_MM, STUD_HEIGHT_MM } from './units';
import { footprint } from './tiling';
import type { Brick, Face, LegoSet } from './types';

export const PANEL_UNITS = 10;
export const BRICK_COURSE_HEIGHT_CELLS = BRICK_HEIGHT_MM / CELL_SIZE_MM;
export const BRICK_DEPTH_CELLS = 2;
export const STUD_RADIUS_CELLS = STUD_DIAMETER_MM / 2 / CELL_SIZE_MM;
export const STUD_HEIGHT_CELLS = STUD_HEIGHT_MM / CELL_SIZE_MM;
export const FACE_EPSILON_CELLS = 0.012;
export const BRICK_VISUAL_INSET = 0.97;

export type Vec3 = [number, number, number];

export type BrickTransform = {
  position: Vec3;
  scale: Vec3;
};

export type StudPosition = {
  position: Vec3;
  cell: { col: number; row: number };
};

export function panelDimensions(set: Pick<LegoSet, 'cols' | 'rows'>) {
  return {
    width: set.cols,
    height: set.rows * BRICK_COURSE_HEIGHT_CELLS,
    depth: BRICK_DEPTH_CELLS,
  };
}

export function panelScale(set: Pick<LegoSet, 'cols' | 'rows'>) {
  const size = panelDimensions(set);
  return PANEL_UNITS / Math.max(1, size.width, size.height);
}

export function brickTransform(
  brick: Brick,
  cols: number,
  rows: number,
  depth = BRICK_DEPTH_CELLS,
  inset = BRICK_VISUAL_INSET
): BrickTransform {
  const cells = footprint(brick);
  const minCol = Math.min(...cells.map((cell) => cell.col));
  const minRow = Math.min(...cells.map((cell) => cell.row));
  const maxCol = Math.max(...cells.map((cell) => cell.col));
  const maxRow = Math.max(...cells.map((cell) => cell.row));
  const w = maxCol - minCol + 1;
  const h = maxRow - minRow + 1;
  const panelH = rows * BRICK_COURSE_HEIGHT_CELLS;

  return {
    position: [
      minCol + w / 2 - cols / 2,
      panelH / 2 - (minRow + h / 2) * BRICK_COURSE_HEIGHT_CELLS,
      0,
    ],
    scale: [w * inset, h * BRICK_COURSE_HEIGHT_CELLS * inset, depth],
  };
}

export function studPositions(set: Pick<LegoSet, 'cols' | 'rows' | 'cellMask' | 'bricks'>): StudPosition[] {
  const studs: StudPosition[] = [];
  const zOffsets = [-BRICK_DEPTH_CELLS / 4, BRICK_DEPTH_CELLS / 4];

  for (const brick of set.bricks) {
    const cells = footprint(brick);
    const minCol = Math.min(...cells.map((cell) => cell.col));
    const minRow = Math.min(...cells.map((cell) => cell.row));
    const maxCol = Math.max(...cells.map((cell) => cell.col));
    const w = maxCol - minCol + 1;
    const transform = brickTransform(brick, set.cols, set.rows);
    const y = transform.position[1] + transform.scale[1] / 2 + STUD_HEIGHT_CELLS / 2;

    for (let xIndex = 0; xIndex < w; xIndex++) {
      const col = minCol + xIndex;
      if (minRow > 0 && set.cellMask[(minRow - 1) * set.cols + col]) continue;
      const x = minCol + xIndex + 0.5 - set.cols / 2;
      for (const z of zOffsets) {
        studs.push({
          cell: { col, row: minRow },
          position: [x, y, z],
        });
      }
    }
  }

  return studs;
}

export function facePlaneTransform(face: Face, depth = BRICK_DEPTH_CELLS) {
  const z = depth / 2 + FACE_EPSILON_CELLS;
  return {
    position: [0, 0, face === 'front' ? z : -z] as Vec3,
    rotation: [0, face === 'front' ? 0 : Math.PI, 0] as Vec3,
  };
}
