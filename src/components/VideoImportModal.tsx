import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import { FrameEditorModal } from './FrameEditorModal';
import { MAX_CLIP_SECONDS } from '../video/constants';
import { createFrameCache, deriveFrames } from '../video/deriveFrames';
import { readVideoMetadata } from '../video/sampler';
import type { AutoFrameMode, DeriveProgress, ExtractionResult, ExtractionWarning, FrameCache, VideoSource } from '../video/types';
import type { ManualFrame, Photo } from '../types';

type Props = {
  open: boolean;
  frameCount: number;
  targetAspect: number;
  onFrameCountChange: (count: number) => void;
  onClose: () => void;
  onUseFrames: (source: VideoSource, result: ExtractionResult, cache: FrameCache) => void;
};

const MIN_FRAMES = 4;
const MAX_FRAMES = 32;

export function VideoImportModal({
  open,
  frameCount,
  targetAspect,
  onFrameCountChange,
  onClose,
  onUseFrames,
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cacheRef = useRef<FrameCache>(createFrameCache());
  const videoUrlRef = useRef<string | null>(null);
  const manualPhotoUrlRef = useRef<string | null>(null);
  const committedResultRef = useRef<ExtractionResult | null>(null);
  const resultRef = useRef<ExtractionResult | null>(null);
  const metadataControllerRef = useRef<AbortController | null>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [source, setSource] = useState<VideoSource | null>(null);
  const [result, setResult] = useState<ExtractionResult | null>(null);
  const [progress, setProgress] = useState<DeriveProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualPhoto, setManualPhoto] = useState<Photo | null>(null);

  useEffect(() => {
    resultRef.current = result;
  }, [result]);

  useEffect(() => {
    if (!source || Math.abs(source.targetAspect - targetAspect) < 0.0001) return;
    setSource((current) => (current ? { ...current, targetAspect } : current));
  }, [source, targetAspect]);

  useEffect(() => {
    if (!open || !source) return;
    const controller = new AbortController();
    setProgress({ stage: 'decode', done: 0, total: 1 });
    setError(null);

    deriveFrames(
      source,
      frameCount,
      cacheRef.current,
      controller.signal,
      setProgress
    )
      .then(async (next) => {
        if (controller.signal.aborted) {
          revokeResultPhotos(next);
          return;
        }
        setResult((prev) => {
          if (prev && prev !== committedResultRef.current) revokeResultPhotos(prev);
          resultRef.current = next;
          return next;
        });
        setProgress(null);
        await refreshManualPhoto(source, cacheRef.current, controller.signal);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setProgress(null);
        setResult((prev) => {
          if (prev && prev !== committedResultRef.current) revokeResultPhotos(prev);
          resultRef.current = null;
          return null;
        });
        setError(err instanceof Error ? err.message : 'Video import failed.');
      });

    return () => controller.abort();
  }, [frameCount, open, source]);

  useEffect(() => {
    return () => {
      metadataControllerRef.current?.abort();
      releasePreviewUrls();
      const current = resultRef.current;
      if (current && current !== committedResultRef.current) revokeResultPhotos(current);
    };
  }, []);

  const manualEditorPhoto = useMemo(() => {
    if (!manualOpen || !manualPhoto) return null;
    return {
      ...manualPhoto,
      manualFrame: source?.manualFrame ?? undefined,
    };
  }, [manualOpen, manualPhoto, source?.manualFrame]);

  if (!open) return null;

  const duration = source?.durationSec ?? 0;
  const trimDuration = source ? Math.max(0.001, source.outSec - source.inSec) : 0;
  const effectiveFps = source ? frameCount / trimDuration : 0;
  const canUse = Boolean(source && result && result.photos.length === frameCount && !progress);

  const handleFiles = async (files: File[]) => {
    const file = files.find((item) => item.type.startsWith('video/'));
    if (!file) {
      setError('Choose a video file.');
      return;
    }

    metadataControllerRef.current?.abort();
    const controller = new AbortController();
    metadataControllerRef.current = controller;
    setProgress({ stage: 'decode', done: 0, total: 1 });
    setError(null);
    setManualOpen(false);
    clearResultState();
    releaseManualPreview();
    try {
      const metadata = await readVideoMetadata(file, controller.signal);
      if (controller.signal.aborted) return;
      if (!Number.isFinite(metadata.durationSec) || metadata.durationSec <= 0) {
        throw new Error('This video does not report a usable duration. Try exporting it as a standard MP4 clip.');
      }
      const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `video-${Date.now()}-${Math.random()}`;
      const url = URL.createObjectURL(file);
      if (videoUrlRef.current) URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = url;
      setVideoUrl(url);
      cacheRef.current = createFrameCache();
      setSource({
        id,
        file,
        filename: file.name,
        durationSec: metadata.durationSec,
        srcWidth: metadata.srcWidth,
        srcHeight: metadata.srcHeight,
        inSec: 0,
        outSec: Math.min(metadata.durationSec, MAX_CLIP_SECONDS),
        mode: 'locked',
        manualFrame: null,
        targetAspect,
      });
    } catch (err) {
      if (controller.signal.aborted) return;
      setProgress(null);
      setError(err instanceof Error ? err.message : 'Could not read the video.');
    } finally {
      if (metadataControllerRef.current === controller) metadataControllerRef.current = null;
    }
  };

  const updateTrim = (nextIn: number, nextOut: number) => {
    setSource((current) => {
      if (!current) return current;
      const durationSec = Math.max(0.001, current.durationSec);
      const minWindow = Math.min(0.1, durationSec);
      let inSec = clamp(nextIn, 0, Math.max(0, durationSec - minWindow));
      let outSec = clamp(nextOut, inSec + minWindow, durationSec);
      if (outSec - inSec > MAX_CLIP_SECONDS) {
        if (nextIn !== current.inSec) outSec = Math.min(durationSec, inSec + MAX_CLIP_SECONDS);
        else inSec = Math.max(0, outSec - MAX_CLIP_SECONDS);
      }
      return { ...current, inSec: roundTime(inSec), outSec: roundTime(outSec) };
    });
  };

  const setMode = (mode: AutoFrameMode) => {
    setSource((current) => (current ? { ...current, mode, manualFrame: null } : current));
  };

  const saveManualFrame = (_photoId: string, frame: ManualFrame) => {
    setManualPhoto((current) => (current ? { ...current, manualFrame: frame } : current));
    setSource((current) => (current ? { ...current, manualFrame: frame } : current));
  };

  const resetManualFrame = () => {
    setManualPhoto((current) => {
      if (!current) return current;
      const { manualFrame, ...rest } = current;
      void manualFrame;
      return rest;
    });
    setSource((current) => (current ? { ...current, manualFrame: null } : current));
  };

  return (
    <div className="cm-modal-back" onClick={handleClose}>
      <div className="cm-modal cm-video-modal" onClick={(event) => event.stopPropagation()}>
        <div className="cm-modal-head">
          <div>
            <h2>Import video</h2>
            <p>Extract exactly {frameCount} flipbook frames from up to {MAX_CLIP_SECONDS} seconds.</p>
          </div>
          <button className="cm-icon-btn" onClick={handleClose} aria-label="Close video import">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="cm-video-body">
          <section
            className={`cm-video-drop ${isDragging ? 'is-dragging' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(event: DragEvent<HTMLElement>) => {
              event.preventDefault();
              setIsDragging(false);
              handleFiles(Array.from(event.dataTransfer.files));
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            {videoUrl ? (
              <video src={videoUrl} muted playsInline controls />
            ) : (
              <div>
                <strong>Add video</strong>
                <span>Drop a short clip or click to browse</span>
              </div>
            )}
          </section>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={(event: ChangeEvent<HTMLInputElement>) => {
              const files = event.target.files ? Array.from(event.target.files) : [];
              event.target.value = '';
              handleFiles(files);
            }}
            hidden
          />

          <section className="cm-video-controls">
            <div className="cm-video-meta">
              <span>{source?.filename ?? 'No clip selected'}</span>
              {source && <b>{source.srcWidth} x {source.srcHeight}px · {duration.toFixed(1)}s</b>}
            </div>

            <label className={`cm-slider ${!source ? 'is-disabled' : ''}`}>
              <span className="cm-slider-row">
                <span className="cm-slider-label">Frames / blades</span>
                <span className="cm-slider-val">{frameCount}</span>
              </span>
              <input
                type="range"
                min={MIN_FRAMES}
                max={MAX_FRAMES}
                value={frameCount}
                disabled={!source}
                onChange={(event) => onFrameCountChange(Number(event.target.value))}
              />
            </label>

            {source && (
              <>
                <div className="cm-video-trim">
                  <label className="cm-slider">
                    <span className="cm-slider-row">
                      <span className="cm-slider-label">In</span>
                      <span className="cm-slider-val">{source.inSec.toFixed(1)}s</span>
                    </span>
                    <input
                      type="range"
                      min={0}
                      max={Math.max(0, source.outSec - 0.1)}
                      step={0.1}
                      value={source.inSec}
                      onChange={(event) => updateTrim(Number(event.target.value), source.outSec)}
                    />
                  </label>
                  <label className="cm-slider">
                    <span className="cm-slider-row">
                      <span className="cm-slider-label">Out</span>
                      <span className="cm-slider-val">{source.outSec.toFixed(1)}s</span>
                    </span>
                    <input
                      type="range"
                      min={Math.min(source.durationSec, source.inSec + 0.1)}
                      max={source.durationSec}
                      step={0.1}
                      value={source.outSec}
                      onChange={(event) => updateTrim(source.inSec, Number(event.target.value))}
                    />
                  </label>
                </div>

                <div className="cm-video-modes" role="radiogroup" aria-label="Video framing mode">
                  {(['locked', 'follow', 'perFrame'] as AutoFrameMode[]).map((mode) => (
                    <button
                      key={mode}
                      className={`cm-mini ${source.mode === mode && !source.manualFrame ? 'is-active' : ''}`}
                      type="button"
                      onClick={() => setMode(mode)}
                    >
                      {mode === 'perFrame' ? 'Per-frame' : capitalize(mode)}
                    </button>
                  ))}
                  <button
                    className={`cm-mini ${source.manualFrame ? 'is-active' : ''}`}
                    type="button"
                    onClick={() => setManualOpen(true)}
                    disabled={!manualPhoto}
                  >
                    Manual crop
                  </button>
                </div>

                <div className="cm-video-hint">
                  <span>{trimDuration.toFixed(1)}s trim</span>
                  <span>{effectiveFps.toFixed(1)} fps effective</span>
                </div>
              </>
            )}

            {progress && (
              <div className="cm-video-progress" aria-live="polite">
                {capitalize(progress.stage)} {progress.done}/{progress.total}
              </div>
            )}
            {error && <div className="cm-video-error">{error}</div>}
            {result?.warnings.map((warning) => (
              <div className="cm-video-warning" key={`${warning.kind}-${warningText(warning)}`}>
                {warningText(warning)}
              </div>
            ))}
          </section>

          <section className="cm-video-strip" aria-label="Extracted frames preview">
            {result?.photos.map((photo, index) => (
              <div className="cm-video-frame" key={photo.id}>
                <img src={photo.src} alt="" />
                <span>{String(index + 1).padStart(2, '0')}</span>
              </div>
            ))}
          </section>
        </div>

        <div className="cm-modal-foot">
          <button className="cm-btn cm-btn-ghost" type="button" onClick={handleClose}>Cancel</button>
          <button
            className="cm-btn cm-btn-primary"
            type="button"
            disabled={!canUse || !source || !result}
            onClick={() => {
              if (!source || !result) return;
              committedResultRef.current = result;
              onUseFrames(source, result, cacheRef.current);
              setResult(null);
              resultRef.current = null;
              handleClose();
            }}
          >
            Use these frames
          </button>
        </div>

        <FrameEditorModal
          photo={manualEditorPhoto}
          aspectRatio={targetAspect}
          closeUpTightness={0.75}
          onClose={() => setManualOpen(false)}
          onSave={saveManualFrame}
          onReset={resetManualFrame}
        />
      </div>
    </div>
  );

  function handleClose() {
    metadataControllerRef.current?.abort();
    setProgress(null);
    setError(null);
    setManualOpen(false);
    clearResultState();
    releasePreviewUrls();
    setVideoUrl(null);
    setManualPhoto(null);
    setSource(null);
    cacheRef.current = createFrameCache();
    onClose();
  }

  function clearResultState() {
    const current = resultRef.current;
    if (current && current !== committedResultRef.current) revokeResultPhotos(current);
    resultRef.current = null;
    setResult(null);
  }

  function releasePreviewUrls() {
    if (videoUrlRef.current) {
      URL.revokeObjectURL(videoUrlRef.current);
      videoUrlRef.current = null;
    }
    releaseManualPreview();
  }

  function releaseManualPreview() {
    if (manualPhotoUrlRef.current) {
      URL.revokeObjectURL(manualPhotoUrlRef.current);
      manualPhotoUrlRef.current = null;
    }
  }

  async function refreshManualPhoto(current: VideoSource, cache: FrameCache, signal?: AbortSignal) {
    const frame = cache.rawFrames[Math.floor(cache.rawFrames.length / 2)];
    if (!frame) return;
    const blob = await canvasToBlob(frame.bitmap);
    if (signal?.aborted) return;
    const url = URL.createObjectURL(blob);
    if (manualPhotoUrlRef.current) URL.revokeObjectURL(manualPhotoUrlRef.current);
    manualPhotoUrlRef.current = url;
    const subject = cache.subjects[Math.floor(cache.subjects.length / 2)] ?? null;
    setManualPhoto({
      id: `${current.id}-manual`,
      src: url,
      naturalWidth: frame.width,
      naturalHeight: frame.height,
      subject,
      manualFrame: current.manualFrame ?? undefined,
    });
  }
}

function revokeResultPhotos(result: ExtractionResult) {
  for (const photo of result.photos) {
    if (photo.src.startsWith('blob:')) URL.revokeObjectURL(photo.src);
  }
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not preview video frame.'))), 'image/jpeg', 0.9);
  });
}

function warningText(warning: ExtractionWarning) {
  if (warning.kind === 'lowFps') {
    return `Low frame rate (${warning.effectiveFps.toFixed(1)} fps). Add blades or shorten the trim for smoother motion.`;
  }
  if (warning.kind === 'noSubject') {
    return 'No subject detected in this clip. Using center framing; try Manual crop.';
  }
  return warning.message;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function roundTime(value: number) {
  return Math.round(value * 10) / 10;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}
