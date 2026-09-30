import { describe, expect, it } from 'vitest';
import {
  buildPhotoSubjectDetection,
  dedupeSubjectBoxes,
  refinePersonBox,
  selectConfidentFaces,
  synthesizePersonBox,
} from './subjectDetection';
import type { FaceCandidate } from './subjectDetection';
import type { SubjectBox } from './types';

const face = (x: number, y: number, w = 0.1, h = 0.1): SubjectBox => ({
  x,
  y,
  w,
  h,
  source: 'face',
});

const person = (x: number, y: number, w: number, h: number): SubjectBox => ({
  x,
  y,
  w,
  h,
  source: 'person',
});

describe('hybrid subject detection', () => {
  it('matches faces to people and builds a body-aware envelope', () => {
    const result = buildPhotoSubjectDetection(
      [face(0.2, 0.2), face(0.65, 0.18)],
      [person(0.12, 0.14, 0.28, 0.72), person(0.58, 0.12, 0.3, 0.8)]
    );

    expect(result.subject?.source).toBe('hybrid');
    expect(result.detections.faces).toHaveLength(2);
    expect(result.detections.people).toHaveLength(2);
    expect(result.subject?.y).toBeLessThanOrEqual(0.14);
    expect((result.subject?.y ?? 0) + (result.subject?.h ?? 0)).toBeGreaterThanOrEqual(0.9);
  });

  it('synthesizes a body region when a detected face has no person match', () => {
    const result = buildPhotoSubjectDetection([face(0.45, 0.2)], []);

    expect(result.subject?.source).toBe('hybrid');
    expect(result.detections.people).toHaveLength(1);
    expect(result.detections.people[0].h).toBeGreaterThan(0.45);
    expect(result.detections.people[0].w).toBeGreaterThan(0.2);
  });

  it('uses person-only detections before falling back to smartcrop', () => {
    const fallback: SubjectBox = { x: 0.25, y: 0.25, w: 0.5, h: 0.5, source: 'smartcrop' };
    const result = buildPhotoSubjectDetection([], [person(0.2, 0.1, 0.5, 0.85)], fallback);

    expect(result.subject?.source).toBe('person');
    expect(result.subject?.h).toBeCloseTo(0.85);
  });

  it('deduplicates overlapping boxes emitted by multiple detector passes', () => {
    const boxes = dedupeSubjectBoxes([
      face(0.2, 0.2, 0.2, 0.2),
      face(0.205, 0.195, 0.198, 0.205),
      face(0.65, 0.2, 0.15, 0.15),
    ]);

    expect(boxes).toHaveLength(2);
  });

  it('clips synthetic people to normalized image bounds', () => {
    const box = synthesizePersonBox(face(0.92, 0.88, 0.12, 0.12));
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.w).toBeLessThanOrEqual(1);
    expect(box.y + box.h).toBeLessThanOrEqual(1);
  });

  it('repairs person boxes that contain scenery above faces and stop at the waist', () => {
    const detectedFace = face(0.42, 0.45, 0.08, 0.08);
    const repaired = refinePersonBox(
      detectedFace,
      person(0.35, 0.02, 0.24, 0.61)
    );

    expect(repaired.y).toBeGreaterThan(0.35);
    expect(repaired.y + repaired.h).toBeGreaterThan(0.95);
    expect(repaired.y + repaired.h / 2).toBeGreaterThan(0.65);
  });

  it('centers a group from repaired body envelopes instead of its faces', () => {
    const result = buildPhotoSubjectDetection(
      [
        face(0.18, 0.43, 0.08, 0.08),
        face(0.4, 0.42, 0.08, 0.08),
        face(0.62, 0.43, 0.08, 0.08),
        face(0.8, 0.41, 0.08, 0.08),
      ],
      [
        person(0.12, 0.02, 0.19, 0.62),
        person(0.34, 0.01, 0.18, 0.65),
        person(0.56, 0.03, 0.18, 0.61),
        person(0.75, 0.02, 0.18, 0.63),
      ]
    );

    const subjectCenterY = (result.subject?.y ?? 0) + (result.subject?.h ?? 0) / 2;
    const faceCenterY = 0.45;
    expect(result.detections.people).toHaveLength(4);
    expect(subjectCenterY).toBeGreaterThan(faceCenterY + 0.18);
    expect((result.subject?.y ?? 0) + (result.subject?.h ?? 0)).toBeGreaterThan(0.95);
  });
});

// Scores and boxes below are taken from real detector output on the app's test
// images (normalized coordinates; the filter is scale-invariant).
describe('face confidence filtering', () => {
  const blaze = (score: number, x: number, y: number, w: number, h: number): FaceCandidate => ({
    x, y, w, h, score, detector: 'blazeface',
  });
  const faceApi = (score: number, x: number, y: number, w: number, h: number): FaceCandidate => ({
    x, y, w, h, score, detector: 'faceapi',
  });

  it('rejects uncorroborated mid-score BlazeFace hits on patterns', () => {
    const polkaDots = [
      blaze(0.595, 0.185, 0.043, 0.224, 0.224),
      blaze(0.405, 0.115, 0.112, 0.223, 0.223),
    ];
    expect(selectConfidentFaces(polkaDots)).toEqual([]);
  });

  it('keeps confident faces from either detector on their own', () => {
    const kept = selectConfidentFaces([
      blaze(0.931, 0.541, 0.309, 0.229, 0.188),
      faceApi(0.786, 0.127, 0.628, 0.021, 0.035),
    ]);
    expect(kept).toHaveLength(2);
  });

  it('accepts mid-score faces when both detectors agree on the spot', () => {
    const kept = selectConfidentFaces([
      blaze(0.45, 0.171, 0.256, 0.334, 0.274),
      faceApi(0.35, 0.19, 0.197, 0.289, 0.32),
    ]);
    expect(kept).toHaveLength(2);
  });

  it('does not let a loose box borrow confidence from a face it merely contains', () => {
    const dadFace = faceApi(0.996, 0.337, 0.049, 0.174, 0.112);
    const looseBox = blaze(0.514, 0.276, 0.008, 0.399, 0.189);
    expect(selectConfidentFaces([dadFace, looseBox])).toEqual([dadFace]);
  });

  it('ignores corroboration from a detection below its own minimum score', () => {
    const shirt = blaze(0.535, 0.549, 0.725, 0.259, 0.212);
    const weakEcho = faceApi(0.2, 0.55, 0.73, 0.25, 0.2);
    expect(selectConfidentFaces([shirt, weakEcho])).toEqual([]);
  });
});
