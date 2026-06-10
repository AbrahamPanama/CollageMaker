import { useEffect, useMemo, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type Konva from 'konva';

import { ExportModal, type ExportSettings } from '../components/ExportModal';
import { FrameEditorModal } from '../components/FrameEditorModal';
import { GridStage, cellToPixelRect } from '../components/GridStage';
import { GridTray } from '../components/GridTray';
import { VariantStrip } from '../components/VariantStrip';
import { downloadExport } from '../export';
import { generateLayouts } from '../gridLayout/generate';
import { applyStableAssignments } from '../gridLayout/stability';
import type { GridCell, PhotoMeta, ScoredLayout } from '../gridLayout/types';
import { loadPhoto, type LoadedPhoto } from '../photoIngest';
import type { ManualFrame } from '../types';
import {
  loadGridV2Settings,
  saveGridV2Settings,
  type GridV2Settings,
} from '../settingsStore';

const MAX_STAGE_DIM = 600;
const MAX_GRID_PHOTOS = 30;
const MIN_CUSTOM_ASPECT = 0.2;
const MAX_CUSTOM_ASPECT = 5;

type Props = {
  onExportRequest: (open: boolean) => void;
  exportOpen: boolean;
  onPhotoCountChange: (n: number) => void;
};

type AspectPreset = {
  id: string;
  label: string;
  w: number;
  h: number;
};

const ASPECT_PRESETS: AspectPreset[] = [
  { id: '1:1', label: '1:1', w: 1, h: 1 },
  { id: '4:5', label: '4:5', w: 4, h: 5 },
  { id: '3:4', label: '3:4', w: 3, h: 4 },
  { id: '2:3', label: '2:3', w: 2, h: 3 },
  { id: '9:16', label: '9:16', w: 9, h: 16 },
  { id: '16:9', label: '16:9', w: 16, h: 9 },
  { id: '3:2', label: '3:2', w: 3, h: 2 },
  { id: '4:3', label: '4:3', w: 4, h: 3 },
  { id: 'a4p', label: 'A4 P', w: 1, h: Math.SQRT2 },
  { id: 'a4l', label: 'A4 L', w: Math.SQRT2, h: 1 },
  { id: 'custom', label: 'Custom', w: 1, h: 1 },
];

const DEFAULT_GRID_SETTINGS: GridV2Settings = {
  aspectId: '1:1',
  customAspectW: 1,
  customAspectH: 1,
  gutterFraction: 8 / MAX_STAGE_DIM,
  cornerRadius: 6,
  background: '#111113',
  closeUp: true,
  closeUpTightness: 0.75,
  seed: 1,
};

export function GridCollage({ onExportRequest, exportOpen, onPhotoCountChange }: Props) {
  const [photos, setPhotos] = useState<LoadedPhoto[]>([]);
  const [settings, setSettings] = useState<GridV2Settings>(() =>
    loadGridV2Settings(DEFAULT_GRID_SETTINGS)
  );
  const [selectedLayoutId, setSelectedLayoutId] = useState<string | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string | null>(null);
  const [editingPhotoId, setEditingPhotoId] = useState<string | null>(null);
  const [heroPhotoId, setHeroPhotoId] = useState<string | null>(null);
  const [lockedPhotoIds, setLockedPhotoIds] = useState<Set<string>>(() => new Set());
  const [analyzing, setAnalyzing] = useState<{ done: number; total: number } | null>(null);
  const [isDraggingStage, setIsDraggingStage] = useState(false);
  const [hideUiForCapture, setHideUiForCapture] = useState(false);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const stageRef = useRef<Konva.Stage>(null);
  const previousCellsRef = useRef<GridCell[]>([]);

  const aspectChoice = useMemo(() => resolveAspect(settings), [settings]);
  const targetAspect = aspectChoice.w / aspectChoice.h;
  const { stageW, stageH } = useMemo(() => fitStage(targetAspect), [targetAspect]);
  const minStageDim = Math.min(stageW, stageH);
  const gutterPx = Math.round(settings.gutterFraction * minStageDim);
  const lockedKey = useMemo(
    () => Array.from(lockedPhotoIds).sort().join('|'),
    [lockedPhotoIds]
  );

  const photoMetas = useMemo<PhotoMeta[]>(
    () =>
      photos.map((photo) => ({
        id: photo.id,
        aspect: photo.naturalWidth / Math.max(1, photo.naturalHeight),
        subject: photo.subject,
        heroPinned: photo.id === heroPhotoId,
      })),
    [heroPhotoId, photos]
  );

  const layouts = useMemo(() => {
    const generated = generateLayouts(
      photoMetas,
      targetAspect,
      {
        topK: 8,
        minCellFraction: 0.06,
        heroPhotoId,
      },
      settings.seed
    );
    return applyStableAssignments(previousCellsRef.current, generated, lockedPhotoIds);
    // lockedKey is the stable dependency; using the Set directly would rerun on every identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroPhotoId, lockedKey, photoMetas, settings.seed, targetAspect]);

  const selectedLayout = useMemo<ScoredLayout | null>(() => {
    if (layouts.length === 0) return null;
    return layouts.find((layout) => layout.id === selectedLayoutId) ?? layouts[0];
  }, [layouts, selectedLayoutId]);

  const editingPhoto = useMemo(
    () => photos.find((photo) => photo.id === editingPhotoId) ?? null,
    [editingPhotoId, photos]
  );

  const editingAspect = useMemo(() => {
    if (!editingPhotoId || !selectedLayout) return 1;
    const cell = selectedLayout.cells.find((candidate) => candidate.photoId === editingPhotoId);
    if (!cell) return 1;
    const rect = cellToPixelRect(cell, stageW, stageH, gutterPx);
    return rect.w / Math.max(1, rect.h);
  }, [editingPhotoId, gutterPx, selectedLayout, stageH, stageW]);

  useEffect(() => {
    onPhotoCountChange(photos.length);
  }, [onPhotoCountChange, photos.length]);

  useEffect(() => {
    saveGridV2Settings(settings);
  }, [settings]);

  useEffect(() => {
    if (selectedLayout && !selectedLayoutId) setSelectedLayoutId(selectedLayout.id);
    if (selectedLayout) previousCellsRef.current = selectedLayout.cells;
  }, [selectedLayout, selectedLayoutId]);

  useEffect(() => {
    if (!selectedPhotoId || photos.some((photo) => photo.id === selectedPhotoId)) return;
    setSelectedPhotoId(null);
  }, [photos, selectedPhotoId]);

  useEffect(() => {
    if (!editingPhotoId || photos.some((photo) => photo.id === editingPhotoId)) return;
    setEditingPhotoId(null);
  }, [editingPhotoId, photos]);

  useEffect(() => {
    if (!heroPhotoId || photos.some((photo) => photo.id === heroPhotoId)) return;
    setHeroPhotoId(null);
  }, [heroPhotoId, photos]);

  useEffect(() => {
    if (!exportOpen) {
      setPreviewSrc(null);
      return;
    }
    let cancelled = false;
    setHideUiForCapture(true);
    waitForPaint(2).then(() => {
      const stage = stageRef.current;
      if (!stage || cancelled) return;
      try {
        setPreviewSrc(
          stage.toDataURL({
            mimeType: 'image/png',
            pixelRatio: 360 / Math.max(stageW, stageH),
          })
        );
      } catch (error) {
        console.warn('Grid preview capture failed', error);
      } finally {
        setHideUiForCapture(false);
      }
    });
    return () => {
      cancelled = true;
      setHideUiForCapture(false);
    };
  }, [exportOpen, stageH, stageW]);

  const ingestFiles = async (files: File[]) => {
    const imageFiles = files.filter((file) => file.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    const availableSlots = Math.max(0, MAX_GRID_PHOTOS - photos.length);
    if (availableSlots <= 0) {
      alert(`Grid supports up to ${MAX_GRID_PHOTOS} photos.`);
      return;
    }
    const accepted = imageFiles.slice(0, availableSlots);
    if (accepted.length < imageFiles.length) {
      alert(`Grid supports up to ${MAX_GRID_PHOTOS} photos. Only the first ${accepted.length} were added.`);
    }

    setAnalyzing({ done: 0, total: accepted.length });
    try {
      for (let index = 0; index < accepted.length; index++) {
        const photo = await loadPhoto(accepted[index]);
        if (photo) {
          setPhotos((prev) => [...prev, photo]);
          setSelectedPhotoId(photo.id);
        }
        setAnalyzing({ done: index + 1, total: accepted.length });
      }
    } finally {
      setAnalyzing(null);
    }
  };

  const handleStageDrag = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingStage(true);
  };

  const handleStageDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDraggingStage(false);
    ingestFiles(Array.from(event.dataTransfer.files));
  };

  const handleRemovePhoto = (photoId: string) => {
    setPhotos((prev) => prev.filter((photo) => photo.id !== photoId));
    setLockedPhotoIds((prev) => withoutFromSet(prev, photoId));
    setSelectedPhotoId((current) => (current === photoId ? null : current));
    setEditingPhotoId((current) => (current === photoId ? null : current));
  };

  const handleMovePhoto = (photoId: string, direction: -1 | 1) => {
    setPhotos((prev) => {
      const index = prev.findIndex((photo) => photo.id === photoId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= prev.length) return prev;
      const next = prev.slice();
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  };

  const handleSwapPhotos = (sourcePhotoId: string, targetPhotoId: string) => {
    if (sourcePhotoId === targetPhotoId) return;
    setPhotos((prev) => {
      const source = prev.find((photo) => photo.id === sourcePhotoId);
      const target = prev.find((photo) => photo.id === targetPhotoId);
      if (!source || !target) return prev;
      return prev.map((photo) => {
        if (photo.id === sourcePhotoId) return { ...target, id: sourcePhotoId };
        if (photo.id === targetPhotoId) return { ...source, id: targetPhotoId };
        return photo;
      });
    });
    setSelectedPhotoId((current) => {
      if (current === sourcePhotoId) return targetPhotoId;
      if (current === targetPhotoId) return sourcePhotoId;
      return current;
    });
    setHeroPhotoId((current) => {
      if (current === sourcePhotoId) return targetPhotoId;
      if (current === targetPhotoId) return sourcePhotoId;
      return current;
    });
  };

  const handleSaveManualFrame = (photoId: string, frame: ManualFrame) => {
    setPhotos((prev) =>
      prev.map((photo) => (photo.id === photoId ? { ...photo, manualFrame: frame } : photo))
    );
  };

  const handleResetManualFrame = (photoId: string) => {
    setPhotos((prev) =>
      prev.map((photo) => {
        if (photo.id !== photoId) return photo;
        const { manualFrame, ...rest } = photo;
        void manualFrame;
        return rest;
      })
    );
  };

  const handleClear = () => {
    setPhotos([]);
    setSelectedPhotoId(null);
    setEditingPhotoId(null);
    setHeroPhotoId(null);
    setLockedPhotoIds(new Set());
    previousCellsRef.current = [];
  };

  const handleExport = async (exportSettings: ExportSettings) => {
    const stage = stageRef.current;
    if (!stage) return;

    setHideUiForCapture(true);
    await waitForPaint(2);

    const mime = exportSettings.format === 'jpg' ? 'image/jpeg' : 'image/png';
    let dataUrl: string;
    try {
      dataUrl = stage.toDataURL({
        mimeType: mime,
        pixelRatio: exportSettings.width / stageW,
        quality: exportSettings.format === 'jpg' ? 0.92 : 1,
      });
    } catch (error) {
      console.error('Grid export failed', error);
      alert('Export failed. Try a smaller resolution or fewer photos.');
      setHideUiForCapture(false);
      return;
    }

    setHideUiForCapture(false);

    try {
      const saved = await downloadExport({
        format: exportSettings.format,
        dataUrl,
        mime,
        width: exportSettings.width,
        height: exportSettings.height,
        baseName: `grid-collage-${Date.now()}`,
      });
      if (saved) onExportRequest(false);
    } catch (error) {
      console.error('Grid save failed', error);
      alert('Save failed. Please pick a different file name or location.');
    }
  };

  return (
    <main className="cm-grid-view">
      <div className="cm-grid-toolbar">
        <label className="cm-grid-select">
          <span>Aspect</span>
          <select
            value={settings.aspectId}
            onChange={(event) => {
              setSettings((prev) => ({ ...prev, aspectId: event.target.value }));
            }}
          >
            {ASPECT_PRESETS.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.label}</option>
            ))}
          </select>
        </label>

        {settings.aspectId === 'custom' && (
          <div className="cm-grid-custom-aspect">
            <label>
              <span>W</span>
              <input
                type="number"
                min={MIN_CUSTOM_ASPECT}
                max={MAX_CUSTOM_ASPECT}
                step={0.1}
                value={settings.customAspectW}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, customAspectW: clampAspectInput(+event.target.value) }))
                }
              />
            </label>
            <label>
              <span>H</span>
              <input
                type="number"
                min={MIN_CUSTOM_ASPECT}
                max={MAX_CUSTOM_ASPECT}
                step={0.1}
                value={settings.customAspectH}
                onChange={(event) =>
                  setSettings((prev) => ({ ...prev, customAspectH: clampAspectInput(+event.target.value) }))
                }
              />
            </label>
          </div>
        )}

        <label className="cm-grid-slider">
          <span>Gutter</span>
          <input
            type="range"
            min={0}
            max={40}
            value={gutterPx}
            onChange={(event) =>
              setSettings((prev) => ({
                ...prev,
                gutterFraction: Number(event.target.value) / Math.max(1, minStageDim),
              }))
            }
          />
          <em>{gutterPx}px</em>
        </label>

        <label className="cm-grid-slider">
          <span>Radius</span>
          <input
            type="range"
            min={0}
            max={32}
            value={settings.cornerRadius}
            onChange={(event) =>
              setSettings((prev) => ({ ...prev, cornerRadius: Number(event.target.value) }))
            }
          />
          <em>{settings.cornerRadius}px</em>
        </label>

        <label className="cm-grid-color">
          <span>Bg</span>
          <input
            type="color"
            value={settings.background}
            onChange={(event) => setSettings((prev) => ({ ...prev, background: event.target.value }))}
          />
        </label>

        <label className="cm-grid-toggle">
          <input
            type="checkbox"
            checked={settings.closeUp}
            onChange={(event) => setSettings((prev) => ({ ...prev, closeUp: event.target.checked }))}
          />
          <span>Auto close-up</span>
        </label>

        <label className="cm-grid-slider">
          <span>Tightness</span>
          <input
            type="range"
            min={0.4}
            max={0.95}
            step={0.01}
            value={settings.closeUpTightness}
            onChange={(event) =>
              setSettings((prev) => ({ ...prev, closeUpTightness: Number(event.target.value) }))
            }
          />
          <em>{settings.closeUpTightness.toFixed(2)}</em>
        </label>

        <button
          className="cm-btn cm-btn-ghost"
          onClick={() => {
            previousCellsRef.current = [];
            setSelectedLayoutId(null);
            setSettings((prev) => ({ ...prev, seed: prev.seed + 1 }));
          }}
        >
          Shuffle
        </button>
      </div>

      <div className="cm-grid-workspace">
        <GridTray
          photos={photos}
          selectedPhotoId={selectedPhotoId}
          heroPhotoId={heroPhotoId}
          lockedPhotoIds={lockedPhotoIds}
          analyzing={analyzing}
          maxPhotos={MAX_GRID_PHOTOS}
          onFiles={ingestFiles}
          onSelect={setSelectedPhotoId}
          onRemove={handleRemovePhoto}
          onMove={handleMovePhoto}
          onSetHero={(photoId) => setHeroPhotoId((current) => (current === photoId ? null : photoId))}
          onToggleLock={(photoId) =>
            setLockedPhotoIds((prev) => toggleInSet(prev, photoId))
          }
          onClear={handleClear}
        />

        <section className="cm-grid-stage-panel">
          <div className="cm-grid-stage-head">
            <div>
              <h2>Generated grid</h2>
              <p>{photos.length === 0 ? 'Drop photos to build a layout.' : `${photos.length} photos · ${aspectChoice.label}`}</p>
            </div>
            <VariantStrip
              layouts={layouts}
              selectedLayoutId={selectedLayout?.id ?? null}
              onSelect={(layoutId) => {
                const picked = layouts.find((layout) => layout.id === layoutId);
                if (picked) previousCellsRef.current = picked.cells;
                setSelectedLayoutId(layoutId);
              }}
            />
          </div>

          <div
            className={`cm-grid-stage ${isDraggingStage ? 'is-dragging' : ''}`}
            onDragOver={handleStageDrag}
            onDragEnter={handleStageDrag}
            onDragLeave={() => setIsDraggingStage(false)}
            onDrop={handleStageDrop}
          >
            {selectedLayout ? (
              <div className="cm-canvas-wrap" style={{ width: stageW, height: stageH }}>
                <GridStage
                  ref={stageRef}
                  cells={selectedLayout.cells}
                  photos={photos}
                  width={stageW}
                  height={stageH}
                  gutter={gutterPx}
                  cornerRadius={settings.cornerRadius}
                  background={settings.background}
                  selectedPhotoId={selectedPhotoId}
                  showUi={!hideUiForCapture && !exportOpen}
                  closeUp={settings.closeUp}
                  closeUpTightness={settings.closeUpTightness}
                  onSelectPhoto={setSelectedPhotoId}
                  onEditPhoto={setEditingPhotoId}
                  onManualFrameChange={handleSaveManualFrame}
                  onSwapPhotos={handleSwapPhotos}
                />
              </div>
            ) : (
              <div className="cm-grid-empty">
                <strong>Drop photos</strong>
                <span>The app will generate the grid automatically.</span>
              </div>
            )}
          </div>

          {selectedPhotoId && (
            <div className="cm-grid-selection-bar">
              <span>{photos.find((photo) => photo.id === selectedPhotoId)?.name ?? 'Selected photo'}</span>
              <button onClick={() => setEditingPhotoId(selectedPhotoId)}>Edit frame</button>
              <button onClick={() => setHeroPhotoId((current) => (current === selectedPhotoId ? null : selectedPhotoId))}>
                {heroPhotoId === selectedPhotoId ? 'Unpin hero' : 'Pin hero'}
              </button>
              <button onClick={() => setLockedPhotoIds((prev) => toggleInSet(prev, selectedPhotoId))}>
                {lockedPhotoIds.has(selectedPhotoId) ? 'Unlock' : 'Lock'}
              </button>
              <button onClick={() => handleResetManualFrame(selectedPhotoId)}>Auto crop</button>
              <button onClick={() => handleRemovePhoto(selectedPhotoId)}>Remove</button>
            </div>
          )}
        </section>
      </div>

      <FrameEditorModal
        photo={editingPhoto}
        aspectRatio={editingAspect}
        closeUpTightness={settings.closeUpTightness}
        onClose={() => setEditingPhotoId(null)}
        onSave={handleSaveManualFrame}
        onReset={handleResetManualFrame}
      />

      <ExportModal
        open={exportOpen}
        onClose={() => onExportRequest(false)}
        onExport={handleExport}
        previewLabel={`Grid ${aspectChoice.label}`}
        previewSrc={previewSrc}
        bgColor={settings.background}
        aspectRatio={stageW / stageH}
        allowTransparency={false}
      />
    </main>
  );
}

