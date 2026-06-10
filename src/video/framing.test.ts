import { describe, expect, it } from 'vitest';
import { aspectFit, computeCropRects, fillMissingSubjects, manualFrameToCropRect } from './framing';
import type { FrameSubject } from './types';

describe('video framing', () => {
  it('fits a rect to the requested aspect and clamps it inside source bounds', () => {
    const crop = aspectFit({ x: 850, y: 400, w: 120, h: 120 }, 1, 1000, 600, 0.2);

    expect(crop.x + crop.w).toBeLessThanOrEqual(1000);
    expect(crop.y + crop.h).toBeLessThanOrEqual(600);
    expect(crop.w / crop.h).toBeCloseTo(1, 4);
  });

  it('fills missing subjects forward and backward', () => {
    const subjects: FrameSubject[] = [
      null,
      { x: 0.2, y: 0.2, w: 0.2, h: 0.2, source: 'face' },
      null,
      null,
      { x: 0.6, y: 0.6, w: 0.1, h: 0.1, source: 'smartcrop' },
    ];

    const filled = fillMissingSubjects(subjects);
    expect(filled[0]).toEqual(subjects[1]);
    expect(filled[2]).toEqual(subjects[1]);
    expect(filled[3]).toEqual(subjects[1]);
    expect(filled[4]).toEqual(subjects[4]);
  });

  it('uses one envelope crop for locked mode', () => {
    const subjects: FrameSubject[] = [
      { x: 0.1, y: 0.2, w: 0.1, h: 0.1, source: 'face' },
      { x: 0.7, y: 0.2, w: 0.1, h: 0.1, source: 'face' },
    ];

    const crops = computeCropRects(subjects, 'locked', null, 1, 1000, 1000);
    expect(crops[0]).toEqual(crops[1]);
  });

  it('keeps follow mode at constant zoom while moving the crop center', () => {
    const subjects: FrameSubject[] = [
      { x: 0.3, y: 0.4, w: 0.1, h: 0.1, source: 'face' },
      { x: 0.7, y: 0.4, w: 0.1, h: 0.1, source: 'face' },
    ];

    const crops = computeCropRects(subjects, 'follow', null, 1, 1000, 1000);
    expect(crops[0].w).toBeCloseTo(crops[1].w, 4);
    expect(crops[1].x).toBeGreaterThan(crops[0].x);
  });

  it('maps manual frame zoom to a smaller crop rect', () => {
    const normal = manualFrameToCropRect({ cx: 0.5, cy: 0.5, zoom: 1 }, 1, 1200, 800);
    const zoomed = manualFrameToCropRect({ cx: 0.5, cy: 0.5, zoom: 2 }, 1, 1200, 800);

    expect(normal.w).toBeCloseTo(800, 4);
    expect(zoomed.w).toBeCloseTo(400, 4);
    expect(zoomed.h).toBeCloseTo(400, 4);
  });
});
