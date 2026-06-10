export type Cell = { x: number; y: number; w: number; h: number };

export type Point = { x: number; y: number };

export type ViewBox = { x: number; y: number; w: number; h: number };

export type ShapeDef = {
  id: string;
  name: string;
  svgText: string;
};

export type SubjectBox = {
  x: number;
  y: number;
  w: number;
  h: number;
  source: 'face' | 'smartcrop';
};

export type ManualFrame = {
  cx: number;
  cy: number;
  zoom: number;
};

export type Photo = {
  id: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  subject: SubjectBox | null;
  manualFrame?: ManualFrame;
};
