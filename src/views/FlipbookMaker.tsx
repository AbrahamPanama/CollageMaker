import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent, DragEvent, KeyboardEvent } from 'react';
import { FrameEditorModal } from '../components/FrameEditorModal';
import { ExportModal, type ExportSettings } from '../components/ExportModal';
import { VideoImportModal } from '../components/VideoImportModal';
import {
  FLIPBOOK_BLADE_LABEL,
  FLIPBOOK_BLADE_PATH_D,
  FLIPBOOK_BLADE_PATH_TRANSFORM,
  FLIPBOOK_FRAME_ASPECT,
  FLIPBOOK_BLADE_VIEWBOX,
  getFlipbookBladeBleedSvgPath,
} from '../flipbook/blade';
import { saveFlipbookPdf } from '../flipbook/export';
import {
  buildFlipbookBlades,
  buildPrintPages,
  formatFrame,
  shouldMirrorBackArtworkX,
  type BladeHalf,
  type BladeSide,
  type DuplexMode,
  type FlipbookBlade,
  type PrintPage,
} from '../flipbook/logic';
import { computePhotoPlacement } from '../photoFraming';
import { loadPhoto } from '../photoIngest';
import { detectPhotoSubjects } from '../smartFrame';
import { revokePhotos } from '../video/bake';
import { createFrameCache, deriveFrames, getTrimDuration } from '../video/deriveFrames';
import type { DeriveProgress, ExtractionResult, ExtractionWarning, FrameCache, VideoSource } from '../video/types';
import type { ManualFrame, Photo } from '../types';

const MIN_FRAMES = 4;
const MAX_FRAMES = 32;
const DEFAULT_BLEED_MM = 1;
const MAX_BLEED_MM = 2;
const PRINT_MARGIN_MM = 2;
const PRINT_GAP_MM = 1;
const MM_PER_INCH = 25.4;
const MIN_PAGE_MM = 25;
const MAX_PAGE_MM = 1200;
const PRINT_DPI = 300;

const PAGE_PRESETS = [
  { id: 'letter', name: 'Letter', widthMm: 215.9, heightMm: 279.4 },
  { id: 'a4', name: 'A4', widthMm: 210, heightMm: 297 },
  { id: 'legal', name: 'Legal', widthMm: 215.9, heightMm: 355.6 },
  { id: 'tabloid', name: 'Tabloid', widthMm: 279.4, heightMm: 431.8 },
  { id: 'a3', name: 'A3', widthMm: 297, heightMm: 420 },
  { id: 'custom', name: 'Custom', widthMm: 215.9, heightMm: 279.4 },
] as const;

type PagePresetId = (typeof PAGE_PRESETS)[number]['id'];
type PageUnit = 'mm' | 'in';

const BLADE_VIEWBOX = FLIPBOOK_BLADE_VIEWBOX;
const BLADE_PATH_TRANSFORM = FLIPBOOK_BLADE_PATH_TRANSFORM;
const BLADE_PATH_D = FLIPBOOK_BLADE_PATH_D;

type FlipbookPhoto = Photo & { name: string };

type FrameSource = {
  frame: number;
  photo: FlipbookPhoto | null;
  repeated: boolean;
};

type PrintLayout = {
  columns: number;
  rows: number;
  bladesPerPage: number;
  slotWidthMm: number;
  slotHeightMm: number;
  gapMm: number;
  marginMm: number;
};

type PageDraftState =
  | { isValid: true; widthMm: number; heightMm: number }
  | { isValid: false; error: string };

type Props = {
  onPhotoCountChange: (count: number) => void;
  onExportRequest: (open: boolean) => void;
  exportOpen: boolean;
};

