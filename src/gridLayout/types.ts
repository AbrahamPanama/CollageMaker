import type { SubjectBox } from '../types';

export type Rect = { x: number; y: number; w: number; h: number };

export type SplitDirection = 'H' | 'V';

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
};

export type ScoredLayout = {
  id: string;
  tree: LayoutTree | null;
  cells: GridCell[];
  score: number;
  breakdown: ScoreBreakdown;
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
  topK?: number;
  minCellFraction?: number;
  weights?: ScoreWeights;
  locks?: Set<string>;
  heroPhotoId?: string | null;
};
