import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import type Konva from 'konva';

import { BASIC_SHAPES, shapeToSvgText } from '../shapes/library';
import { parseShapePolyline, polygonArea, transformPolyline } from '../shape';
import {
  assignPhotosToCells,
  findAutoParamsForCount,
  generateCells,
} from '../shapeCollage';
import type { ManualFrame, Photo } from '../types';
import { detectSubject } from '../smartFrame';

import { computeCellContour, contourLoopsToSvgPath } from '../contour';
import { ShapeStage } from '../components/ShapeStage';
import { ShapeBrowser, type SelectedShape } from '../components/ShapeBrowser';
import { ControlsPanel, type Settings } from '../components/ControlsPanel';
import { StageBar } from '../components/StageBar';
import { ExportModal, type ExportSettings } from '../components/ExportModal';
import { FrameEditorModal } from '../components/FrameEditorModal';
import { downloadExport, hexToRgb } from '../export';
import {
  createProfile,
  loadLastSession,
  loadProfiles,
  mergeSettings,
  saveLastSession,
  saveProfiles,
  type Profile,
} from '../settingsStore';

const STAGE_DIM = 600;
const PADDING = 16;

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

type Props = {
  onExportRequest: (open: boolean) => void;
  exportOpen: boolean;
  onPhotoCountChange: (n: number) => void;
};

const DEFAULT_SETTINGS: Settings = {
  targetCellSize: 64,
  minCellSize: 16,
  gap: 2,
  bgColor: '#ffffff',
  showOutline: false,
  showDetections: false,
  closeUp: true,
  closeUpTightness: 0.75,
  autoFit: true,
  contourShow: false,
  contourOffset: 0,
  contourThickness: 2,
  contourColor: '#e11d48',
  bgTransparent: false,
};

const DEFAULT_SHAPE: SelectedShape = { ...BASIC_SHAPES[0], source: 'basic' };

