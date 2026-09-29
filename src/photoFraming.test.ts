import { describe, expect, it } from 'vitest';
import {
  computePhotoPlacement,
  constrainManualFrame,
  getFitSubjectsFrame,
  getInitialManualFrame,
  placementUnderfills,
} from './photoFraming';
import type { Photo, SubjectBox } from './types';

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

  it('uses the body envelope while keeping every detected face in frame', () => {
    const hybridPhoto: Photo = {
      ...photo,
      naturalWidth: 1000,
      naturalHeight: 1400,
      subject: { x: 0.08, y: 0.18, w: 0.84, h: 0.8, source: 'hybrid' },
      detections: {
        faces: [
          { x: 0.12, y: 0.2, w: 0.12, h: 0.1, source: 'face' },
          { x: 0.72, y: 0.2, w: 0.12, h: 0.1, source: 'face' },
        ],
        people: [
          { x: 0.08, y: 0.18, w: 0.3, h: 0.8, source: 'person' },
          { x: 0.62, y: 0.18, w: 0.3, h: 0.8, source: 'person' },
        ],
      },
    };

    const placement = computePhotoPlacement(hybridPhoto, 600, 360, {
      closeUp: true,
      closeUpTightness: 0.75,
    });
    const imageLeft = placement.x;
    const imageTop = placement.y;
    for (const detectedFace of hybridPhoto.detections?.faces ?? []) {
      const left = imageLeft + detectedFace.x * placement.w;
      const right = left + detectedFace.w * placement.w;
      const top = imageTop + detectedFace.y * placement.h;
      const bottom = top + detectedFace.h * placement.h;
      expect(left).toBeGreaterThanOrEqual(-0.001);
      expect(right).toBeLessThanOrEqual(600.001);
      expect(top).toBeGreaterThanOrEqual(-0.001);
      expect(bottom).toBeLessThanOrEqual(360.001);
    }
    expect(placement.cy).toBeGreaterThan(0.4);
  });

  it('preserves legacy face-only framing for saved photos without detections', () => {
    const placement = computePhotoPlacement(photo, 50, 50, {
      closeUp: true,
      closeUpTightness: 0.75,
    });

    expect(placement.cx).toBeCloseTo(0.2);
    expect(placement.cy).toBeCloseTo(0.3);
  });

  it('seeds the manual editor from the same aspect-aware automatic crop', () => {
    const hybridPhoto: Photo = {
      ...photo,
      naturalWidth: 1000,
      naturalHeight: 1400,
      subject: { x: 0.08, y: 0.18, w: 0.84, h: 0.8, source: 'hybrid' },
      detections: {
        faces: [{ x: 0.44, y: 0.18, w: 0.12, h: 0.1, source: 'face' }],
        people: [{ x: 0.34, y: 0.16, w: 0.32, h: 0.82, source: 'person' }],
      },
    };
    const automatic = computePhotoPlacement(hybridPhoto, 600, 360, {
      closeUp: true,
      closeUpTightness: 0.75,
    });
    const initial = getInitialManualFrame(hybridPhoto, 0.75, 600, 360);

    expect(initial.cx).toBeCloseTo(automatic.cx);
    expect(initial.cy).toBeCloseTo(automatic.cy);
    expect(initial.zoom).toBeCloseTo(automatic.zoom);
  });

  it('places a standing group by its body envelope when detector boxes are truncated', () => {
    const faces: SubjectBox[] = [
      { x: 0.18, y: 0.43, w: 0.08, h: 0.08, source: 'face' },
      { x: 0.4, y: 0.42, w: 0.08, h: 0.08, source: 'face' },
      { x: 0.62, y: 0.43, w: 0.08, h: 0.08, source: 'face' },
      { x: 0.8, y: 0.41, w: 0.08, h: 0.08, source: 'face' },
    ];
    const people: SubjectBox[] = [
      { x: 0.12, y: 0.02, w: 0.19, h: 0.62, source: 'person' },
      { x: 0.34, y: 0.01, w: 0.18, h: 0.65, source: 'person' },
      { x: 0.56, y: 0.03, w: 0.18, h: 0.61, source: 'person' },
      { x: 0.75, y: 0.02, w: 0.18, h: 0.63, source: 'person' },
    ];
    const groupPhoto: Photo = {
      ...photo,
      naturalWidth: 1200,
      naturalHeight: 1600,
      // This is the malformed aggregate produced before body-box repair.
      subject: { x: 0.12, y: 0.01, w: 0.81, h: 0.65, source: 'hybrid' },
      detections: { faces, people },
    };

    const placement = computePhotoPlacement(groupPhoto, 600, 600, {
      closeUp: true,
      closeUpTightness: 0.75,
    });

    // Portrait-to-square cover cannot center below 0.625 without exposing the
    // image edge, so body centering should reach that lower limit.
    expect(placement.cy).toBeCloseTo(0.625);
    for (const detectedFace of faces) {
      const top = placement.y + detectedFace.y * placement.h;
      const bottom = top + detectedFace.h * placement.h;
      expect(top).toBeGreaterThanOrEqual(-0.001);
      expect(bottom).toBeLessThanOrEqual(600.001);
    }
  });
});
