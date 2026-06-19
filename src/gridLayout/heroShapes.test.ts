import { describe, expect, it } from 'vitest';
import { clampHeroSize, makeHeroOverlayRect } from './heroShapes';

describe('hero shape geometry', () => {
  it('centers a square overlay on square canvases', () => {
    const rect = makeHeroOverlayRect(1, 0.4);

    expect(rect).toEqual({ x: 0.3, y: 0.3, w: 0.4, h: 0.4 });
  });

  it('keeps the overlay square in rendered pixels for wide canvases', () => {
    const rect = makeHeroOverlayRect(16 / 9, 0.45);

    expect(rect.x).toBeCloseTo((1 - rect.w) / 2);
    expect(rect.y).toBeCloseTo((1 - rect.h) / 2);
    expect(rect.w * (16 / 9)).toBeCloseTo(rect.h);
  });

  it('clamps supported hero size fractions', () => {
    expect(clampHeroSize(0.1)).toBe(0.25);
    expect(clampHeroSize(0.8)).toBe(0.6);
    expect(clampHeroSize(0.5)).toBe(0.5);
  });
});
