// Smart subject detection. MediaPipe BlazeFace (fast) + face-api.js SSD MobileNet
// (more accurate at distant faces) run together; smartcrop is the fallback
// when both models find nothing. All three libs are dynamically imported so the
// initial app bundle stays small — they only download when the user actually
// adds a photo.

import type { FaceDetector } from '@mediapipe/tasks-vision';

export type SubjectBox = {
  /** Normalized 0..1 in image pixel coordinates */
  x: number;
  y: number;
  w: number;
  h: number;
  source: 'face' | 'smartcrop';
};

// All model assets are bundled into the app under public/ so it runs fully offline.
const MEDIAPIPE_WASM = `${import.meta.env.BASE_URL}mediapipe-wasm`;
const FACE_MODEL_URL = `${import.meta.env.BASE_URL}models/blaze_face_short_range.tflite`;
const FACE_API_WEIGHTS = `${import.meta.env.BASE_URL}face-api-models`;

let detectorPromise: Promise<FaceDetector | null> | null = null;

function getFaceDetector(): Promise<FaceDetector | null> {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      try {
        const mod = await import('@mediapipe/tasks-vision');
        const vision = await mod.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM);
        return await mod.FaceDetector.createFromOptions(vision, {
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
  source: HTMLImageElement | HTMLCanvasElement,
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
  img: HTMLImageElement,
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
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return c;
}

async function detectWithFaceApi(
  img: HTMLImageElement,
  out: DetectedBox[]
): Promise<void> {
  const ok = await loadFaceApi();
  if (!ok || !faceApiModule) return;
  try {
    const detections = await faceApiModule.detectAllFaces(
      img,
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

async function detectFaces(img: HTMLImageElement): Promise<SubjectBox | null> {
  const W = img.naturalWidth;
  const H = img.naturalHeight;
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

    if (W >= 1600 && H >= 1200 && detections.length === 0) {
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

  await detectWithFaceApi(img, detections);

  if (detections.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const d of detections) {
    minX = Math.min(minX, d.x);
    minY = Math.min(minY, d.y);
    maxX = Math.max(maxX, d.x + d.w);
    maxY = Math.max(maxY, d.y + d.h);
  }

  const w = maxX - minX;
  const h = maxY - minY;
  const padX = w * 0.15;
  const padY = h * 0.3;
  minX = Math.max(0, minX - padX);
  minY = Math.max(0, minY - padY);
  maxX = Math.min(W, maxX + padX);
  maxY = Math.min(H, maxY + padY);

  return {
    x: minX / W,
    y: minY / H,
    w: (maxX - minX) / W,
    h: (maxY - minY) / H,
    source: 'face',
  };
}

async function detectSmartCrop(img: HTMLImageElement): Promise<SubjectBox | null> {
  try {
    const mod = await import('smartcrop');
    const smartcrop = mod.default ?? mod;
    const size = Math.min(img.naturalWidth, img.naturalHeight);
    const result = await smartcrop.crop(img, { width: size, height: size });
    const c = result.topCrop;
    return {
      x: c.x / img.naturalWidth,
      y: c.y / img.naturalHeight,
      w: c.width / img.naturalWidth,
      h: c.height / img.naturalHeight,
      source: 'smartcrop',
    };
  } catch (e) {
    console.warn('smartcrop failed', e);
    return null;
  }
}

export async function detectSubject(img: HTMLImageElement): Promise<SubjectBox | null> {
  const faces = await detectFaces(img);
  if (faces) return faces;
  return await detectSmartCrop(img);
}
