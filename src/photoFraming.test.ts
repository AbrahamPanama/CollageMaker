import { describe, expect, it } from 'vitest';
import {
  computePhotoPlacement,
  constrainManualFrame,
  getFitSubjectsFrame,
  getInitialManualFrame,
  placementUnderfills,
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

  it('keeps zoomed-out images inside the crop frame', () => {
    const frame = constrainManualFrame({ cx: 0, cy: 1, zoom: 0.5 }, photo, 50, 50);
    const placement = computePhotoPlacement(
      { ...photo, manualFrame: frame },
      50,
      50,
      { closeUp: false, closeUpTightness: 0.75 }
    );

    expect(frame.zoom).toBeCloseTo(0.5);
    expect(placement.x).toBeGreaterThanOrEqual(0);
    expect(placement.y).toBeGreaterThanOrEqual(0);
    expect(placement.x + placement.w).toBeLessThanOrEqual(50);
    expect(placement.y + placement.h).toBeLessThanOrEqual(50);
    expect(placementUnderfills(placement, 50, 50)).toBe(true);
  });

  it('fits the detected subject with a zoom below cover when useful', () => {
    const wideSubject: Photo = {
      ...photo,
      naturalWidth: 200,
      naturalHeight: 100,
      subject: { x: 0.05, y: 0.1, w: 0.9, h: 0.8, source: 'face' },
    };

    const frame = getFitSubjectsFrame(wideSubject, 50, 50);
    const placement = computePhotoPlacement(
      { ...wideSubject, manualFrame: frame },
      50,
      50,
      { closeUp: false, closeUpTightness: 0.75 }
    );

    expect(frame.zoom).toBeLessThan(1);
    expect(placement.subjectBox?.x).toBeGreaterThanOrEqual(-0.0001);
    expect((placement.subjectBox?.x ?? 0) + (placement.subjectBox?.w ?? 0)).toBeLessThanOrEqual(50.0001);
  });
});
