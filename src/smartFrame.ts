// Smart subject detection. Face detectors provide hard framing anchors while
// MediaPipe EfficientDet contributes softer person/body bounds. Smartcrop is the
// fallback when neither model finds a subject. Models are loaded lazily and are
// bundled under public/ so detection works offline in both web and Tauri builds.

import type { FaceDetector, ObjectDetector } from '@mediapipe/tasks-vision';
import { buildPhotoSubjectDetection, dedupeSubjectBoxes, unionSubjectBoxes } from './subjectDetection';
import type { PhotoSubjectDetection } from './subjectDetection';
import type { SubjectBox } from './types';

type DetectableSource = HTMLImageElement | HTMLCanvasElement;
type SubjectInput = DetectableSource | ImageBitmap;
type DetectSubjectOptions = {
  faceApiMode?: 'always' | 'whenNoFace' | 'never';
};

// All model assets are bundled into the app under public/ so it runs fully offline.
const MEDIAPIPE_WASM = `${import.meta.env.BASE_URL}mediapipe-wasm`;
const FACE_MODEL_URL = `${import.meta.env.BASE_URL}models/blaze_face_short_range.tflite`;
const PERSON_MODEL_URL = `${import.meta.env.BASE_URL}models/efficientdet_lite0_uint8.tflite`;
const FACE_API_WEIGHTS = `${import.meta.env.BASE_URL}face-api-models`;
const PERSON_DETECTION_LONG_EDGE = 1280;

async function loadVisionRuntime() {
  const mod = await import('@mediapipe/tasks-vision');
  const fileset = await mod.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
  return { mod, fileset };
}

let visionRuntimePromise: ReturnType<typeof loadVisionRuntime> | null = null;

function getVisionRuntime() {
  if (!visionRuntimePromise) visionRuntimePromise = loadVisionRuntime();
  return visionRuntimePromise;
}

let detectorPromise: Promise<FaceDetector | null> | null = null;

function getFaceDetector(): Promise<FaceDetector | null> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        const { mod, fileset } = await getVisionRuntime();
        return await mod.FaceDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: FACE_MODEL_URL },
          runningMode: 'IMAGE',
          minDetectionConfidence: 0.15,
        });
      } catch (e) {
        console.warn('MediaPipe face detector failed to load', e);
        return null;
      }
    })();
  }
  return detectorPromise;
}

let personDetectorPromise: Promise<ObjectDetector | null> | null = null;

function getPersonDetector(): Promise<ObjectDetector | null> {
  if (!personDetectorPromise) {
    personDetectorPromise = (async () => {
      try {
        const { mod, fileset } = await getVisionRuntime();
        return await mod.ObjectDetector.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: PERSON_MODEL_URL },
          runningMode: 'IMAGE',
          categoryAllowlist: ['person'],
          scoreThreshold: 0.22,
          maxResults: 100,
        });
      } catch (e) {
        console.warn('MediaPipe person detector failed to load', e);
        return null;
      }
    })();
  }
  return personDetectorPromise;
}

let faceApiPromise: Promise<boolean> | null = null;
let faceApiModule: typeof import('face-api.js') | null = null;

function loadFaceApi(): Promise<boolean> {
  if (!faceApiPromise) {
    faceApiPromise = (async () => {
      try {
        const mod = await import('face-api.js');
        await mod.nets.ssdMobilenetv1.loadFromUri(FACE_API_WEIGHTS);
        faceApiModule = mod;
        return true;
      } catch (e) {
        console.warn('face-api.js (SSD MobileNet) failed to load', e);
        return false;
      }
    })();
  }
  return faceApiPromise;
}

type DetectedBox = { x: number; y: number; w: number; h: number };

function detectOnSource(
  detector: FaceDetector,
  source: DetectableSource,
  offsetX: number,
  offsetY: number,
  out: DetectedBox[]
) {
  try {
    const result = detector.detect(source);
    for (const d of result.detections) {
      const b = d.boundingBox;
      if (!b) continue;
      out.push({
        x: b.originX + offsetX,
        y: b.originY + offsetY,
        w: b.width,
        h: b.height,
      });
    }
  } catch (e) {
    console.warn('detect pass failed', e);
  }
}

