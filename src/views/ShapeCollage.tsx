import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import type Konva from 'konva';

import { BASIC_SHAPES, shapeToSvgText } from '../shapes/library';
import { userShapeToSvgText, loadUserShapes } from '../userShapes';
import { parseShapePolyline, polygonArea, transformPolyline } from '../shape';
import {
  assignPhotosToCells,
  findAutoParamsForCount,
  generateCells,
} from '../shapeCollage';
import type { Photo } from '../types';
import { detectSubject } from '../smartFrame';

import { computeCellContour } from '../cellContour';
import { ShapeStage } from '../components/ShapeStage';
import { ShapeBrowser, type SelectedShape } from '../components/ShapeBrowser';
import { ControlsPanel, type Settings } from '../components/ControlsPanel';
import { StageBar } from '../components/StageBar';
import { ExportModal, type ExportSettings } from '../components/ExportModal';

const STAGE_DIM = 600;
const PADDING = 16;

type Props = {
  onExportRequest: (open: boolean) => void;
  exportOpen: boolean;
  onPhotoCountChange: (n: number) => void;
};

export function ShapeCollage({ onExportRequest, exportOpen, onPhotoCountChange }: Props) {
  // ---------- Source state ----------
  const [selectedShape, setSelectedShape] = useState<SelectedShape>(() => ({
    ...BASIC_SHAPES[0],
    source: 'basic',
  }));

  // ---------- Settings ----------
  const [settings, setSettings] = useState<Settings>({
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
  });

  // ---------- Photos / detection ----------
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [analyzing, setAnalyzing] = useState<{ done: number; total: number } | null>(null);
  const [shuffleSeed, setShuffleSeed] = useState(1);
  const [isDraggingPhotos, setIsDraggingPhotos] = useState(false);

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
  const activeShapeSvg = useMemo(() => {
    const basic = BASIC_SHAPES.find((s) => s.id === selectedShape.id);
    if (basic) return shapeToSvgText(basic);
    const user = loadUserShapes().find((s) => s.id === selectedShape.id);
    if (user) return userShapeToSvgText(user);
    return shapeToSvgText(BASIC_SHAPES[0]);
  }, [selectedShape]);

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

    const stamp = Date.now();
    const contourSvgPath = renderContourAsVector
      ? buildContourSvgPath(
          contour.loops,
          STAGE_DIM,
          STAGE_DIM,
          es.width,
          es.height
        )
      : '';

    if (es.format === 'png' || es.format === 'jpg') {
      downloadDataUrl(dataUrl, `collage-${stamp}.${es.format}`);
    } else if (es.format === 'svg') {
      // Bitmap of the photo collage + true vector contour path on top.
      const contourSvg =
        prevContourShow && contourSvgPath
          ? `<path d="${contourSvgPath}" fill="none" stroke="${settings.contourColor}" stroke-width="${
              settings.contourThickness
            }" stroke-linejoin="miter"/>`
          : '';
      const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${es.width} ${es.height}"><image href="${dataUrl}" width="${es.width}" height="${es.height}"/>${contourSvg}</svg>`;
      downloadDataUrl(
        'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg),
        `collage-${stamp}.svg`
      );
    } else if (es.format === 'pdf') {
      const { default: jsPDF } = await import('jspdf');
      const orientation = es.width >= es.height ? 'landscape' : 'portrait';
      const pdf = new jsPDF({
        unit: 'px',
        format: [es.width, es.height],
        orientation,
        hotfixes: ['px_scaling'],
      });
      // Bitmap photo collage as background
      pdf.addImage(
        dataUrl,
        mime === 'image/jpeg' ? 'JPEG' : 'PNG',
        0,
        0,
        es.width,
        es.height,
        undefined,
        'FAST'
      );
      // Vector contour overlay
      if (prevContourShow && contour.loops.length > 0) {
        const sx = es.width / STAGE_DIM;
        const sy = es.height / STAGE_DIM;
        const rgb = hexToRgb(settings.contourColor);
        pdf.setDrawColor(rgb.r, rgb.g, rgb.b);
        pdf.setLineWidth(settings.contourThickness * Math.min(sx, sy));
        for (const loop of contour.loops) {
          for (let i = 0; i < loop.length; i++) {
            const a = loop[i];
            const b = loop[(i + 1) % loop.length];
            pdf.line(a.x * sx, a.y * sy, b.x * sx, b.y * sy);
          }
        }
      }
      pdf.save(`collage-${stamp}.pdf`);
    }
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

  // ---------- Stage zoom (visual only for now) ----------
  const [zoom, setZoom] = useState(1);
  const zoomIn = () => setZoom((z) => Math.min(2, +(z + 0.1).toFixed(2)));
  const zoomOut = () => setZoom((z) => Math.max(0.3, +(z - 0.1).toFixed(2)));
  const fit = () => setZoom(1);

  useEffect(() => {
    onPhotoCountChange(photos.length);
  }, [photos.length, onPhotoCountChange]);

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
              contourLoops={contour.loops}
              contourShow={settings.contourShow}
              contourThickness={settings.contourThickness}
              contourColor={settings.contourColor}
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
        analyzing={analyzing}
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

function downloadDataUrl(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function buildContourSvgPath(
  loops: { x: number; y: number }[][],
  fromW: number,
  fromH: number,
  toW: number,
  toH: number
): string {
  if (loops.length === 0) return '';
  const sx = toW / fromW;
  const sy = toH / fromH;
  return loops
    .map((loop) => {
      if (loop.length === 0) return '';
      const head = `M${(loop[0].x * sx).toFixed(2)} ${(loop[0].y * sy).toFixed(2)}`;
      const tail = loop
        .slice(1)
        .map((p) => `L${(p.x * sx).toFixed(2)} ${(p.y * sy).toFixed(2)}`)
        .join('');
      return head + tail + 'Z';
    })
    .join(' ');
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return { r: 0, g: 0, b: 0 };
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}
