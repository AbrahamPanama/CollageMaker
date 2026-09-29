export type Cell = { x: number; y: number; w: number; h: number };

export type Point = { x: number; y: number };

export type ViewBox = { x: number; y: number; w: number; h: number };

export type ShapeDef = {
  id: string;
  name: string;
  svgText: string;
};

export type SubjectSource = 'face' | 'person' | 'hybrid' | 'smartcrop';

export type SubjectBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  source: SubjectSource;
};

export type SubjectDetections = {
  faces: SubjectBox[];
  people: SubjectBox[];
};

export type ManualFrame = {
  cx: number;
  cy: number;
  zoom: number;
};

export type EchoFill = {
  mode: 'auto' | 'off';
  blur: number;
  dim: number;
  outline: boolean;
};

export type Photo = {
  id: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  subject: SubjectBox | null;
  detections?: SubjectDetections;
  manualFrame?: ManualFrame;
  echo?: EchoFill;
};
