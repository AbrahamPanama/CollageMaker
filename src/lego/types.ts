import type { ManualFrame } from '../types';
import type { LoadedPhoto } from '../photoIngest';

export type BrickKind = '1x2' | '2x2' | '2x3' | '2x4';
export type Orientation = 'h' | 'v';
export type Face = 'front' | 'back';

export type Cell = {
  col: number;
  row: number;
};

export type Brick = {
  id: string;
  kind: BrickKind;
  orientation: Orientation;
  cell: Cell;
};

export type LegoShape = {
  id: string;
  name: string;
  cols: number;
  rows: number;
  cellMask: boolean[];
};

export type LegoSet = {
  shapeId: string;
  cols: number;
  rows: number;
  cellMask: boolean[];
  bricks: Brick[];
  pieceCount: number;
};

export type LegoImages = {
  front: LoadedPhoto | null;
  back: LoadedPhoto | null;
};

export type LegoFraming = {
  front: ManualFrame | null;
  back: ManualFrame | null;
};

export type BillOfMaterials = {
  total: number;
  byKind: Record<BrickKind, number>;
  twoByFour: number;
  twoByThree: number;
  twoByTwo: number;
  oneByTwo: number;
};

export type TilingResult =
  | { ok: true; set: LegoSet }
  | { ok: false; reason: string };
