import { describe, expect, it } from 'vitest';
import { clampPhotoPos, computeSlotRect, coverScale } from './utils';

describe('grid slot utilities', () => {
  it('keeps outer borders full-width and shared borders half-width', () => {
    expect(computeSlotRect({ x: 0, y: 0, w: 0.5, h: 1 }, 600, 400, 20)).toEqual({
      x: 20,
      y: 20,
      w: 270,
      h: 360,
    });

    expect(computeSlotRect({ x: 0.5, y: 0, w: 0.5, h: 1 }, 600, 400, 20)).toEqual({
      x: 310,
      y: 20,
      w: 270,
      h: 360,
    });
  });

  it('computes cover scale from the tighter axis', () => {
    expect(coverScale(400, 200, 100, 100)).toBe(0.5);
    expect(coverScale(200, 400, 100, 100)).toBe(0.5);
  });

  it('clamps panning so a covered photo cannot leave an empty edge', () => {
    expect(clampPhotoPos(50, -500, 1, 300, 300, 100, 100)).toEqual({
      x: 0,
      y: -200,
    });
  });
});
