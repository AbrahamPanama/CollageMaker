export type LayoutSlot = { x: number; y: number; w: number; h: number };

export type Layout = {
  id: string;
  name: string;
  slots: LayoutSlot[];
};

export type PhotoState = {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  x: number;
  y: number;
  scale: number;
};

export type AspectRatio = { w: number; h: number; label: string };

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

export type Photo = {
  id: string;
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  subject: SubjectBox | null;
};