function resolveAspect(settings: GridV2Settings): AspectPreset {
  const preset = ASPECT_PRESETS.find((candidate) => candidate.id === settings.aspectId);
  if (!preset || preset.id === 'custom') {
    return {
      id: 'custom',
      label: `${settings.customAspectW}×${settings.customAspectH}`,
      w: settings.customAspectW,
      h: settings.customAspectH,
    };
  }
  return preset;
}

function fitStage(aspect: number) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (safeAspect >= 1) {
    return {
      stageW: MAX_STAGE_DIM,
      stageH: Math.max(1, Math.round(MAX_STAGE_DIM / safeAspect)),
    };
  }
  return {
    stageW: Math.max(1, Math.round(MAX_STAGE_DIM * safeAspect)),
    stageH: MAX_STAGE_DIM,
  };
}

function clampAspectInput(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(MIN_CUSTOM_ASPECT, Math.min(MAX_CUSTOM_ASPECT, value));
}

function waitForPaint(frames: number) {
  return new Promise<void>((resolve) => {
    const tick = (remaining: number) => {
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(() => tick(remaining - 1));
    };
    tick(frames);
  });
}

function toggleInSet(set: Set<string>, value: string) {
  const next = new Set(set);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function withoutFromSet(set: Set<string>, value: string) {
  const next = new Set(set);
  next.delete(value);
  return next;
}
