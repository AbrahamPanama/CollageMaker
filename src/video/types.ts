import type { ManualFrame, Photo, SubjectBox } from '../types';

export type AutoFrameMode = 'locked' | 'follow' | 'perFrame';

export type VideoSource = {
  id: string;
  file: File;
  filename: string;
  durationSec: number;
  srcWidth: number;
  srcHeight: number;
  inSec: number;
  outSec: number;
  mode: AutoFrameMode;
  manualFrame: ManualFrame | null;
  targetAspect: number;
};

export type VideoMetadata = {
  durationSec: number;
  srcWidth: number;
  srcHeight: number;
};

export type RawFrame = {
  index: number;
  tSec: number;
  bitmap: HTMLCanvasElement;
  width: number;
  height: number;
};

export type FrameSubject = SubjectBox | null;

export type CropRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ExtractionWarning =
  | { kind: 'lowFps'; effectiveFps: number }
  | { kind: 'noSubject'; frameIndices: number[] }
  | { kind: 'decode'; message: string };

export type ExtractionResult = {
  photos: Photo[];
  subjects: FrameSubject[];
  effectiveFps: number;
  warnings: ExtractionWarning[];
};

export type FrameCache = {
  rawKey: string | null;
  rawFrames: RawFrame[];
  subjects: FrameSubject[];
};

export type DeriveProgress = {
  stage: 'decode' | 'detect' | 'bake';
  done: number;
  total: number;
};
