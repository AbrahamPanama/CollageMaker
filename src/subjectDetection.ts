import type { SubjectBox, SubjectDetections, SubjectSource } from './types';

const FACE_MATCH_MARGIN = 0.08;
const SYNTHETIC_BODY_WIDTH = 2.7;
const SYNTHETIC_BODY_HEIGHT = 7;
const BODY_TOP_HEADROOM = 0.35;
const MAX_DETECTED_TOP_HEADROOM = 0.7;

export type FaceDetectorName = 'blazeface' | 'faceapi';

export type FaceCandidate = {
  x: number;
  y: number;
  w: number;
  h: number;
  score: number;
  detector: FaceDetectorName;
};

// BlazeFace fires on high-contrast patterns, hands and shirts at scores up to
// ~0.6, while face-api's SSD rarely scores a non-face above ~0.3. A detection is
// accepted on its own only above the detector's `confident` score; between
// `corroborated` and `confident` it needs the other detector to agree on the
// same spot. `corroborated` is also the minimum score each detector reports.
export const FACE_SCORE_THRESHOLDS: Record<FaceDetectorName, { confident: number; corroborated: number }> = {
  blazeface: { confident: 0.7, corroborated: 0.4 },
  faceapi: { confident: 0.5, corroborated: 0.3 },
};
const CORROBORATION_IOU = 0.3;

export type PhotoSubjectDetection = {
  subject: SubjectBox | null;
  detections: SubjectDetections;
};

export function selectConfidentFaces<T extends FaceCandidate>(candidates: T[]): T[] {
  return candidates.filter((candidate) => {
    const thresholds = FACE_SCORE_THRESHOLDS[candidate.detector];
    if (candidate.score >= thresholds.confident) return true;
    if (candidate.score < thresholds.corroborated) return false;
    return candidates.some(
      (other) =>
        other.detector !== candidate.detector &&
        other.score >= FACE_SCORE_THRESHOLDS[other.detector].corroborated &&
        intersectionOverUnion(candidate, other) >= CORROBORATION_IOU
    );
  });
}

export function buildPhotoSubjectDetection(
  faces: SubjectBox[],
  detectedPeople: SubjectBox[],
  fallback: SubjectBox | null = null
): PhotoSubjectDetection {
  const cleanFaces = dedupeSubjectBoxes(faces.map((box) => normalizeBox(box, 'face')));
  const cleanPeople = dedupeSubjectBoxes(detectedPeople.map((box) => normalizeBox(box, 'person')));

  if (cleanFaces.length === 0) {
    return {
      subject: cleanPeople.length > 0 ? unionSubjectBoxes(cleanPeople, 'person') : fallback,
      detections: { faces: [], people: cleanPeople },
    };
  }

  const relevantPeople: SubjectBox[] = [];
  const matchedPersonIndexes = new Set<number>();
  for (const face of cleanFaces) {
    const matchIndex = findBestPersonForFace(face, cleanPeople, matchedPersonIndexes);
    if (matchIndex >= 0) {
      matchedPersonIndexes.add(matchIndex);
      relevantPeople.push(refinePersonBox(face, cleanPeople[matchIndex]));
    } else {
      relevantPeople.push(synthesizePersonBox(face));
    }
  }

  const people = dedupeSubjectBoxes(relevantPeople);
  return {
    subject: unionSubjectBoxes([...cleanFaces, ...people], 'hybrid'),
    detections: { faces: cleanFaces, people },
  };
}

export function unionSubjectBoxes(
  boxes: SubjectBox[],
  source: SubjectSource
): SubjectBox | null {
  if (boxes.length === 0) return null;
  const minX = Math.min(...boxes.map((box) => box.x));
  const minY = Math.min(...boxes.map((box) => box.y));
  const maxX = Math.max(...boxes.map((box) => box.x + box.w));
  const maxY = Math.max(...boxes.map((box) => box.y + box.h));
  return normalizeBox({ x: minX, y: minY, w: maxX - minX, h: maxY - minY, source }, source);
}

export function dedupeSubjectBoxes(boxes: SubjectBox[]): SubjectBox[] {
  const result: SubjectBox[] = [];
  for (const candidate of boxes
    .map((box) => normalizeBox(box, box.source))
    .filter((box) => box.w > 0.001 && box.h > 0.001)
    .sort((a, b) => b.w * b.h - a.w * a.h)) {
    const duplicateIndex = result.findIndex((box) => overlapOverSmaller(box, candidate) >= 0.62);
    if (duplicateIndex < 0) {
      result.push(candidate);
      continue;
    }
    result[duplicateIndex] = mergeDuplicateBoxes(result[duplicateIndex], candidate);
  }
  return result.sort((a, b) => a.x - b.x || a.y - b.y);
}

