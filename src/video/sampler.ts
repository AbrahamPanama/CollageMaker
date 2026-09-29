import type { RawFrame, VideoMetadata } from './types';

const METADATA_TIMEOUT_MS = 6000;
const SEEK_TIMEOUT_MS = 3500;

export function sampleTimestamps(inSec: number, outSec: number, count: number): number[] {
  const safeCount = Math.max(0, Math.floor(count));
  if (safeCount === 0) return [];
  const start = Math.max(0, inSec);
  const end = Math.max(start + 0.001, outSec);
  const duration = end - start;

  return Array.from({ length: safeCount }, (_, index) => start + (index + 0.5) * duration / safeCount);
}

export function selectNearestFrames(frames: RawFrame[], inSec: number, outSec: number, count: number): RawFrame[] {
  if (frames.length === 0) return [];
  return sampleTimestamps(inSec, outSec, count).map((target, index) => {
    let nearest = frames[0];
    let nearestDistance = Math.abs(nearest.tSec - target);
    for (const frame of frames) {
      const distance = Math.abs(frame.tSec - target);
      if (distance < nearestDistance) {
        nearest = frame;
        nearestDistance = distance;
      }
    }
    return { ...nearest, index, tSec: target };
  });
}

export async function readVideoMetadata(file: File, signal?: AbortSignal): Promise<VideoMetadata> {
  const { video, url, cleanup } = createVideo(file);
  try {
    await waitForVideoMetadata(video, signal);
    return {
      durationSec: Number.isFinite(video.duration) ? video.duration : 0,
      srcWidth: video.videoWidth,
      srcHeight: video.videoHeight,
    };
  } finally {
    cleanup(url, video);
  }
}

export async function decodeFrames(
  file: File,
  inSec: number,
  outSec: number,
  count: number,
  longEdgePx: number,
  signal?: AbortSignal,
  onProgress?: (done: number, total: number) => void
): Promise<RawFrame[]> {
  const { video, url, cleanup } = createVideo(file);
  try {
    await waitForVideoMetadata(video, signal);
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) throw new Error('Video has no readable dimensions.');

    const outSize = fitLongEdge(width, height, longEdgePx);
    const times = sampleTimestamps(inSec, outSec, count).map((time) =>
      clamp(time, 0, Math.max(0, video.duration || outSec))
    );
    const frames: RawFrame[] = [];

    for (let index = 0; index < times.length; index++) {
      throwIfAborted(signal);
      const tSec = times[index];
      await seekVideo(video, tSec, signal);
      const canvas = document.createElement('canvas');
      canvas.width = outSize.width;
      canvas.height = outSize.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas is not available for video decoding.');
      ctx.drawImage(video, 0, 0, outSize.width, outSize.height);
      frames.push({ index, tSec, bitmap: canvas, width: outSize.width, height: outSize.height });
      onProgress?.(index + 1, times.length);
    }

    return frames;
  } finally {
    cleanup(url, video);
  }
}

function createVideo(file: File) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'auto';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  return { video, url, cleanup };
}

function cleanup(url: string, video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute('src');
  video.load();
  URL.revokeObjectURL(url);
}

function waitForVideoMetadata(video: HTMLVideoElement, signal?: AbortSignal): Promise<void> {
  return withTimeout(
    new Promise((resolve, reject) => {
      const cleanupListeners = () => {
        video.removeEventListener('loadedmetadata', handleLoaded);
        video.removeEventListener('error', handleError);
        signal?.removeEventListener('abort', handleAbort);
      };
      const handleLoaded = () => {
        cleanupListeners();
        resolve();
      };
      const handleError = () => {
        cleanupListeners();
        reject(new Error('This video format could not be decoded. Try an MP4/H.264 clip.'));
      };
      const handleAbort = () => {
        cleanupListeners();
        reject(new DOMException('Video import aborted', 'AbortError'));
      };
      video.addEventListener('loadedmetadata', handleLoaded, { once: true });
      video.addEventListener('error', handleError, { once: true });
      signal?.addEventListener('abort', handleAbort, { once: true });
      video.load();
    }),
    METADATA_TIMEOUT_MS,
    'Timed out while reading video metadata.'
  );
}

function seekVideo(video: HTMLVideoElement, tSec: number, signal?: AbortSignal): Promise<void> {
  return withTimeout(
    new Promise((resolve, reject) => {
      const cleanupListeners = () => {
        video.removeEventListener('seeked', handleSeeked);
        video.removeEventListener('error', handleError);
        signal?.removeEventListener('abort', handleAbort);
      };
      const handleSeeked = () => {
        cleanupListeners();
        waitForDrawableFrame(video).then(resolve, resolve);
      };
      const handleError = () => {
        cleanupListeners();
        reject(new Error('A video frame could not be decoded.'));
      };
      const handleAbort = () => {
        cleanupListeners();
        reject(new DOMException('Video import aborted', 'AbortError'));
      };
      video.addEventListener('seeked', handleSeeked, { once: true });
      video.addEventListener('error', handleError, { once: true });
      signal?.addEventListener('abort', handleAbort, { once: true });
      video.currentTime = tSec;
    }),
    SEEK_TIMEOUT_MS,
    'Timed out while seeking the video.'
  );
}

function waitForDrawableFrame(video: HTMLVideoElement): Promise<void> {
  if (!video.requestVideoFrameCallback) return Promise.resolve();
  return new Promise((resolve) => {
    let settled = false;
    let rafId = 0;
    let timerId = 0;
    const done = () => {
      if (settled) return;
      settled = true;
      if (rafId) window.cancelAnimationFrame(rafId);
      if (timerId) window.clearTimeout(timerId);
      resolve();
    };

    try {
      video.requestVideoFrameCallback(() => done());
    } catch {
      done();
      return;
    }

    rafId = window.requestAnimationFrame(done);
    timerId = window.setTimeout(done, 80);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function fitLongEdge(width: number, height: number, longEdgePx: number) {
  const scale = Math.min(1, longEdgePx / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Video import aborted', 'AbortError');
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