function cropToCanvas(
  source: DetectableSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number
): HTMLCanvasElement | null {
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

async function detectWithFaceApi(
  img: DetectableSource,
  out: DetectedBox[]
): Promise<void> {
  const ok = await loadFaceApi();
  if (!ok || !faceApiModule) return;
  try {
    const detections = await faceApiModule.detectAllFaces(
      img as never,
      new faceApiModule.SsdMobilenetv1Options({ minConfidence: 0.2, maxResults: 200 })
    );
    for (const d of detections) {
      out.push({
        x: d.box.x,
        y: d.box.y,
        w: d.box.width,
        h: d.box.height,
      });
    }
  } catch (e) {
    console.warn('face-api detection failed', e);
  }
}

async function detectFaces(img: DetectableSource, options: DetectSubjectOptions): Promise<SubjectBox[]> {
  const { width: W, height: H } = getSourceSize(img);
  const detections: DetectedBox[] = [];

  const detector = await getFaceDetector();

  if (detector) {
    detectOnSource(detector, img, 0, 0, detections);

    if (W >= 600 && H >= 600) {
      const topH = Math.round(H * 0.6);
      const topCanvas = cropToCanvas(img, 0, 0, W, topH);
      if (topCanvas) detectOnSource(detector, topCanvas, 0, 0, detections);

      const cropW = Math.round(W * 0.5);
      const cropH = Math.round(H * 0.5);
      const cropX = Math.round((W - cropW) / 2);
      const cropY = Math.round((H - cropH) / 2);
      const centerCanvas = cropToCanvas(img, cropX, cropY, cropW, cropH);
      if (centerCanvas) detectOnSource(detector, centerCanvas, cropX, cropY, detections);
    }

    if (W >= 1600 && H >= 1200 && detections.length < 3) {
      const halfW = Math.round(W / 2);
      const halfH = Math.round(H / 2);
      for (let qy = 0; qy < 2; qy++) {
        for (let qx = 0; qx < 2; qx++) {
          const sx = qx * halfW;
          const sy = qy * halfH;
          const tileCanvas = cropToCanvas(img, sx, sy, halfW, halfH);
          if (tileCanvas) detectOnSource(detector, tileCanvas, sx, sy, detections);
        }
      }
    }
  }

  const faceApiMode = options.faceApiMode ?? 'always';
  if (faceApiMode === 'always' || (faceApiMode === 'whenNoFace' && detections.length === 0)) {
    await detectWithFaceApi(img, detections);
  }

  return dedupeSubjectBoxes(
    detections.map((box) => {
      const padX = box.w * 0.14;
      const padTop = box.h * 0.22;
      const padBottom = box.h * 0.3;
      return {
        x: (box.x - padX) / W,
        y: (box.y - padTop) / H,
        w: (box.w + padX * 2) / W,
        h: (box.h + padTop + padBottom) / H,
        source: 'face' as const,
      };
    })
  );
}

async function detectPeople(img: DetectableSource): Promise<SubjectBox[]> {
  const detector = await getPersonDetector();
  if (!detector) return [];

  const source = downscaleSource(img, PERSON_DETECTION_LONG_EDGE);
  const { width: W, height: H } = getSourceSize(source);
  try {
    const result = detector.detect(source);
    return dedupeSubjectBoxes(
      result.detections.flatMap((detection) => {
        const box = detection.boundingBox;
        if (!box) return [];
        const padX = box.width * 0.025;
        const padTop = box.height * 0.025;
        const padBottom = box.height * 0.035;
        return [{
          x: (box.originX - padX) / W,
          y: (box.originY - padTop) / H,
          w: (box.width + padX * 2) / W,
          h: (box.height + padTop + padBottom) / H,
          source: 'person' as const,
        }];
      })
    );
  } catch (e) {
    console.warn('person detection failed', e);
    return [];
  }
}

async function detectSmartCrop(img: DetectableSource): Promise<SubjectBox | null> {
  try {
    const mod = await import('smartcrop');
    const smartcrop = mod.default ?? mod;
    const { width, height } = getSourceSize(img);
    const size = Math.min(width, height);
    const result = await smartcrop.crop(img as HTMLImageElement, { width: size, height: size });
    const c = result.topCrop;
    return {
      x: c.x / width,
      y: c.y / height,
      w: c.width / width,
      h: c.height / height,
      source: 'smartcrop',
    };
  } catch (e) {
    console.warn('smartcrop failed', e);
    return null;
  }
}

export async function detectSubject(source: SubjectInput, options: DetectSubjectOptions = {}): Promise<SubjectBox | null> {
  const img = normalizeDetectionSource(source);
  const faces = await detectFaces(img, options);
  const faceUnion = unionSubjectBoxes(faces, 'face');
  if (faceUnion) return faceUnion;
  return await detectSmartCrop(img);
}

export async function detectPhotoSubjects(
  source: SubjectInput,
  options: DetectSubjectOptions = {}
): Promise<PhotoSubjectDetection> {
  const img = normalizeDetectionSource(source);
  const [faces, people] = await Promise.all([
    detectFaces(img, options),
    detectPeople(img),
  ]);
  const fallback = faces.length === 0 && people.length === 0
    ? await detectSmartCrop(img)
    : null;
  return buildPhotoSubjectDetection(faces, people, fallback);
}

function normalizeDetectionSource(source: SubjectInput): DetectableSource {
  if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) return source;
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const ctx = canvas.getContext('2d');
  if (ctx) ctx.drawImage(source, 0, 0);
  return canvas;
}

function getSourceSize(source: DetectableSource) {
  if (source instanceof HTMLImageElement) {
    return { width: source.naturalWidth, height: source.naturalHeight };
  }
  return { width: source.width, height: source.height };
}

function downscaleSource(source: DetectableSource, longEdge: number): DetectableSource {
  const { width, height } = getSourceSize(source);
  const scale = Math.min(1, longEdge / Math.max(width, height));
  if (scale >= 0.999) return source;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}