export function FlipbookMaker({ onPhotoCountChange, onExportRequest, exportOpen }: Props) {
  const [photos, setPhotos] = useState<FlipbookPhoto[]>([]);
  const [frameCount, setFrameCount] = useState(MIN_FRAMES);
  const [duplexMode, setDuplexMode] = useState<DuplexMode>('row-mirror');
  const [autoFrame, setAutoFrame] = useState(true);
  const [closeUpTightness, setCloseUpTightness] = useState(0.75);
  const [showDetections, setShowDetections] = useState(false);
  const [pagePresetId, setPagePresetId] = useState<PagePresetId>('letter');
  const [pageWidthMm, setPageWidthMm] = useState<number>(PAGE_PRESETS[0].widthMm);
  const [pageHeightMm, setPageHeightMm] = useState<number>(PAGE_PRESETS[0].heightMm);
  const [pageUnit, setPageUnit] = useState<PageUnit>('mm');
  const [draftPageWidth, setDraftPageWidth] = useState(formatPageDimension(PAGE_PRESETS[0].widthMm, 'mm'));
  const [draftPageHeight, setDraftPageHeight] = useState(formatPageDimension(PAGE_PRESETS[0].heightMm, 'mm'));
  const [bleedMm, setBleedMm] = useState(DEFAULT_BLEED_MM);
  const [analyzing, setAnalyzing] = useState<{ done: number; total: number } | null>(null);
  const [editingPhotoId, setEditingPhotoId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [draggedPhotoId, setDraggedPhotoId] = useState<string | null>(null);
  const [dropTargetPhotoId, setDropTargetPhotoId] = useState<string | null>(null);
  const [videoImportOpen, setVideoImportOpen] = useState(false);
  const [videoSource, setVideoSource] = useState<VideoSource | null>(null);
  const [videoWarnings, setVideoWarnings] = useState<ExtractionWarning[]>([]);
  const [videoProgress, setVideoProgress] = useState<DeriveProgress | null>(null);
  const [videoError, setVideoError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoFrameCacheRef = useRef<FrameCache>(createFrameCache());
  const ownedVideoPhotosRef = useRef<Photo[]>([]);
  const skipNextVideoDeriveRef = useRef(false);
  const videoDeriveSeqRef = useRef(0);
  const isVideoMode = Boolean(videoSource);

  useEffect(() => {
    onPhotoCountChange(photos.length);
  }, [onPhotoCountChange, photos.length]);

  useEffect(() => {
    if (!isVideoMode && photos.length > frameCount) {
      setFrameCount(Math.min(MAX_FRAMES, Math.max(MIN_FRAMES, photos.length)));
    }
  }, [frameCount, isVideoMode, photos.length]);

  useEffect(() => {
    return () => {
      revokeOwnedVideoPhotos();
    };
  }, []);

  useEffect(() => {
    if (!videoSource) return;
    if (skipNextVideoDeriveRef.current) {
      skipNextVideoDeriveRef.current = false;
      return;
    }

    const controller = new AbortController();
    const sequence = ++videoDeriveSeqRef.current;
    setVideoProgress({ stage: 'decode', done: 0, total: 1 });
    setVideoError(null);

    deriveFrames(
      videoSource,
      frameCount,
      videoFrameCacheRef.current,
      controller.signal,
      setVideoProgress
    )
      .then((result) => {
        if (controller.signal.aborted || sequence !== videoDeriveSeqRef.current) {
          revokePhotos(result.photos);
          return;
        }
        replaceWithVideoFrames(videoSource, result);
        setVideoWarnings(result.warnings);
        setVideoProgress(null);
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setVideoProgress(null);
        setVideoError(error instanceof Error ? error.message : 'Could not re-sample the video frames.');
      });

    return () => controller.abort();
  }, [frameCount, videoSource]);

  const frames = useMemo<FrameSource[]>(() => {
    return Array.from({ length: frameCount }, (_, frame) => {
      if (isVideoMode) {
        return { frame, photo: photos[frame] ?? null, repeated: false };
      }
      const photo = photos.length > 0 ? photos[frame % photos.length] : null;
      return { frame, photo, repeated: photos.length > 0 && frame >= photos.length };
    });
  }, [frameCount, isVideoMode, photos]);

  const blades = useMemo(() => buildFlipbookBlades(frameCount), [frameCount]);
  const printLayout = useMemo(
    () => computePrintLayout(pageWidthMm, pageHeightMm, bleedMm),
    [bleedMm, pageHeightMm, pageWidthMm]
  );
  const printPages = useMemo(
    () => buildPrintPages(blades, printLayout.columns, printLayout.bladesPerPage, duplexMode),
    [blades, duplexMode, printLayout.bladesPerPage, printLayout.columns]
  );
  const pageSetup = useMemo(
    () => ({ widthMm: pageWidthMm, heightMm: pageHeightMm, unit: pageUnit, bleedMm, printLayout }),
    [bleedMm, pageHeightMm, pageUnit, pageWidthMm, printLayout]
  );
  const pageDraftState = useMemo(
    () => readPageDraft(draftPageWidth, draftPageHeight, pageUnit),
    [draftPageHeight, draftPageWidth, pageUnit]
  );
  const hasPendingPageSize =
    pageDraftState.isValid &&
    (Math.abs(pageDraftState.widthMm - pageWidthMm) > 0.05 ||
      Math.abs(pageDraftState.heightMm - pageHeightMm) > 0.05);
  const unitLabel = pageUnit === 'in' ? 'in' : 'mm';
  const pageSizeNote = pageDraftState.isValid
    ? hasPendingPageSize
      ? `Pending media size: ${formatPageDimension(pageDraftState.widthMm, pageUnit)} x ${formatPageDimension(pageDraftState.heightMm, pageUnit)} ${unitLabel}.`
      : `Applied media size: ${formatPageDimension(pageWidthMm, pageUnit)} x ${formatPageDimension(pageHeightMm, pageUnit)} ${unitLabel}.`
    : pageDraftState.error;
  const pageSizeNoteClass = `cm-flip-field-note ${pageDraftState.isValid ? '' : 'is-error'}`;

  const ingestFiles = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    if (videoSource) {
      clearVideoSource();
      setPhotos([]);
    }
    setAnalyzing({ done: 0, total: imageFiles.length });
    try {
      for (let i = 0; i < imageFiles.length; i++) {
        const photo = await loadPhoto(imageFiles[i]);
        if (photo) setPhotos((prev) => [...prev, photo]);
        setAnalyzing({ done: i + 1, total: imageFiles.length });
      }
    } finally {
      setAnalyzing(null);
    }
  };

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files ? Array.from(event.target.files) : [];
    event.target.value = '';
    ingestFiles(files);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    ingestFiles(Array.from(event.dataTransfer.files));
  };

  const handleDropKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    fileInputRef.current?.click();
  };

  const clearPhotoDrag = () => {
    setDraggedPhotoId(null);
    setDropTargetPhotoId(null);
  };

  const reorderPhoto = (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    setPhotos((prev) => {
      const fromIndex = prev.findIndex((photo) => photo.id === draggedId);
      const targetIndex = prev.findIndex((photo) => photo.id === targetId);
      if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return prev;

      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      const targetIndexAfterRemoval = next.findIndex((photo) => photo.id === targetId);
      const insertAt = fromIndex < targetIndex ? targetIndexAfterRemoval + 1 : targetIndexAfterRemoval;
      next.splice(insertAt, 0, moved);
      return next;
    });
  };

  const handlePhotoDragStart = (event: DragEvent<HTMLDivElement>, photoId: string) => {
    if (isVideoMode) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', photoId);
    setDraggedPhotoId(photoId);
    setDropTargetPhotoId(null);
  };

  const handlePhotoDragOver = (event: DragEvent<HTMLDivElement>, photoId: string) => {
    if (isVideoMode) return;
    if (!draggedPhotoId || draggedPhotoId === photoId) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTargetPhotoId(photoId);
  };

  const handlePhotoDrop = (event: DragEvent<HTMLDivElement>, photoId: string) => {
    if (isVideoMode) return;
    event.preventDefault();
    event.stopPropagation();
    const droppedPhotoId = event.dataTransfer.getData('text/plain') || draggedPhotoId;
    if (droppedPhotoId) reorderPhoto(droppedPhotoId, photoId);
    clearPhotoDrag();
  };

  const removePhoto = (photoId: string) => {
    if (isVideoMode) return;
    setPhotos((prev) => prev.filter((photo) => photo.id !== photoId));
    setEditingPhotoId((current) => (current === photoId ? null : current));
    setDraggedPhotoId((current) => (current === photoId ? null : current));
    setDropTargetPhotoId((current) => (current === photoId ? null : current));
  };

  const clearPhotos = () => {
    clearVideoSource();
    setPhotos([]);
    setEditingPhotoId(null);
  };
  const editingPhoto = useMemo(
    () => photos.find((photo) => photo.id === editingPhotoId) ?? null,
    [editingPhotoId, photos]
  );

  const saveManualFrame = (photoId: string, frame: ManualFrame) => {
    if (isVideoMode) return;
    setPhotos((prev) =>
      prev.map((photo) => (photo.id === photoId ? { ...photo, manualFrame: frame } : photo))
    );
  };

  const resetManualFrame = (photoId: string) => {
    if (isVideoMode) return;
    setPhotos((prev) =>
      prev.map((photo) => {
        if (photo.id !== photoId) return photo;
        const { manualFrame, ...rest } = photo;
        void manualFrame;
        return rest;
      })
    );
  };

  const redetectPhotos = async () => {
    if (isVideoMode) return;
    if (photos.length === 0) return;
    setAnalyzing({ done: 0, total: photos.length });
    try {
      for (let i = 0; i < photos.length; i++) {
        const photo = photos[i];
        const image = await loadImage(photo.src);
        if (image) {
          const detection = await detectPhotoSubjects(image);
          setPhotos((prev) =>
            prev.map((item) =>
              item.id === photo.id
                ? {
                    ...item,
                    subject: detection.subject,
                    detections: detection.detections,
                  }
                : item
            )
          );
        }
        setAnalyzing({ done: i + 1, total: photos.length });
      }
    } finally {
      setAnalyzing(null);
    }
  };

  const handleExport = async (settings: ExportSettings) => {
    if (settings.format !== 'pdf') {
      alert('Flipbook export currently produces print-ready PDF files.');
      return;
    }
    if (videoProgress || (isVideoMode && photos.length !== frameCount)) {
      alert('Video frames are still rendering. Try exporting again once the progress indicator clears.');
      return;
    }
    setExporting(true);
    try {
      const saved = await saveFlipbookPdf({
        frames,
        printPages,
        pageWidthMm,
        pageHeightMm,
        bleedMm,
        printLayout,
        autoFrame,
        closeUpTightness,
        mirrorBackArtworkX: shouldMirrorBackArtworkX(duplexMode),
        preventPureWhite: settings.preventPureWhite,
        dpi: PRINT_DPI,
        baseName: `flipbook-print-${Date.now()}`,
      });
      if (saved) onExportRequest(false);
    } catch (error) {
      console.error('Flipbook export failed', error);
      alert('Flipbook export failed. Try fewer frames or a smaller media size.');
    } finally {
      setExporting(false);
    }
  };

  const setPagePreset = (presetId: PagePresetId) => {
    setPagePresetId(presetId);
    const preset = PAGE_PRESETS.find((item) => item.id === presetId);
    if (!preset || preset.id === 'custom') return;
    setPageWidthMm(preset.widthMm);
    setPageHeightMm(preset.heightMm);
    setDraftPageWidth(formatPageDimension(preset.widthMm, pageUnit));
    setDraftPageHeight(formatPageDimension(preset.heightMm, pageUnit));
  };

  const setMediaUnit = (unit: PageUnit) => {
    setPageUnit(unit);
    setDraftPageWidth(formatPageDimension(pageWidthMm, unit));
    setDraftPageHeight(formatPageDimension(pageHeightMm, unit));
  };

  const applyPageSize = () => {
    if (!pageDraftState.isValid) return;
    setPagePresetId('custom');
    setPageWidthMm(pageDraftState.widthMm);
    setPageHeightMm(pageDraftState.heightMm);
    setDraftPageWidth(formatPageDimension(pageDraftState.widthMm, pageUnit));
    setDraftPageHeight(formatPageDimension(pageDraftState.heightMm, pageUnit));
  };

  const swapPageOrientation = () => {
    setDraftPageWidth(draftPageHeight);
    setDraftPageHeight(draftPageWidth);
  };

  const handleUseVideoFrames = (source: VideoSource, result: ExtractionResult, cache: FrameCache) => {
    videoFrameCacheRef.current = cache;
    skipNextVideoDeriveRef.current = true;
    setVideoSource(source);
    setVideoWarnings(result.warnings);
    setVideoProgress(null);
    setVideoError(null);
    setEditingPhotoId(null);
    clearPhotoDrag();
    replaceWithVideoFrames(source, result);
  };

  function replaceWithVideoFrames(source: VideoSource, result: ExtractionResult) {
    const nextPhotos = result.photos.map((photo, index) => ({
      ...photo,
      name: `${source.filename} frame ${index + 1}`,
    }));
    revokeOwnedVideoPhotos(nextPhotos);
    ownedVideoPhotosRef.current = nextPhotos;
    setPhotos(nextPhotos);
  }

  function clearVideoSource() {
    setVideoSource(null);
    setVideoWarnings([]);
    setVideoProgress(null);
    setVideoError(null);
    videoFrameCacheRef.current = createFrameCache();
    skipNextVideoDeriveRef.current = false;
    revokeOwnedVideoPhotos();
  }

  function revokeOwnedVideoPhotos(nextPhotos: Photo[] = []) {
    if (ownedVideoPhotosRef.current.length === 0) return;
    const keep = new Set(nextPhotos.map((photo) => photo.src));
    revokePhotos(ownedVideoPhotosRef.current.filter((photo) => !keep.has(photo.src)));
    ownedVideoPhotosRef.current = nextPhotos;
  }

  return (
    <main className="cm-flip-view">
      <aside className="cm-flip-sidebar">
        <section className="cm-section">
          <h3 className="cm-section-h">Photos</h3>
          <div
            className={`cm-flip-drop ${isDragging ? 'is-dragging' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={handleDropKey}
            role="button"
            tabIndex={0}
          >
            <strong>Add images</strong>
            <span>Drop photos or click to browse</span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            onChange={handleFiles}
            hidden
          />
          <div className="cm-row cm-row-tight cm-flip-import-row">
            <button className="cm-mini cm-mini-primary" type="button" onClick={() => setVideoImportOpen(true)}>
              Import video
            </button>
          </div>
          {videoSource && (
            <div className="cm-video-active">
              <div>
                <b>{videoSource.filename}</b>
                <span>
                  {frameCount} frames · {getTrimDuration(videoSource).toFixed(1)}s · {formatVideoMode(videoSource.mode)}
                  {videoSource.manualFrame ? ' manual' : ''}
                </span>
              </div>
              {videoProgress && <small>{formatVideoProgress(videoProgress)}</small>}
              {videoError && <small className="is-error">{videoError}</small>}
              {videoWarnings.map((warning) => (
                <small key={`${warning.kind}-${videoWarningText(warning)}`}>{videoWarningText(warning)}</small>
              ))}
            </div>
          )}
          <div className="cm-flip-photo-grid">
            {photos.map((photo, index) => (
              <div
                className={`cm-flip-photo ${
                  photo.manualFrame
                    ? 'is-manual'
                    : photo.subject?.source === 'face' || photo.subject?.source === 'hybrid'
                      ? 'is-face'
                      : photo.subject?.source === 'person'
                        ? 'is-person'
                      : photo.subject?.source === 'smartcrop'
                        ? 'is-smartcrop'
                        : ''
                } ${isVideoMode ? 'is-video-frame' : ''} ${draggedPhotoId === photo.id ? 'is-reordering' : ''} ${
                  dropTargetPhotoId === photo.id ? 'is-drop-target' : ''
                }`}
                key={photo.id}
                draggable={!isVideoMode}
                title={
                  isVideoMode
                    ? 'Generated video frame'
                    : photo.manualFrame
                    ? 'Manual frame active. Drag to reorder.'
                    : photo.subject
                      ? `Auto framed by ${photo.subject.source}. Drag to reorder.`
                      : 'Click to frame manually or drag to reorder'
                }
                onDragStart={(event) => handlePhotoDragStart(event, photo.id)}
                onDragOver={(event) => handlePhotoDragOver(event, photo.id)}
                onDrop={(event) => handlePhotoDrop(event, photo.id)}
                onDragEnd={clearPhotoDrag}
              >
                <img src={photo.src} alt="" draggable={false} />
                <span>{formatFrame(index)}</span>
                {!isVideoMode && (
                  <>
                    <button
                      className="cm-flip-photo-open"
                      type="button"
                      aria-label={`Crop photo ${index + 1}`}
                      onClick={() => setEditingPhotoId(photo.id)}
                    />
                    <button
                      className="cm-flip-photo-delete"
                      type="button"
                      title="Delete photo"
                      onClick={(event) => {
                        event.stopPropagation();
                        removePhoto(photo.id);
                      }}
                    >
                      x
                    </button>
                    {photo.manualFrame && <small>M</small>}
                  </>
                )}
              </div>
            ))}
          </div>
          {analyzing && <div className="cm-analyzing">Analyzing {analyzing.done}/{analyzing.total}...</div>}
          {photos.length > 0 && (
            <div className="cm-row cm-row-tight">
              {isVideoMode ? (
                <button className="cm-mini" type="button" onClick={() => setVideoImportOpen(true)}>
                  Re-sample
                </button>
              ) : (
                <button className="cm-mini" type="button" onClick={redetectPhotos} disabled={Boolean(analyzing)}>
                  Re-detect
                </button>
              )}
              <button className="cm-mini" type="button" onClick={clearPhotos}>
                {isVideoMode ? 'Clear video' : 'Clear photos'}
              </button>
            </div>
          )}
        </section>

        <section className="cm-section">
          <h3 className="cm-section-h">Setup</h3>
          <label className="cm-slider">
            <span className="cm-slider-row">
              <span className="cm-slider-label">Frames</span>
              <span className="cm-slider-val">{frameCount}</span>
            </span>
            <input
              type="range"
              min={MIN_FRAMES}
              max={MAX_FRAMES}
              value={frameCount}
              onChange={(event) => setFrameCount(Number(event.target.value))}
            />
          </label>
          <label className="cm-field">
            <span className="cm-field-label">Print workflow</span>
            <select value={duplexMode} onChange={(e) => setDuplexMode(e.target.value as DuplexMode)}>
              <option value="row-mirror">Duplex long-edge</option>
              <option value="column-mirror">Duplex short-edge</option>
              <option value="rotate-180">Duplex rotate 180</option>
              <option value="flatbed">Flatbed template</option>
            </select>
          </label>
          <p className="cm-flip-field-note">{getPrintWorkflowNote(duplexMode)}</p>
          <label className="cm-toggle">
            <span>Auto close-up</span>
            <span
              className={`cm-switch ${autoFrame ? 'is-on' : ''}`}
              onClick={() => setAutoFrame((value) => !value)}
            >
              <span className="cm-switch-knob" />
            </span>
          </label>
          <label className={`cm-slider ${!autoFrame ? 'is-disabled' : ''}`}>
            <span className="cm-slider-row">
              <span className="cm-slider-label">Tightness</span>
              <span className="cm-slider-val">{Math.round(closeUpTightness * 100)}%</span>
            </span>
            <input
              type="range"
              min={40}
              max={95}
              value={Math.round(closeUpTightness * 100)}
              disabled={!autoFrame}
              onChange={(event) => setCloseUpTightness(Number(event.target.value) / 100)}
            />
          </label>
          <label className="cm-toggle">
            <span>Show detections</span>
            <span
              className={`cm-switch ${showDetections ? 'is-on' : ''}`}
              onClick={() => setShowDetections((value) => !value)}
            >
              <span className="cm-switch-knob" />
            </span>
          </label>
          <div className="cm-row">
            <label className="cm-field cm-field-inline">
              <span className="cm-field-label">Page preset</span>
              <select
                value={pagePresetId}
                onChange={(event) => setPagePreset(event.target.value as PagePresetId)}
              >
                {PAGE_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="cm-field cm-field-unit">
              <span className="cm-field-label">Units</span>
              <select value={pageUnit} onChange={(event) => setMediaUnit(event.target.value as PageUnit)}>
                <option value="mm">mm</option>
                <option value="in">in</option>
              </select>
            </label>
          </div>
          <div className="cm-row">
            <label className="cm-field cm-field-inline">
              <span className="cm-field-label">Width {unitLabel}</span>
              <input
                type="text"
                inputMode="decimal"
                value={draftPageWidth}
                aria-invalid={!pageDraftState.isValid}
                onChange={(event) => setDraftPageWidth(event.target.value)}
              />
            </label>
            <label className="cm-field cm-field-inline">
              <span className="cm-field-label">Height {unitLabel}</span>
              <input
                type="text"
                inputMode="decimal"
                value={draftPageHeight}
                aria-invalid={!pageDraftState.isValid}
                onChange={(event) => setDraftPageHeight(event.target.value)}
              />
            </label>
          </div>
          <div className="cm-row cm-flip-apply-row">
            <button className="cm-mini" type="button" onClick={swapPageOrientation}>
              Swap orientation
            </button>
            <button
              className="cm-mini cm-mini-primary"
              type="button"
              onClick={applyPageSize}
              disabled={!pageDraftState.isValid || !hasPendingPageSize}
            >
              Apply size
            </button>
          </div>
          <p className={pageSizeNoteClass}>{pageSizeNote}</p>
          <label className="cm-slider">
            <span className="cm-slider-row">
              <span className="cm-slider-label">Bleed</span>
              <span className="cm-slider-val">{formatMm(bleedMm)} mm</span>
            </span>
            <input
              type="range"
              min={0}
              max={MAX_BLEED_MM}
              step={0.1}
              value={bleedMm}
              onChange={(event) =>
                setBleedMm(clampDecimal(Number(event.target.value), 0, MAX_BLEED_MM, 1))
              }
            />
          </label>
          <label className="cm-field">
            <span className="cm-field-label">Bleed mm</span>
            <input
              type="number"
              min={0}
              max={MAX_BLEED_MM}
              step={0.1}
              value={formatInputMm(bleedMm)}
              onChange={(event) =>
                setBleedMm(clampDecimal(Number(event.target.value), 0, MAX_BLEED_MM, 1))
              }
            />
          </label>
          <p className="cm-flip-field-note">
            Image fill extends into bleed; the black blade contour remains the trim line.
          </p>
          <div className="cm-flip-auto-layout">
            <div>
              <span>Columns</span>
              <b>{printLayout.columns}</b>
            </div>
            <div>
              <span>Rows</span>
              <b>{printLayout.rows}</b>
            </div>
            <div>
              <span>Blades/page</span>
              <b>{printLayout.bladesPerPage}</b>
            </div>
          </div>
        </section>
      </aside>

      <section className="cm-flip-workspace">
        <div className="cm-flip-stage">
          <div className="cm-flip-stage-head">
            <div>
              <h2>Flipbook blade map</h2>
              <p>
                Physical blade: {formatBladeMm(BLADE_VIEWBOX.w)} x {formatBladeMm(BLADE_VIEWBOX.h)} mm.
                Front is A(i), back is D(i+1).
              </p>
            </div>
            <div className="cm-flip-stats">
              <span>{frameCount} frames</span>
              <span>{blades.length} blades</span>
              <span>{printPages.length * 2} print pages</span>
              <span>{printLayout.columns} x {printLayout.rows} layout</span>
              <span>{formatPageSize(pageWidthMm, pageHeightMm, pageUnit)}</span>
              <span>{formatMm(bleedMm)} mm bleed</span>
            </div>
          </div>

          <section className="cm-flip-section">
            <h3 className="cm-section-h">Source frames</h3>
            <div className="cm-flip-source-strip">
              {frames.map((frame) => (
                <SourceFrameCard key={frame.frame} source={frame} />
              ))}
            </div>
          </section>

          <section className="cm-flip-section">
            <h3 className="cm-section-h">Physical blades</h3>
            <div className="cm-flip-blade-strip">
              {blades.map((blade) => (
                <BladeMapCard
                  key={blade.index}
                  blade={blade}
                  frames={frames}
                  autoFrame={autoFrame}
                  closeUpTightness={closeUpTightness}
                  showDetections={showDetections}
                />
              ))}
            </div>
          </section>

          <section className="cm-flip-section">
            <h3 className="cm-section-h">Print layout preview</h3>
            <div className="cm-flip-print-grid">
              {printPages.map((page) => (
                <PrintPagePreview
                  key={page.page}
                  page={page}
                  frames={frames}
                  duplexMode={duplexMode}
                  pageSetup={pageSetup}
                  autoFrame={autoFrame}
                  closeUpTightness={closeUpTightness}
                  showDetections={showDetections}
                />
              ))}
            </div>
          </section>
        </div>
      </section>

      <aside className="cm-flip-summary">
        <section className="cm-section">
          <h3 className="cm-section-h">Mechanics contract</h3>
          <div className="cm-flip-rule">
            <code>B01 = 01A / 02D</code>
            <code>B02 = 02A / 03D</code>
            <code>image 02 = B02-F + B01-B</code>
          </div>
          <p className="cm-flip-note">
            {getPrintWorkflowNote(duplexMode)} Back artwork is vertically flipped while the
            blade contour stays fixed. Image fill extends into the configured bleed area.
          </p>
        </section>
        <section className="cm-section">
          <h3 className="cm-section-h">Next gates</h3>
          <ol className="cm-flip-checklist">
            <li>Verify one physical blade with 01A behind 02D.</li>
            <li>Confirm duplex mode on your printer.</li>
            <li>Export PDF and verify a one-blade physical proof.</li>
          </ol>
        </section>
      </aside>
      <ExportModal
        open={exportOpen}
        onClose={() => onExportRequest(false)}
        onExport={handleExport}
        previewLabel="Flipbook print"
        bgColor="#ffffff"
        aspectRatio={pageWidthMm / pageHeightMm}
        allowTransparency={false}
        previewContent={
          <FlipbookExportPreview
            page={printPages[0]}
            frames={frames}
            duplexMode={duplexMode}
            pageSetup={pageSetup}
            autoFrame={autoFrame}
            closeUpTightness={closeUpTightness}
          />
        }
        fixedSize={{
          width: Math.round((pageWidthMm / MM_PER_INCH) * PRINT_DPI),
          height: Math.round((pageHeightMm / MM_PER_INCH) * PRINT_DPI),
          label: `${formatPageSize(pageWidthMm, pageHeightMm, pageUnit)} PDF`,
          note: `${printPages.length * 2} pages · ${PRINT_DPI} dpi raster fills · vector cut contours${exporting ? ' · exporting...' : ''}`,
        }}
        preferredFormat="pdf"
        formats={['pdf']}
        title="Export flipbook"
        description="Create a print-ready duplex PDF using the current media size, bleed, and blade layout."
      />
      <VideoImportModal
        open={videoImportOpen}
        frameCount={frameCount}
        targetAspect={FLIPBOOK_FRAME_ASPECT}
        onFrameCountChange={setFrameCount}
        onClose={() => setVideoImportOpen(false)}
        onUseFrames={handleUseVideoFrames}
      />
      <FrameEditorModal
        photo={editingPhoto}
        closeUpTightness={closeUpTightness}
        aspectRatio={FLIPBOOK_FRAME_ASPECT}
        onClose={() => setEditingPhotoId(null)}
        onSave={saveManualFrame}
        onReset={resetManualFrame}
      />
    </main>
  );
}

function FlipbookExportPreview({
  page,
  frames,
  duplexMode,
  pageSetup,
  autoFrame,
  closeUpTightness,
}: {
  page: PrintPage<FlipbookBlade> | undefined;
  frames: FrameSource[];
  duplexMode: DuplexMode;
  pageSetup: {
    widthMm: number;
    heightMm: number;
    unit: PageUnit;
    bleedMm: number;
    printLayout: PrintLayout;
  };
  autoFrame: boolean;
  closeUpTightness: number;
}) {
  if (!page) return <span>Flipbook print</span>;
  const { printLayout } = pageSetup;
  const pagePrintLayout = {
    ...printLayout,
    rows: Math.max(1, Math.ceil(page.frontSlots.length / printLayout.columns)),
  };

  return (
    <div className="cm-flip-export-preview">
      <MiniExportSheet
        title={`Page ${page.page + 1} front`}
        note="A(i)"
        slots={page.frontSlots}
        side="front"
        frames={frames}
        pageSetup={pageSetup}
        pagePrintLayout={pagePrintLayout}
        autoFrame={autoFrame}
        closeUpTightness={closeUpTightness}
      />
      <MiniExportSheet
        title={`Page ${page.page + 1} back`}
        note={duplexMode === 'flatbed' ? 'same slots' : 'D(i+1)'}
        slots={page.backSlots}
        side="back"
        frames={frames}
        pageSetup={pageSetup}
        pagePrintLayout={pagePrintLayout}
        mirrorArtworkX={shouldMirrorBackArtworkX(duplexMode)}
        autoFrame={autoFrame}
        closeUpTightness={closeUpTightness}
      />
    </div>
  );
}

function MiniExportSheet({
  title,
  note,
  slots,
  side,
  frames,
  pageSetup,
  pagePrintLayout,
  mirrorArtworkX = false,
  autoFrame,
  closeUpTightness,
}: {
  title: string;
  note: string;
  slots: PrintPage<FlipbookBlade>['frontSlots'];
  side: BladeSide;
  frames: FrameSource[];
  pageSetup: {
    widthMm: number;
    heightMm: number;
    unit: PageUnit;
    bleedMm: number;
    printLayout: PrintLayout;
  };
  pagePrintLayout: PrintLayout;
  mirrorArtworkX?: boolean;
  autoFrame: boolean;
  closeUpTightness: number;
}) {
  return (
    <div className="cm-flip-export-sheet">
      <div className="cm-flip-export-sheet-head">
        <b>{title}</b>
        <span>{note}</span>
      </div>
      <div className="cm-flip-paper" style={{ aspectRatio: `${pageSetup.widthMm} / ${pageSetup.heightMm}` }}>
        <div className="cm-flip-print-slots">
          {slots.map((slot) => (
            <PrintSlot
              key={slot.slot}
              blade={slot.item}
              side={side}
              frames={frames}
              bleedMm={pageSetup.bleedMm}
              mirrorArtworkX={mirrorArtworkX}
              autoFrame={autoFrame}
              closeUpTightness={closeUpTightness}
              showDetections={false}
              style={getPrintSlotStyle(slot.slot, pageSetup.widthMm, pageSetup.heightMm, pagePrintLayout)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SourceFrameCard({ source }: { source: FrameSource }) {
  return (
    <div className="cm-flip-source-card">
      <div className="cm-flip-source-img">
        {source.photo ? <img src={source.photo.src} alt="" /> : <span>{formatFrame(source.frame)}</span>}
      </div>
      <div>
        <b>{formatFrame(source.frame)}</b>
        {source.repeated && <small>repeat</small>}
      </div>
    </div>
  );
}

function BladeMapCard({
  blade,
  frames,
  autoFrame,
  closeUpTightness,
  showDetections,
}: {
  blade: FlipbookBlade;
  frames: FrameSource[];
  autoFrame: boolean;
  closeUpTightness: number;
  showDetections: boolean;
}) {
  const front = frames[blade.frontFrame];
  const back = frames[blade.backFrame];
  return (
    <div className="cm-flip-blade-card">
      <div className="cm-flip-blade-pair">
        <BladeArt
          source={front}
          bladeId={`B${formatFrame(blade.index)}-F`}
          half="A"
          side="front"
          autoFrame={autoFrame}
          closeUpTightness={closeUpTightness}
          showDetections={showDetections}
        />
        <BladeArt
          source={back}
          bladeId={`B${formatFrame(blade.index)}-B`}
          half="D"
          side="back"
          printOrientation="flip-y"
          autoFrame={autoFrame}
          closeUpTightness={closeUpTightness}
          showDetections={showDetections}
        />
      </div>
      <div className="cm-flip-blade-caption">
        <b>B{formatFrame(blade.index)}</b>
        <span>{formatFrame(blade.frontFrame)}A / {formatFrame(blade.backFrame)}D</span>
      </div>
    </div>
  );
}

function PrintPagePreview({
  page,
  frames,
  duplexMode,
  pageSetup,
  autoFrame,
  closeUpTightness,
  showDetections,
}: {
  page: PrintPage<FlipbookBlade>;
  frames: FrameSource[];
  duplexMode: DuplexMode;
  pageSetup: {
    widthMm: number;
    heightMm: number;
    unit: PageUnit;
    bleedMm: number;
    printLayout: PrintLayout;
  };
  autoFrame: boolean;
  closeUpTightness: number;
  showDetections: boolean;
}) {
  const { printLayout } = pageSetup;
  const pagePrintLayout = {
    ...printLayout,
    rows: Math.max(1, Math.ceil(page.frontSlots.length / printLayout.columns)),
  };

  return (
    <>
      <div className="cm-flip-print-page">
        <div className="cm-flip-print-title">
          <div>
            <b>Page {page.page + 1} front</b>
            <small>{formatPageSize(pageSetup.widthMm, pageSetup.heightMm, pageSetup.unit)}</small>
          </div>
          <span>A(i)</span>
        </div>
        <div className="cm-flip-paper" style={{ aspectRatio: `${pageSetup.widthMm} / ${pageSetup.heightMm}` }}>
          <div className="cm-flip-print-slots">
            {page.frontSlots.map((slot) => (
              <PrintSlot
                key={slot.slot}
                blade={slot.item}
                side="front"
                frames={frames}
                bleedMm={pageSetup.bleedMm}
                autoFrame={autoFrame}
                closeUpTightness={closeUpTightness}
                showDetections={showDetections}
                style={getPrintSlotStyle(slot.slot, pageSetup.widthMm, pageSetup.heightMm, pagePrintLayout)}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="cm-flip-print-page">
        <div className="cm-flip-print-title">
          <div>
            <b>Page {page.page + 1} back</b>
            <small>{formatMm(pageSetup.bleedMm)} mm bleed</small>
          </div>
          <span>{duplexMode === 'flatbed' ? 'same slots' : 'D(i+1)'}</span>
        </div>
        <div className="cm-flip-paper" style={{ aspectRatio: `${pageSetup.widthMm} / ${pageSetup.heightMm}` }}>
          <div className="cm-flip-print-slots">
            {page.backSlots.map((slot) => (
              <PrintSlot
                key={slot.slot}
                blade={slot.item}
                side="back"
                frames={frames}
                bleedMm={pageSetup.bleedMm}
                mirrorArtworkX={shouldMirrorBackArtworkX(duplexMode)}
                autoFrame={autoFrame}
                closeUpTightness={closeUpTightness}
                showDetections={showDetections}
                style={getPrintSlotStyle(slot.slot, pageSetup.widthMm, pageSetup.heightMm, pagePrintLayout)}
              />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

function PrintSlot({
  blade,
  side,
  frames,
  bleedMm,
  mirrorArtworkX = false,
  autoFrame,
  closeUpTightness,
  showDetections,
  style,
}: {
  blade: FlipbookBlade | null;
  side: BladeSide;
  frames: FrameSource[];
  bleedMm: number;
  mirrorArtworkX?: boolean;
  autoFrame: boolean;
  closeUpTightness: number;
  showDetections: boolean;
  style: CSSProperties;
}) {
  if (!blade) return <div className="cm-flip-empty-slot" style={style}>empty</div>;
  const frame = side === 'front' ? blade.frontFrame : blade.backFrame;
  const half: BladeHalf = side === 'front' ? 'A' : 'D';
  return (
    <div className="cm-flip-print-slot" style={style}>
      <BladeArt
        source={frames[frame]}
        bladeId={`B${formatFrame(blade.index)}-${side === 'front' ? 'F' : 'B'}`}
        half={half}
        side={side}
        bleedMm={bleedMm}
        printOrientation={side === 'back' ? 'flip-y' : 'upright'}
        mirrorArtworkX={mirrorArtworkX}
        autoFrame={autoFrame}
        closeUpTightness={closeUpTightness}
        showDetections={showDetections}
        small
      />
    </div>
  );
}

function BladeArt({
  source,
  bladeId,
  half,
  side,
  bleedMm = 0,
  printOrientation = 'upright',
  mirrorArtworkX = false,
  autoFrame,
  closeUpTightness,
  showDetections,
  small = false,
}: {
  source: FrameSource;
  bladeId?: string;
  half: BladeHalf;
  side: BladeSide;
  bleedMm?: number;
  printOrientation?: 'upright' | 'flip-y' | 'rotate-180';
  mirrorArtworkX?: boolean;
  autoFrame: boolean;
  closeUpTightness: number;
  showDetections: boolean;
  small?: boolean;
}) {
  const generatedId = useId();
  const clipId = `blade-clip-${generatedId.replace(/:/g, '')}`;
  const bleedClipId = `blade-bleed-clip-${generatedId.replace(/:/g, '')}`;
  const bleed = Math.max(0, Math.min(MAX_BLEED_MM, bleedMm));
  const imageFrameW = BLADE_VIEWBOX.w + bleed * 2;
  const imageFrameH = BLADE_VIEWBOX.h * 2 + bleed * 2;
  const cx = BLADE_VIEWBOX.x + BLADE_VIEWBOX.w / 2;
  const shouldTransformFullStack = printOrientation !== 'upright';
  const imageY = shouldTransformFullStack
    ? half === 'D'
      ? BLADE_VIEWBOX.y
      : BLADE_VIEWBOX.y - BLADE_VIEWBOX.h
      : half === 'A'
        ? BLADE_VIEWBOX.y
        : BLADE_VIEWBOX.y - BLADE_VIEWBOX.h;
  const imageCenterY = imageY + BLADE_VIEWBOX.h;
  const imageCenterX = BLADE_VIEWBOX.x + BLADE_VIEWBOX.w / 2;
  const imageFrameX = BLADE_VIEWBOX.x - bleed;
  const imageFrameY = imageY - bleed;
  const viewBox = `${BLADE_VIEWBOX.x - bleed} ${BLADE_VIEWBOX.y - bleed} ${BLADE_VIEWBOX.w + bleed * 2} ${BLADE_VIEWBOX.h + bleed * 2}`;
  const transform = getArtworkTransform(printOrientation, mirrorArtworkX, imageCenterX, imageCenterY, cx);
  const label = `${formatFrame(source.frame)}${half}`;
  const ariaLabel = `${label} ${side}`;
  const bleedPath = bleed > 0 ? getFlipbookBladeBleedSvgPath(bleed) : '';
  const placement = source.photo
    ? computePhotoPlacement(source.photo, imageFrameW, imageFrameH, {
        closeUp: autoFrame,
        closeUpTightness,
      })
    : null;

  return (
    <svg
      className={`cm-flip-blade-svg ${small ? 'is-small' : ''}`}
      viewBox={viewBox}
      aria-label={ariaLabel}
    >
      <defs>
        <clipPath id={clipId} clipPathUnits="userSpaceOnUse">
          <path transform={BLADE_PATH_TRANSFORM} d={BLADE_PATH_D} />
        </clipPath>
        <clipPath id={bleedClipId} clipPathUnits="userSpaceOnUse">
          <path transform={`translate(${BLADE_VIEWBOX.x} ${BLADE_VIEWBOX.y})`} d={bleedPath} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${bleed > 0 ? bleedClipId : clipId})`}>
        {source.photo && placement ? (
          <image
            href={source.photo.src}
            x={imageFrameX + placement.x}
            y={imageFrameY + placement.y}
            width={placement.w}
            height={placement.h}
            preserveAspectRatio="none"
            transform={transform}
          />
        ) : (
          <rect
            x={BLADE_VIEWBOX.x - bleed}
            y={BLADE_VIEWBOX.y - bleed}
            width={BLADE_VIEWBOX.w + bleed * 2}
            height={BLADE_VIEWBOX.h + bleed * 2}
            fill={half === 'A' ? '#4f8cff' : '#38d39f'}
            transform={transform}
          />
        )}
        {showDetections && placement?.subjectBox && (
          <rect
            x={imageFrameX + placement.subjectBox.x}
            y={imageFrameY + placement.subjectBox.y}
            width={placement.subjectBox.w}
            height={placement.subjectBox.h}
            fill="none"
            stroke={
              placement.subjectBox.source === 'face' || placement.subjectBox.source === 'hybrid'
                ? '#22c55e'
                : placement.subjectBox.source === 'person'
                  ? '#38bdf8'
                  : '#f59e0b'
            }
            strokeWidth={small ? 0.7 : 1}
            vectorEffect="non-scaling-stroke"
            transform={transform}
          />
        )}
      </g>
      <path transform={BLADE_PATH_TRANSFORM} d={BLADE_PATH_D} fill="none" stroke="currentColor" />
      <text
        x={BLADE_VIEWBOX.x + FLIPBOOK_BLADE_LABEL.leftX}
        y={BLADE_VIEWBOX.y + FLIPBOOK_BLADE_LABEL.y}
        fill="currentColor"
        stroke="rgba(255,255,255,.75)"
        strokeWidth={small ? FLIPBOOK_BLADE_LABEL.strokeMm : FLIPBOOK_BLADE_LABEL.previewStrokeMm}
        paintOrder="stroke"
        textAnchor="middle"
        dominantBaseline="middle"
        fontSize={small ? FLIPBOOK_BLADE_LABEL.fontSizeMm : FLIPBOOK_BLADE_LABEL.previewFontSizeMm}
        fontWeight={700}
      >
        {label}
      </text>
      {bladeId && (
        <text
          x={BLADE_VIEWBOX.x + FLIPBOOK_BLADE_LABEL.rightX}
          y={BLADE_VIEWBOX.y + FLIPBOOK_BLADE_LABEL.y}
          fill="currentColor"
          stroke="rgba(255,255,255,.75)"
          strokeWidth={small ? FLIPBOOK_BLADE_LABEL.strokeMm : FLIPBOOK_BLADE_LABEL.previewStrokeMm}
          paintOrder="stroke"
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize={small ? FLIPBOOK_BLADE_LABEL.fontSizeMm : FLIPBOOK_BLADE_LABEL.previewFontSizeMm}
          fontWeight={700}
        >
          {bladeId}
        </text>
      )}
    </svg>
  );
}