export function synthesizePersonBox(face: SubjectBox): SubjectBox {
  const width = Math.min(1, face.w * SYNTHETIC_BODY_WIDTH);
  const height = Math.min(1, face.h * SYNTHETIC_BODY_HEIGHT);
  const centerX = face.x + face.w / 2;
  const top = face.y - face.h * BODY_TOP_HEADROOM;
  return normalizeBox(
    {
      x: centerX - width / 2,
      y: top,
      w: width,
      h: height,
      source: 'person',
    },
    'person'
  );
}

export function refinePersonBox(face: SubjectBox, detectedPerson: SubjectBox): SubjectBox {
  const synthetic = synthesizePersonBox(face);
  const faceCenterX = face.x + face.w / 2;
  const detectedRight = detectedPerson.x + detectedPerson.w;
  const detectedBottom = detectedPerson.y + detectedPerson.h;

  // Object detectors occasionally return a person box that includes a large
  // amount of scenery above the head or ends at an occluding bag/table. Anchor
  // the vertical extent to the face, then retain any genuinely wider/deeper
  // extent supplied by the detector.
  const minTop = Math.max(0, face.y - face.h * MAX_DETECTED_TOP_HEADROOM);
  const maxTop = Math.max(0, face.y - face.h * 0.05);
  const top = clamp(detectedPerson.y, minTop, maxTop);
  const bottom = Math.max(detectedBottom, synthetic.y + synthetic.h);

  const syntheticRight = synthetic.x + synthetic.w;
  const left = Math.min(detectedPerson.x, synthetic.x, faceCenterX);
  const right = Math.max(detectedRight, syntheticRight, faceCenterX);

  return normalizeBox(
    {
      x: left,
      y: top,
      w: right - left,
      h: bottom - top,
      source: 'person',
    },
    'person'
  );
}

function findBestPersonForFace(
  face: SubjectBox,
  people: SubjectBox[],
  excludedIndexes: Set<number>
): number {
  const faceCenterX = face.x + face.w / 2;
  const faceCenterY = face.y + face.h / 2;
  let bestIndex = -1;
  let bestScore = -Infinity;

  for (let index = 0; index < people.length; index++) {
    if (excludedIndexes.has(index)) continue;
    const person = people[index];
    const marginX = Math.max(FACE_MATCH_MARGIN, person.w * 0.12);
    const marginY = Math.max(FACE_MATCH_MARGIN, person.h * 0.08);
    const contains =
      faceCenterX >= person.x - marginX &&
      faceCenterX <= person.x + person.w + marginX &&
      faceCenterY >= person.y - marginY &&
      faceCenterY <= person.y + person.h * 0.72 + marginY;
    if (!contains) continue;

    const personCenterX = person.x + person.w / 2;
    const horizontalDistance = Math.abs(faceCenterX - personCenterX) / Math.max(person.w, 0.001);
    const expectedFaceY = person.y + person.h * 0.16;
    const verticalDistance = Math.abs(faceCenterY - expectedFaceY) / Math.max(person.h, 0.001);
    const score = 2 - horizontalDistance - verticalDistance * 0.45;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function mergeDuplicateBoxes(a: SubjectBox, b: SubjectBox): SubjectBox {
  const aArea = a.w * a.h;
  const bArea = b.w * b.h;
  const total = Math.max(0.0001, aArea + bArea);
  return normalizeBox(
    {
      x: (a.x * aArea + b.x * bArea) / total,
      y: (a.y * aArea + b.y * bArea) / total,
      w: (a.w * aArea + b.w * bArea) / total,
      h: (a.h * aArea + b.h * bArea) / total,
      source: a.source,
    },
    a.source
  );
}

type Rect = { x: number; y: number; w: number; h: number };

function intersectionArea(a: Rect, b: Rect) {
  const left = Math.max(a.x, b.x);
  const top = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.w, b.x + b.w);
  const bottom = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function overlapOverSmaller(a: SubjectBox, b: SubjectBox) {
  return intersectionArea(a, b) / Math.max(0.0001, Math.min(a.w * a.h, b.w * b.h));
}

function intersectionOverUnion(a: Rect, b: Rect) {
  const intersection = intersectionArea(a, b);
  const union = a.w * a.h + b.w * b.h - intersection;
  return union > 0 ? intersection / union : 0;
}

function normalizeBox(box: SubjectBox, source: SubjectSource): SubjectBox {
  const x = clamp(box.x, 0, 1);
  const y = clamp(box.y, 0, 1);
  const right = clamp(box.x + box.w, x, 1);
  const bottom = clamp(box.y + box.h, y, 1);
  return { x, y, w: right - x, h: bottom - y, source };
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
