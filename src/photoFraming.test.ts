import { describe, expect, it } from 'vitest';
import {
  computePhotoPlacement,
  constrainManualFrame,
  getInitialManualFrame,
} from './photoFraming';
import type { Photo } from './types';

const photo: Photo = {
  id: 'p1',
  src: 'data:image/png;base64,',
  naturalWidth: 100,
  naturalHeight: 100,
  subject: {
    x: 0.1,
    y: 0.2,
    w: 0.2,
    h: 0.2,
    source: 'face',
  },
};

describe('photo framing', () => {
  it('uses manual crop before automatic subject framing', () => {
    const placement = computePhotoPlacement(
      { ...photo, manualFrame: { cx: 0.75, cy: 0.5, zoom: 2 } },
      50,
      50,
      { closeUp: true, closeUpTightness: 0.75 }
    );

    expect(placement.w).toBeCloseTo(100);
    expect(placement.x).toBeCloseTo(-50);
    expect(placement.y).toBeCloseTo(-25);
  });

  it('constrains manual crop centers so the crop frame stays covered', () => {
    expect(constrainManualFrame({ cx: 0, cy: 1, zoom: 2 }, photo, 50, 50)).toEqual({
      cx: 0.25,
      cy: 0.75,
      zoom: 2,
    });
  });

  it('starts manual framing from the detected subject when available', () => {
    const frame = getInitialManualFrame(photo, 0.75);

    expect(frame.cx).toBeCloseTo(0.2);
    expect(frame.cy).toBeCloseTo(0.3);
    expect(frame.zoom).toBeCloseTo(3.75);
  });
});
