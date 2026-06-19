import type { HeroShapeId, Rect } from './types';

export type HeroShape = {
  id: HeroShapeId;
  name: string;
  svgPath: string;
  safeInset: number;
  subjectBias: number;
};

export const HERO_SHAPES: HeroShape[] = [
  {
    id: 'circle',
    name: 'Circle',
    svgPath: 'M50 4 a46 46 0 1 0 0.001 0z',
    safeInset: 0.85,
    subjectBias: 0,
  },
  {
    id: 'heart',
    name: 'Heart',
    svgPath: 'M50 88 C50 88 14 64 14 38 C14 24 24 14 36 14 C44 14 48 18 50 22 C52 18 56 14 64 14 C76 14 86 24 86 38 C86 64 50 88 50 88 Z',
    safeInset: 0.72,
    subjectBias: -0.06,
  },
  {
    id: 'triangle',
    name: 'Triangle',
    svgPath: 'M50 6 L94 90 H6 Z',
    safeInset: 0.6,
    subjectBias: 0.08,
  },
  {
    id: 'diamond',
    name: 'Diamond',
    svgPath: 'M50 4 L96 50 L50 96 L4 50 Z',
    safeInset: 0.7,
    subjectBias: 0,
  },
  {
    id: 'hexagon',
    name: 'Hexagon',
    svgPath: 'M50 4 L92 28 V72 L50 96 L8 72 V28 Z',
    safeInset: 0.85,
    subjectBias: 0,
  },
];

const HERO_SHAPE_BY_ID = new Map(HERO_SHAPES.map((shape) => [shape.id, shape]));

export function getHeroShape(shapeId: HeroShapeId | string | null | undefined): HeroShape {
  return HERO_SHAPE_BY_ID.get(shapeId as HeroShapeId) ?? HERO_SHAPES[0];
}

export function makeHeroOverlayRect(targetAspect: number, sizeFraction: number): Rect {
  const aspect = Number.isFinite(targetAspect) && targetAspect > 0 ? targetAspect : 1;
  const size = clamp(sizeFraction, 0.25, 0.6);
  const w = aspect >= 1 ? size / aspect : size;
  const h = aspect >= 1 ? size : size * aspect;
  return {
    x: (1 - w) / 2,
    y: (1 - h) / 2,
    w,
    h,
  };
}

export function clampHeroSize(value: number) {
  return clamp(value, 0.25, 0.6);
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
