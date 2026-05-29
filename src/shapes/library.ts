// Built-in basic shapes. ViewBox is always 0 0 100 100 so paths normalize
// easily and the same `d` works both as a thumbnail and as a mask source.
//
// Heart kept as legacy compatibility — generated from the existing heart.svg
// at runtime. New shapes live below.

export type BasicShape = {
  id: string;
  name: string;
  d: string;
  viewBox: string;
};

export const BASIC_SHAPES: BasicShape[] = [
  { id: 'circle',   name: 'Circle',   d: 'M50 4 a46 46 0 1 0 0.001 0z', viewBox: '0 0 100 100' },
  { id: 'square',   name: 'Square',   d: 'M8 8 H92 V92 H8 Z', viewBox: '0 0 100 100' },
  { id: 'rounded',  name: 'Rounded',  d: 'M20 6 H80 a14 14 0 0 1 14 14 V80 a14 14 0 0 1 -14 14 H20 a14 14 0 0 1 -14 -14 V20 a14 14 0 0 1 14 -14 Z', viewBox: '0 0 100 100' },
  { id: 'triangle', name: 'Triangle', d: 'M50 6 L94 90 H6 Z', viewBox: '0 0 100 100' },
  { id: 'diamond',  name: 'Diamond',  d: 'M50 4 L96 50 L50 96 L4 50 Z', viewBox: '0 0 100 100' },
  { id: 'hexagon',  name: 'Hexagon',  d: 'M50 4 L92 28 V72 L50 96 L8 72 V28 Z', viewBox: '0 0 100 100' },
  { id: 'octagon',  name: 'Octagon',  d: 'M30 6 H70 L94 30 V70 L70 94 H30 L6 70 V30 Z', viewBox: '0 0 100 100' },
  { id: 'pill',     name: 'Pill',     d: 'M36 14 H64 a36 36 0 0 1 0 72 H36 a36 36 0 0 1 0 -72 Z', viewBox: '0 0 100 100' },
  { id: 'heart',    name: 'Heart',    d: 'M50 88 C50 88 14 64 14 38 C14 24 24 14 36 14 C44 14 48 18 50 22 C52 18 56 14 64 14 C76 14 86 24 86 38 C86 64 50 88 50 88 Z', viewBox: '0 0 100 100' },
];

export const BASIC_SHAPE_BY_ID: Record<string, BasicShape> = Object.fromEntries(
  BASIC_SHAPES.map((s) => [s.id, s])
);

// Accepts anything carrying a path + viewBox — basic shapes, user shapes, or
// the SelectedShape stored in profiles/sessions.
export function shapeToSvgText(s: { d: string; viewBox: string }): string {
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="${s.viewBox}"><path d="${s.d}" fill="black"/></svg>`;
}