export function ShapeCollage({ onExportRequest, exportOpen, onPhotoCountChange }: Props) {
  // Restore the last working session (settings + shape) if one exists.
  const restored = useMemo(() => loadLastSession(), []);

  // ---------- Source state ----------
  const [selectedShape, setSelectedShape] = useState<SelectedShape>(
    () => restored?.shape ?? DEFAULT_SHAPE
  );

  // ---------- Settings ----------
  const [settings, setSettings] = useState<Settings>(() =>
    restored ? mergeSettings(DEFAULT_SETTINGS, restored.settings) : DEFAULT_SETTINGS
  );

  // ---------- Profiles ----------
  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);

  // ---------- Photos / detection ----------
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [analyzing, setAnalyzing] = useState<{ done: number; total: number } | null>(null);
  const [shuffleSeed, setShuffleSeed] = useState(1);
  const [isDraggingPhotos, setIsDraggingPhotos] = useState(false);
  const [editingPhotoId, setEditingPhotoId] = useState<string | null>(null);

  const stageRef = useRef<Konva.Stage>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageInnerRef = useRef<HTMLDivElement>(null);
  const panStateRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [isPanning, setIsPanning] = useState(false);

  // ---------- Active mask SVG ----------
  // Build directly from the selected shape's own path data. `selectedShape`
  // always carries `d` + `viewBox` (for both basic and user shapes), so we
  // never need to re-resolve it against the library. This keeps profiles and
  // restored sessions rendering correctly even if the source user-shape was
  // later deleted from the library.
  const activeShapeSvg = useMemo(
    () => shapeToSvgText(selectedShape),
    [selectedShape]
  );

  const parsed = useMemo(
    () => parseShapePolyline(activeShapeSvg, 600),
    [activeShapeSvg]
  );

  const transformed = useMemo(
    () =>
      transformPolyline(parsed.points, parsed.viewBox, {
        x: PADDING,
        y: PADDING,
        w: STAGE_DIM - PADDING * 2,
        h: STAGE_DIM - PADDING * 2,
      }),
    [parsed]
  );

  const shapeArea = useMemo(() => polygonArea(transformed.points), [transformed]);

  const effectiveParams = useMemo(() => {
    if (settings.autoFit && photos.length > 0) {
      return findAutoParamsForCount(
        transformed.points,
        transformed.bbox,
        shapeArea,
        photos.length
      );
    }
    return { targetCellSize: settings.targetCellSize, minCellSize: settings.minCellSize };
  }, [
    settings.autoFit,
    settings.targetCellSize,
    settings.minCellSize,
    photos.length,
    transformed,
    shapeArea,
  ]);

  const cells = useMemo(
    () => generateCells(transformed.points, transformed.bbox, effectiveParams),
    [transformed, effectiveParams]
  );

  const assignments = useMemo(
    () => assignPhotosToCells(cells, photos.length, shuffleSeed),
    [cells, photos.length, shuffleSeed]
  );

  const contour = useMemo(
    () => computeCellContour(cells, settings.contourOffset),
    [cells, settings.contourOffset]
  );

  // ---------- Photo handling ----------
  const ingestFiles = async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'));
    if (imageFiles.length === 0) return;
    setAnalyzing({ done: 0, total: imageFiles.length });
    try {
      for (let i = 0; i < imageFiles.length; i++) {
        const photo = await processOneFile(imageFiles[i]);
        if (photo) setPhotos((prev) => [...prev, photo]);
        setAnalyzing({ done: i + 1, total: imageFiles.length });
      }
    } finally {
      setAnalyzing(null);
    }
  };

  const processOneFile = async (file: File): Promise<Photo | null> => {
    const src = await readFileAsDataURL(file);
    const img = await loadImage(src);
    if (!img) return null;
    const subject = await detectSubject(img);
    return {
      id:
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`,
      src,
      naturalWidth: img.naturalWidth,
      naturalHeight: img.naturalHeight,
      subject,
    };
  };

  const handleFilesChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    ingestFiles(files);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPhotos(true);
  };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPhotos(false);
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingPhotos(false);
    ingestFiles(Array.from(e.dataTransfer.files));
  };

  // ---------- Hand-tool pan on the stage ----------
  // Drag anywhere in the stage area to scroll its content. Only does anything
  // when the canvas is larger than the viewport (i.e. zoomed in past 100%).
  const isOverflowing = (el: HTMLElement) =>
    el.scrollWidth > el.clientWidth || el.scrollHeight > el.clientHeight;

  const handlePanDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const el = stageInnerRef.current;
    if (!el || !isOverflowing(el)) return;
    panStateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: el.scrollLeft,
      scrollTop: el.scrollTop,
    };
    setIsPanning(true);
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore unsupported */
    }
  };

  const handlePanMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const state = panStateRef.current;
    const el = stageInnerRef.current;
    if (!state || !el) return;
    el.scrollLeft = state.scrollLeft - (e.clientX - state.startX);
    el.scrollTop = state.scrollTop - (e.clientY - state.startY);
  };

  const handlePanEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    panStateRef.current = null;
    setIsPanning(false);
    try {
      stageInnerRef.current?.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const handleClearPhotos = () => setPhotos([]);
  const handleShuffle = () => setShuffleSeed((s) => s + 1);
  const handleAddPhotos = () => fileInputRef.current?.click();
  const handleDeletePhoto = (photoId: string) => {
    setPhotos((prev) => prev.filter((photo) => photo.id !== photoId));
    setEditingPhotoId((current) => (current === photoId ? null : current));
  };
  const editingPhoto = useMemo(
    () => photos.find((photo) => photo.id === editingPhotoId) ?? null,
    [editingPhotoId, photos]
  );

  const handleSaveManualFrame = (photoId: string, frame: ManualFrame) => {
    setPhotos((prev) =>
      prev.map((photo) =>
        photo.id === photoId ? { ...photo, manualFrame: frame } : photo
      )
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

  const handleRedetect = async () => {
    if (photos.length === 0) return;
    setAnalyzing({ done: 0, total: photos.length });
    try {
      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        const img = await loadImage(p.src);
        if (img) {
          const subject = await detectSubject(img);
          setPhotos((prev) => {
            const next = prev.slice();
            const idx = next.findIndex((x) => x.id === p.id);
            if (idx >= 0) next[idx] = { ...next[idx], subject };
            return next;
          });
        }
        setAnalyzing({ done: i + 1, total: photos.length });
      }
    } finally {
      setAnalyzing(null);
    }
  };

  // ---------- Export ----------
  const handleExport = async (es: ExportSettings) => {
    const stage = stageRef.current;
    if (!stage) return;

    // For bitmap export we want the contour drawn ON the bitmap.
    // For PDF/SVG we hide the contour during rasterization and re-add it
    // afterwards as a true vector path on top.
    const renderContourAsVector = es.format === 'pdf' || es.format === 'svg';
    const prevContourShow = settings.contourShow;
    // Transparency: format must support it; modal toggle picks it explicitly.
    const formatSupportsAlpha =
      es.format === 'png' || es.format === 'svg' || es.format === 'pdf';
    const wantTransparent = es.transparent && formatSupportsAlpha;
    const prevBgTransparent = settings.bgTransparent;
    // Temporarily reset zoom so toDataURL renders at the export resolution
    // without being multiplied by the current visual scale.
    const prevZoom = zoom;

    const mime = es.format === 'jpg' ? 'image/jpeg' : 'image/png';
    let dataUrl: string;

    try {
      if (
        (renderContourAsVector && prevContourShow) ||
        wantTransparent !== prevBgTransparent ||
        prevZoom !== 1
      ) {
        setSettings((s) => ({
          ...s,
          contourShow: renderContourAsVector ? false : s.contourShow,
          bgTransparent: wantTransparent,
        }));
        if (prevZoom !== 1) setZoom(1);
        // One animation frame to commit state, then Konva needs another tick
        // to re-render its layers at the new scale.
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        await new Promise((r) => requestAnimationFrame(() => r(null)));
      }

      dataUrl = stage.toDataURL({
        mimeType: mime,
        pixelRatio: es.width / STAGE_DIM,
        quality: es.format === 'jpg' ? 0.92 : 1,
      });
    } catch (e) {
      console.error('Export failed', e);
      alert('Export failed. Try a smaller resolution or fewer photos.');
      return;
    } finally {
      setSettings((s) => ({
        ...s,
        contourShow: prevContourShow,
        bgTransparent: prevBgTransparent,
      }));
      if (prevZoom !== 1) setZoom(prevZoom);
    }

    const sx = es.width / STAGE_DIM;
    const sy = es.height / STAGE_DIM;
    const contourStrokeScale = Math.min(sx, sy);
    const hasVectorContour =
      renderContourAsVector && prevContourShow && contour.loops.length > 0;

    await downloadExport({
      format: es.format,
      dataUrl,
      mime,
      width: es.width,
      height: es.height,
      baseName: `collage-${Date.now()}`,
      hooks: hasVectorContour
        ? {
            svgExtras: `<path d="${contourLoopsToSvgPath(
              contour.loops,
              sx,
              sy
            )}" fill="none" stroke="${settings.contourColor}" stroke-width="${
              settings.contourThickness * contourStrokeScale
            }" stroke-linejoin="miter" stroke-linecap="butt"/>`,
            pdfOverlay: (pdf) => {
              const rgb = hexToRgb(settings.contourColor);
              pdf.setDrawColor(rgb.r, rgb.g, rgb.b);
              pdf.setLineWidth(settings.contourThickness * contourStrokeScale);
              pdf.setLineJoin('miter');
              pdf.setLineCap('butt');
              for (const loop of contour.loops) {
                if (loop.length === 0) continue;
                pdf.moveTo(loop[0].x * sx, loop[0].y * sy);
                for (let i = 1; i < loop.length; i++) {
                  pdf.lineTo(loop[i].x * sx, loop[i].y * sy);
                }
                pdf.close();
                pdf.stroke();
              }
            },
          }
        : undefined,
    });

    onExportRequest(false);
  };

  // ---------- Stage bar info ----------
  const stageMeta = useMemo(() => {
    const parts: string[] = [];
    parts.push(`${cells.length} cell${cells.length === 1 ? '' : 's'}`);
    parts.push(`${photos.length} photo${photos.length === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }, [cells.length, photos.length]);

  const shapeLabel = useMemo(() => {
    return selectedShape.name;
  }, [selectedShape]);

  // ---------- Stage zoom ----------
  const [zoom, setZoom] = useState(1);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  // Pending zoom-to-cursor anchor: the content-space point that should stay
  // under the cursor after the next zoom-driven re-render.
  const zoomAnchorRef = useRef<{
    clientX: number;
    clientY: number;
    contentX: number;
    contentY: number;
  } | null>(null);

  const zoomIn = () => setZoom((z) => clampZoom(+(z + 0.1).toFixed(2)));
  const zoomOut = () => setZoom((z) => clampZoom(+(z - 0.1).toFixed(2)));
  const fit = () => {
    zoomAnchorRef.current = null;
    setZoom(1);
  };

  // Scroll-wheel zoom (zoom-to-cursor). Attached as a native, non-passive
  // listener because React's synthetic onWheel can't preventDefault.
  useEffect(() => {
    const el = stageInnerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const wrap = el.querySelector('.cm-canvas-wrap') as HTMLElement | null;
      if (!wrap) return;
      const old = zoomRef.current;
      // Exponential factor → smooth, framerate-independent zoom.
      const next = clampZoom(+(old * Math.exp(-e.deltaY * 0.0015)).toFixed(3));
      if (next === old) return;
      const rect = wrap.getBoundingClientRect();
      zoomAnchorRef.current = {
        clientX: e.clientX,
        clientY: e.clientY,
        contentX: (e.clientX - rect.left) / old,
        contentY: (e.clientY - rect.top) / old,
      };
      setZoom(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // After a zoom-to-cursor change commits, nudge scroll so the anchored point
  // stays under the cursor. useLayoutEffect avoids a visible jump.
  useLayoutEffect(() => {
    const anchor = zoomAnchorRef.current;
    const el = stageInnerRef.current;
    if (!anchor || !el) return;
    zoomAnchorRef.current = null;
    const wrap = el.querySelector('.cm-canvas-wrap') as HTMLElement | null;
    if (!wrap) return;
    const rect = wrap.getBoundingClientRect();
    const pointScreenX = rect.left + anchor.contentX * zoom;
    const pointScreenY = rect.top + anchor.contentY * zoom;
    el.scrollLeft += pointScreenX - anchor.clientX;
    el.scrollTop += pointScreenY - anchor.clientY;
  }, [zoom]);

  useEffect(() => {
    onPhotoCountChange(photos.length);
  }, [photos.length, onPhotoCountChange]);

  useEffect(() => {
    if (editingPhotoId && !editingPhoto) setEditingPhotoId(null);
  }, [editingPhoto, editingPhotoId]);

  // ---------- Persist last session (debounced so slider drags don't thrash) ----------
  useEffect(() => {
    const id = setTimeout(() => {
      saveLastSession({ settings, shape: selectedShape });
    }, 300);
    return () => clearTimeout(id);
  }, [settings, selectedShape]);

  // ---------- Clear "active profile" highlight once the look diverges ----------
  useEffect(() => {
    if (!activeProfileId) return;
    const active = profiles.find((p) => p.id === activeProfileId);
    if (!active) {
      setActiveProfileId(null);
      return;
    }
    const matches =
      JSON.stringify(active.settings) === JSON.stringify(settings) &&
      active.shape.id === selectedShape.id &&
      active.shape.d === selectedShape.d &&
      active.shape.viewBox === selectedShape.viewBox;
    if (!matches) setActiveProfileId(null);
  }, [settings, selectedShape, activeProfileId, profiles]);

  // ---------- Profile CRUD ----------
  const handleSaveProfile = (name: string) => {
    const profile = createProfile(name, { settings, shape: selectedShape });
    const next = [profile, ...profiles].slice(0, 50);
    setProfiles(next);
    saveProfiles(next);
    setActiveProfileId(profile.id);
  };

  const handleApplyProfile = (id: string) => {
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return;
    setSettings(mergeSettings(DEFAULT_SETTINGS, profile.settings));
    setSelectedShape(profile.shape);
    setActiveProfileId(id);
  };

  const handleUpdateProfile = (id: string) => {
    const next = profiles.map((p) =>
      p.id === id ? { ...p, settings, shape: selectedShape, createdAt: Date.now() } : p
    );
    setProfiles(next);
    saveProfiles(next);
    setActiveProfileId(id);
  };

  const handleDeleteProfile = (id: string) => {
    const next = profiles.filter((p) => p.id !== id);
    setProfiles(next);
    saveProfiles(next);
    if (activeProfileId === id) setActiveProfileId(null);
  };

  return (
    <main className="cm-main">
      <aside className="cm-panel cm-panel-left">
        <ShapeBrowser
          selectedId={selectedShape.id}
          onSelect={setSelectedShape}
        />
      </aside>

      <section className="cm-stage">
        <div
          ref={stageInnerRef}
          className={`cm-stage-inner ${zoom > 1 ? 'is-pannable' : ''} ${
            isPanning ? 'is-panning' : ''
          }`}
          onPointerDown={handlePanDown}
          onPointerMove={handlePanMove}
          onPointerUp={handlePanEnd}
          onPointerCancel={handlePanEnd}
        >
          <div
            className={`cm-canvas-wrap ${isDraggingPhotos ? 'is-dragging' : ''}`}
            style={{
              width: STAGE_DIM * zoom,
              height: STAGE_DIM * zoom,
            }}
            onDragOver={handleDragOver}
            onDragEnter={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {settings.bgTransparent && <div className="cm-checker" />}
            <ShapeStage
              ref={stageRef}
              width={STAGE_DIM}
              height={STAGE_DIM}
              scale={zoom}
              poly={transformed.points}
              cells={cells}
              photos={photos}
              assignments={assignments}
              bgColor={settings.bgColor}
              bgTransparent={settings.bgTransparent}
              outlineColor="#22e07a"
              gap={settings.gap}
              showOutline={settings.showOutline}
              showDetections={settings.showDetections}
              closeUp={settings.closeUp}
              closeUpTightness={settings.closeUpTightness}
              contourPath={contour.path}
              contourShow={settings.contourShow}
              contourThickness={settings.contourThickness}
              contourColor={settings.contourColor}
              onEditPhoto={setEditingPhotoId}
            />
            {isDraggingPhotos && (
              <div className="cm-drop-overlay">Drop images to add</div>
            )}
            {analyzing && (
              <div className="cm-drop-overlay is-loading">
                Analyzing {analyzing.done}/{analyzing.total}…
              </div>
            )}
          </div>
        </div>
        {!analyzing && photos.length === 0 && (
          <div className="cm-empty-hint">
            Drop images here or use <strong>+ Add</strong> in the right panel
          </div>
        )}
        <StageBar
          shapeLabel={shapeLabel}
          meta={stageMeta}
          zoom={zoom}
          onZoomIn={zoomIn}
          onZoomOut={zoomOut}
          onFit={fit}
        />
      </section>

      <ControlsPanel
        settings={settings}
        setSettings={setSettings}
        photos={photos}
        autoTargetCellSize={effectiveParams.targetCellSize}
        autoMinCellSize={effectiveParams.minCellSize}
        onAddPhotos={handleAddPhotos}
        onShuffle={handleShuffle}
        onClearPhotos={handleClearPhotos}
        onRedetect={handleRedetect}
        onEditPhoto={setEditingPhotoId}
        onDeletePhoto={handleDeletePhoto}
        analyzing={analyzing}
        profiles={profiles}
        activeProfileId={activeProfileId}
        onSaveProfile={handleSaveProfile}
        onApplyProfile={handleApplyProfile}
        onDeleteProfile={handleDeleteProfile}
        onUpdateProfile={handleUpdateProfile}
      />

      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        multiple
        onChange={handleFilesChange}
        style={{ display: 'none' }}
      />

      <ExportModal
        open={exportOpen}
        onClose={() => onExportRequest(false)}
        onExport={handleExport}
        previewLabel={selectedShape.name}
        bgColor={settings.bgColor}
      />

      <FrameEditorModal
        photo={editingPhoto}
        closeUpTightness={settings.closeUpTightness}
        onClose={() => setEditingPhotoId(null)}
        onSave={handleSaveManualFrame}
        onReset={handleResetManualFrame}
      />
    </main>
  );
}

function readFileAsDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (ev) => resolve(ev.target?.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