function getArtworkTransform(
  printOrientation: 'upright' | 'flip-y' | 'rotate-180',
  mirrorArtworkX: boolean,
  imageCenterX: number,
  imageCenterY: number,
  bladeCenterX: number
) {
  if (printOrientation === 'rotate-180') return `rotate(180 ${bladeCenterX} ${imageCenterY})`;
  if (printOrientation === 'flip-y' && mirrorArtworkX) {
    return `translate(${imageCenterX * 2} ${imageCenterY * 2}) scale(-1 -1)`;
  }
  if (printOrientation === 'flip-y') return `translate(0 ${imageCenterY * 2}) scale(1 -1)`;
  if (mirrorArtworkX) return `translate(${imageCenterX * 2} 0) scale(-1 1)`;
  return undefined;
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function readPageDraft(widthText: string, heightText: string, unit: PageUnit): PageDraftState {
  const widthMm = parsePageDimension(widthText, unit);
  const heightMm = parsePageDimension(heightText, unit);
  if (widthMm === null || heightMm === null) {
    return { isValid: false, error: `Enter a valid width and height in ${unit === 'in' ? 'inches' : 'millimeters'}.` };
  }
  if (widthMm < MIN_PAGE_MM || heightMm < MIN_PAGE_MM) {
    return {
      isValid: false,
      error: `Media size must be at least ${formatPageDimension(MIN_PAGE_MM, unit)} ${unit}.`,
    };
  }
  if (widthMm > MAX_PAGE_MM || heightMm > MAX_PAGE_MM) {
    return {
      isValid: false,
      error: `Media size must be no more than ${formatPageDimension(MAX_PAGE_MM, unit)} ${unit}.`,
    };
  }
  return { isValid: true, widthMm: roundMm(widthMm), heightMm: roundMm(heightMm) };
}

function parsePageDimension(value: string, unit: PageUnit) {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return unit === 'in' ? parsed * MM_PER_INCH : parsed;
}

function computePrintLayout(pageWidthMm: number, pageHeightMm: number, bleedMm: number): PrintLayout {
  const bleed = Math.max(0, Math.min(MAX_BLEED_MM, bleedMm));
  const slotWidthMm = BLADE_VIEWBOX.w + bleed * 2;
  const slotHeightMm = BLADE_VIEWBOX.h + bleed * 2;
  const usableWidthMm = Math.max(slotWidthMm, pageWidthMm - PRINT_MARGIN_MM * 2);
  const usableHeightMm = Math.max(slotHeightMm, pageHeightMm - PRINT_MARGIN_MM * 2);
  const columns = Math.max(1, Math.floor((usableWidthMm + PRINT_GAP_MM) / (slotWidthMm + PRINT_GAP_MM)));
  const rows = Math.max(1, Math.floor((usableHeightMm + PRINT_GAP_MM) / (slotHeightMm + PRINT_GAP_MM)));

  return {
    columns,
    rows,
    bladesPerPage: columns * rows,
    slotWidthMm,
    slotHeightMm,
    gapMm: PRINT_GAP_MM,
    marginMm: PRINT_MARGIN_MM,
  };
}

function getPrintSlotStyle(
  slot: number,
  pageWidthMm: number,
  pageHeightMm: number,
  layout: PrintLayout
): CSSProperties {
  const row = Math.floor(slot / layout.columns);
  const col = slot % layout.columns;
  const totalWidthMm = layout.columns * layout.slotWidthMm + (layout.columns - 1) * layout.gapMm;
  const totalHeightMm = layout.rows * layout.slotHeightMm + (layout.rows - 1) * layout.gapMm;
  const originXMm = (pageWidthMm - totalWidthMm) / 2;
  const originYMm = (pageHeightMm - totalHeightMm) / 2;
  const leftMm = originXMm + col * (layout.slotWidthMm + layout.gapMm);
  const topMm = originYMm + row * (layout.slotHeightMm + layout.gapMm);

  return {
    left: `${(leftMm / pageWidthMm) * 100}%`,
    top: `${(topMm / pageHeightMm) * 100}%`,
    width: `${(layout.slotWidthMm / pageWidthMm) * 100}%`,
    height: `${(layout.slotHeightMm / pageHeightMm) * 100}%`,
  };
}

function clampDecimal(value: number, min: number, max: number, decimals: number) {
  if (!Number.isFinite(value)) return min;
  const factor = 10 ** decimals;
  return Math.min(max, Math.max(min, Math.round(value * factor) / factor));
}

function roundMm(value: number) {
  return Math.round(value * 10) / 10;
}

function formatMm(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatBladeMm(value: number) {
  return value.toFixed(3).replace(/\.?0+$/, '');
}

function formatInputMm(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function formatPageSize(widthMm: number, heightMm: number, unit: PageUnit) {
  return `${formatPageDimension(widthMm, unit)} x ${formatPageDimension(heightMm, unit)} ${unit}`;
}

function formatPageDimension(valueMm: number, unit: PageUnit) {
  const value = unit === 'in' ? valueMm / MM_PER_INCH : valueMm;
  const decimals = unit === 'in' ? 3 : 1;
  return value
    .toFixed(decimals)
    .replace(/\.0+$/, '')
    .replace(/(\.\d*?)0+$/, '$1');
}

function getPrintWorkflowNote(mode: DuplexMode) {
  if (mode === 'flatbed' || mode === 'none') {
    return 'Back pages keep each blade in the same template position as the matching front page.';
  }
  if (mode === 'column-mirror') {
    return 'Back pages mirror rows for short-edge duplex registration.';
  }
  if (mode === 'rotate-180') {
    return 'Back pages rotate the slot map for printers that flip both axes.';
  }
  return 'Back pages mirror columns for long-edge duplex registration.';
}

function formatVideoMode(mode: VideoSource['mode']) {
  if (mode === 'perFrame') return 'per-frame';
  return mode;
}

function formatVideoProgress(progress: DeriveProgress) {
  return `${progress.stage} ${progress.done}/${progress.total}`;
}

function videoWarningText(warning: ExtractionWarning) {
  if (warning.kind === 'lowFps') return `Low motion rate (${warning.effectiveFps.toFixed(1)} fps).`;
  if (warning.kind === 'noSubject') return 'No subject detected; using center framing.';
  return warning.message;
}
