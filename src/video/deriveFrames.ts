import type { Photo } from '../types';
import { DECODE_LONG_EDGE_PX, MAX_DECODE_FRAMES, SMOOTH_FPS_HINT } from './constants';
import { bakeFrame, revokePhotos } from './bake';
import { computeCropRects, detectFrameSubjects } from './framing';
import { decodeFrames, selectNearestFrames } from './sampler';
import type { DeriveProgress, ExtractionResult, ExtractionWarning, FrameCache, FrameSubject, VideoSource } from './types';

export function createFrameCache(): FrameCache {
  return {
    rawKey: null,
    rawFrames: [],
    subjects: [],
  };
}

export async function deriveFrames(
  source: VideoSource,
  n: number,
  cache: FrameCache,
  signal?: AbortSignal,
  onProgress?: (progress: DeriveProgress) => void
): Promise<ExtractionResult> {
  const rawKey = getRawKey(source);
  const decodeCount = getDecodeFrameCount(n);
  if (cache.rawKey !== rawKey || cache.rawFrames.length < decodeCount) {
    cache.rawFrames = await decodeFrames(
      source.file,
      source.inSec,
      source.outSec,
      decodeCount,
      DECODE_LONG_EDGE_PX,
      signal,
      (done, total) => onProgress?.({ stage: 'decode', done, total })
    );
    cache.subjects = await detectFrameSubjects(
      cache.rawFrames,
      signal,
      (done, total) => onProgress?.({ stage: 'detect', done, total })
    );
    cache.rawKey = rawKey;
  }

  const selectedFrames = selectNearestFrames(cache.rawFrames, source.inSec, source.outSec, n);
  const selectedSubjects = selectNearestSubjects(
    cache.rawFrames,
    cache.subjects,
    selectedFrames
  );
  const warnings = buildWarnings(source, n, selectedSubjects);
  const first = selectedFrames[0];
  const cropRects = computeCropRects(
    selectedSubjects,
    source.mode,
    source.manualFrame,
    source.targetAspect,
    first?.width ?? source.srcWidth,
    first?.height ?? source.srcHeight
  );

  const photos: Photo[] = [];
  try {
    for (let index = 0; index < selectedFrames.length; index++) {
      throwIfAborted(signal);
      photos.push(await bakeFrame(
        selectedFrames[index],
        cropRects[index],
        source.targetAspect,
        `${source.id}-frame-${index}`
      ));
      onProgress?.({ stage: 'bake', done: index + 1, total: selectedFrames.length });
    }
  } catch (error) {
    revokePhotos(photos);
    throw error;
  }

  return {
    photos,
    subjects: selectedSubjects,
    effectiveFps: n / getTrimDuration(source),
    warnings,
  };
}

function getDecodeFrameCount(n: number) {
  return Math.min(MAX_DECODE_FRAMES, Math.max(Math.min(MAX_DECODE_FRAMES, 16), Math.max(1, n)));
}

export function getTrimDuration(source: Pick<VideoSource, 'inSec' | 'outSec'>) {
  return Math.max(0.001, source.outSec - source.inSec);
}

function getRawKey(source: VideoSource) {
  return [
    source.id,
    source.file.name,
    source.file.lastModified,
    source.file.size,
    source.inSec.toFixed(3),
    source.outSec.toFixed(3),
  ].join(':');
}

function selectNearestSubjects(
  rawFrames: { tSec: number }[],
  subjects: FrameSubject[],
  selectedFrames: { tSec: number }[]
): FrameSubject[] {
  return selectedFrames.map((selected) => {
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    for (let index = 0; index < rawFrames.length; index++) {
      const distance = Math.abs(rawFrames[index].tSec - selected.tSec);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestIndex = index;
      }
    }
    return subjects[nearestIndex] ?? null;
  });
}

function buildWarnings(source: VideoSource, n: number, subjects: FrameSubject[]): ExtractionWarning[] {
  const warnings: ExtractionWarning[] = [];
  const effectiveFps = n / getTrimDuration(source);
  if (effectiveFps < SMOOTH_FPS_HINT) warnings.push({ kind: 'lowFps', effectiveFps });

  const missing = subjects
    .map((subject, index) => (subject ? -1 : index))
    .filter((index) => index >= 0);
  if (missing.length === subjects.length) {
    warnings.push({ kind: 'noSubject', frameIndices: missing });
  }
  return warnings;
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Video import aborted', 'AbortError');
}
