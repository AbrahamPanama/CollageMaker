import type { Point, SubjectBox } from '../types';

export type Rect = { x: number; y: number; w: number; h: number };

export type SplitDirection = 'H' | 'V';
export type LayoutFamily = 'mosaic' | 'heroCenter' | 'svgTemplate';
export type HeroShapeId = 'circle' | 'heart' | 'triangle' | 'diamond' | 'hexagon';

export type LayoutTree =
  | { type: 'leaf'; photoId: string; aspect: number }
  | { type: 'split'; direction: SplitDirection; left: LayoutTree; right: LayoutTree };

export type PhotoMeta = {
  id: string;
  aspect: number;
  subject: SubjectBox | null;
  heroPinned?: boolean;
};

export type GridCell = {
  id: string;
  photoId: string;
  rect: Rect;
  clip?: SvgCellClip;
  label?: string;
};

export type SvgCellClip = {
  outer: Point[];
  holes: Point[][];
};

export type ScoredLayout = {
  id: string;
  family: LayoutFamily;
  tree: LayoutTree | null;
  cells: GridCell[];
  heroOverlay?: HeroOverlay;
  score: number;
  breakdown: ScoreBreakdown;
};

export type HeroOverlay = {
  photoId: string;
  shapeId: HeroShapeId;
  rect: Rect;
  sizeFraction: number;
};

export type ScoreBreakdown = {
  aspectFit: number;
  subjectSafety: number;
  areaBalance: number;
  heroBoost: number;
  faceWeighting: number;
  minCell: number;
  adjacencyVariety: number;
};

export type ScoreWeights = Partial<Record<keyof ScoreBreakdown, number>>;

export type GenOptions = {
  family?: LayoutFamily;
  topK?: number;
  minCellFraction?: number;
  weights?: ScoreWeights;
  locks?: Set<string>;
  heroPhotoId?: string | null;
  hero?: {
    photoId?: string | null;
    shapeId: HeroShapeId;
    sizeFraction: number;
  };
};
