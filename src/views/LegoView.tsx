import { Suspense, forwardRef, lazy, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import type Konva from 'konva';

import { ExportModal, type ExportSettings } from '../components/ExportModal';
import { FrameEditorModal } from '../components/FrameEditorModal';
import { LegoBuilderCanvas } from '../components/LegoBuilderCanvas';
import { downloadExport } from '../export';
import { BRICK_KINDS, BRICK_LABELS } from '../lego/bricks';
import { LEGO_PRESETS, getLegoShape } from '../lego/shapes';
import { BRICK_HEIGHT_MM, CELL_SIZE_MM, DEFAULT_PRINT_DPI, mmToPx, panelSizeMm } from '../lego/units';
import { billOfMaterials, monominoRatio, tileShape } from '../lego/tiling';
import type { Face, LegoSet } from '../lego/types';
import { loadPhoto, type LoadedPhoto } from '../photoIngest';
import { normalizeEchoFill } from '../photoFraming';
import type { EchoFill, ManualFrame } from '../types';

// Lego panels are framed loosely, so a zoomed-out photo is common — default the
// echo fill ON with a soft gaussian blur so the empty area reads as a backdrop.
const LEGO_ECHO_DEFAULT: EchoFill = { mode: 'auto', blur: 6, dim: 0, outline: false };

type Props = {
  onExportRequest: (open: boolean) => void;
  exportOpen: boolean;
  onPhotoCountChange: (n: number) => void;
};

const LEGO_STAGE_MAX = 620;
const LegoPreview3D = lazy(() =>
  import('../components/LegoPreview3D').then((module) => ({ default: module.LegoPreview3D }))
);

type Lego2DFrameProps = {
  set: LegoSet;
  face: Face;
  photo: LoadedPhoto | null;
  width: number;
  height: number;
  background: string;
  transparentBg: boolean;
  showGuides: boolean;
  closeUp: boolean;
  closeUpTightness: number;
  onManualFrameChange?: (frame: ManualFrame) => void;
};

export function LegoView({ onExportRequest, exportOpen, onPhotoCountChange }: Props) {
  const [shapeId, setShapeId] = useState('rect-33');
  const [legoSet, setLegoSet] = useState<LegoSet>(() => tileShape(getLegoShape('rect-33')));
  const [face, setFace] = useState<Face>('front');
  const [frontPhoto, setFrontPhoto] = useState<LoadedPhoto | null>(null);
  const [backPhoto, setBackPhoto] = useState<LoadedPhoto | null>(null);
  const [editingFace, setEditingFace] = useState<Face | null>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [hideGuidesForCapture, setHideGuidesForCapture] = useState(false);
  const [background, setBackground] = useState('#111113');
  const [transparentBg, setTransparentBg] = useState(false);
  const [closeUp, setCloseUp] = useState(true);
  const [closeUpTightness, setCloseUpTightness] = useState(0.75);
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');

  const stageRef = useRef<Konva.Stage>(null);
  const activePhoto = face === 'front' ? frontPhoto : backPhoto;
  const editingPhoto = editingFace === 'front' ? frontPhoto : editingFace === 'back' ? backPhoto : null;
  const activeEcho = normalizeEchoFill(activePhoto?.echo ?? LEGO_ECHO_DEFAULT);
  const bom = useMemo(() => billOfMaterials(legoSet), [legoSet]);
  const dimensions = useMemo(() => panelSizeMm(legoSet.cols, legoSet.rows), [legoSet.cols, legoSet.rows]);
  const exportSize = useMemo(
    () => ({
      width: Math.max(1, Math.round(mmToPx(dimensions.width, DEFAULT_PRINT_DPI))),
      height: Math.max(1, Math.round(mmToPx(dimensions.height, DEFAULT_PRINT_DPI))),
    }),
    [dimensions.height, dimensions.width]
  );
  const { stageW, stageH } = useMemo(() => fitLegoStage(dimensions.width / dimensions.height), [dimensions.height, dimensions.width]);
  const monoRatio = monominoRatio(legoSet);

  useEffect(() => {
    onPhotoCountChange(Number(Boolean(frontPhoto)) + Number(Boolean(backPhoto)));
  }, [backPhoto, frontPhoto, onPhotoCountChange]);

  useEffect(() => {
    setLegoSet(tileShape(getLegoShape(shapeId)));
  }, [shapeId]);

  useEffect(() => {
    if (!exportOpen) {
      setPreviewSrc(null);
      return;
    }
    let cancelled = false;
    setHideGuidesForCapture(true);
    waitForPaint(2).then(() => {
      const stage = stageRef.current;
      if (!stage || cancelled) {
        if (!cancelled) setHideGuidesForCapture(false);
        return;
      }
      try {
        setPreviewSrc(stage.toDataURL({ mimeType: 'image/png', pixelRatio: 360 / Math.max(stageW, stageH) }));
      } catch (error) {
        console.warn('Lego preview capture failed', error);
      } finally {
        if (!cancelled) setHideGuidesForCapture(false);
      }
    });
    return () => {
      cancelled = true;
      setHideGuidesForCapture(false);
    };
  }, [exportOpen, stageH, stageW]);

  const handleFiles = async (targetFace: Face, files: File[]) => {
    const file = files.find((candidate) => candidate.type.startsWith('image/'));
    if (!file) return;
    const loaded = await loadPhoto(file);
    if (!loaded) return;
    const photo: LoadedPhoto = { ...loaded, echo: loaded.echo ?? LEGO_ECHO_DEFAULT };
    if (targetFace === 'front') setFrontPhoto(photo);
    else setBackPhoto(photo);
    setFace(targetFace);
  };

  const handleEchoChange = (photoId: string, echo: EchoFill | undefined) => {
    setFrontPhoto((photo) => (photo?.id === photoId ? { ...photo, echo } : photo));
    setBackPhoto((photo) => (photo?.id === photoId ? { ...photo, echo } : photo));
  };

  const handleActiveEchoChange = (echo: EchoFill) => {
    if (face === 'front') {
      setFrontPhoto((photo) => (photo ? { ...photo, echo } : photo));
    } else {
      setBackPhoto((photo) => (photo ? { ...photo, echo } : photo));
    }
  };

  const handleSaveManualFrame = (photoId: string, frame: ManualFrame) => {
    setFrontPhoto((photo) => (photo?.id === photoId ? { ...photo, manualFrame: frame } : photo));
    setBackPhoto((photo) => (photo?.id === photoId ? { ...photo, manualFrame: frame } : photo));
  };

  const handleResetManualFrame = (photoId: string) => {
    const reset = (photo: LoadedPhoto | null) => {
      if (!photo || photo.id !== photoId) return photo;
      const { manualFrame, ...rest } = photo;
      void manualFrame;
      return rest;
    };
    setFrontPhoto(reset);
    setBackPhoto(reset);
  };

  // Reposition the whole-set image for the active face (drag / wheel-zoom on the canvas).
  const handleManualFrameChange = (frame: ManualFrame) => {
    if (face === 'front') setFrontPhoto((photo) => (photo ? { ...photo, manualFrame: frame } : photo));
    else setBackPhoto((photo) => (photo ? { ...photo, manualFrame: frame } : photo));
  };

  const handleExport = async (settings: ExportSettings) => {
    const stage = stageRef.current;
    if (!stage) return;

    setHideGuidesForCapture(true);
    await waitForPaint(2);

    const mime = settings.format === 'jpg' ? 'image/jpeg' : 'image/png';
    const captureMime = settings.preventPureWhite ? 'image/png' : mime;
    let dataUrl: string;
    try {
      dataUrl = stage.toDataURL({
        mimeType: captureMime,
        pixelRatio: settings.width / stageW,
        quality: captureMime === 'image/jpeg' ? 0.92 : 1,
      });
    } catch (error) {
      console.error('Lego export failed', error);
      alert('Export failed. Try a smaller resolution.');
      setHideGuidesForCapture(false);
      return;
    } finally {
      setHideGuidesForCapture(false);
    }

    const saved = await downloadExport({
      format: settings.format,
      dataUrl,
      mime,
      width: settings.width,
      height: settings.height,
      physicalWidthMm: dimensions.width,
      physicalHeightMm: dimensions.height,
      dpi: DEFAULT_PRINT_DPI,
      baseName: `lego-${face}-${Date.now()}`,
      preventPureWhite: settings.preventPureWhite,
    });
    if (saved) onExportRequest(false);
  };

  return (
    <main className="cm-lego-view">
      <aside className="cm-lego-panel">
        <h3>Set</h3>
        <div className="cm-lego-presets" role="radiogroup" aria-label="Lego preset">
          {LEGO_PRESETS.map((preset) => (
            <button
              key={preset.id}
              className={shapeId === preset.id ? 'is-active' : ''}
              role="radio"
              aria-checked={shapeId === preset.id}
              onClick={() => setShapeId(preset.id)}
            >
              <MiniPreset shape={preset} />
              <span>{preset.name}</span>
            </button>
          ))}
        </div>

        <div className="cm-lego-stats">
          <Stat label="Pieces" value={String(bom.total)} />
          {BRICK_KINDS.filter((kind) => bom.byKind[kind] > 0).map((kind) => (
            <Stat key={kind} label={BRICK_LABELS[kind]} value={String(bom.byKind[kind])} />
          ))}
          <Stat label="Size" value={`${Math.round(dimensions.width)} x ${Math.round(dimensions.height)} mm`} />
        </div>
        {shapeId === 'heart' && monoRatio > 0.15 && (
          <p className="cm-lego-note">Heart SKU uses only 2x3 and 1x2 pieces to follow the physical outline.</p>
        )}

        <p className="cm-lego-tool-hint">
          Drag the photo on the panel to reposition it, and scroll to zoom — front and back are framed
          independently. Use the Frame button for a larger editor.
        </p>
      </aside>

      <section className="cm-lego-stage-panel">
        <div className="cm-lego-stage-head">
          <div>
            <h2>Lego photo panel</h2>
            <p>
              {legoSet.cols} studs x {legoSet.rows} courses · {CELL_SIZE_MM} mm stud pitch · {BRICK_HEIGHT_MM} mm high ·{' '}
              {face === 'front' ? 'front' : 'back'} face · {viewMode.toUpperCase()}
            </p>
          </div>
          <div className="cm-lego-stage-actions">
            <div className="cm-lego-segmented" role="group" aria-label="View mode">
              <button className={viewMode === '2d' ? 'is-active' : ''} onClick={() => setViewMode('2d')}>2D</button>
              <button className={viewMode === '3d' ? 'is-active' : ''} onClick={() => setViewMode('3d')}>3D</button>
            </div>
            <div className="cm-lego-segmented" role="group" aria-label="Face">
              <button className={face === 'front' ? 'is-active' : ''} onClick={() => setFace('front')}>Front</button>
              <button className={face === 'back' ? 'is-active' : ''} onClick={() => setFace('back')}>Back</button>
            </div>
          </div>
        </div>

        <div className="cm-lego-stage">
          {viewMode === '2d' ? (
            <Lego2DFrame
              ref={stageRef}
              set={legoSet}
              face={face}
              photo={activePhoto}
              width={stageW}
              height={stageH}
              background={background}
              transparentBg={transparentBg}
              showGuides={!hideGuidesForCapture}
              closeUp={closeUp}
              closeUpTightness={closeUpTightness}
              onManualFrameChange={handleManualFrameChange}
            />
          ) : (
            <>
              <div className="cm-lego-3d-frame" style={{ width: stageW, height: stageH }}>
                <Suspense fallback={<div className="cm-lego-3d-loading">Loading 3D preview...</div>}>
                  <LegoPreview3D
                    set={legoSet}
                    face={face}
                    frontPhoto={frontPhoto}
                    backPhoto={backPhoto}
                    background={background}
                    transparentBg={transparentBg}
                    closeUp={closeUp}
                    closeUpTightness={closeUpTightness}
                    previewSrc={previewSrc}
                  />
                </Suspense>
              </div>
              <div className="cm-lego-capture-stage" style={{ width: stageW, height: stageH }}>
                <LegoBuilderCanvas
                  ref={stageRef}
                  set={legoSet}
                  face={face}
                  photo={activePhoto}
                  width={stageW}
                  height={stageH}
                  background={background}
                  transparentBg={transparentBg}
                  showGuides={!hideGuidesForCapture}
                  closeUp={closeUp}
                  closeUpTightness={closeUpTightness}
                />
              </div>
            </>
          )}
        </div>
      </section>

      <aside className="cm-lego-panel">
        <h3>Images</h3>
        <LegoPhotoSlot face="front" photo={frontPhoto} active={face === 'front'} onFiles={handleFiles} onEdit={() => setEditingFace('front')} onSelect={() => setFace('front')} />
        <LegoPhotoSlot face="back" photo={backPhoto} active={face === 'back'} onFiles={handleFiles} onEdit={() => setEditingFace('back')} onSelect={() => setFace('back')} />

        <h3>Framing</h3>
        <label className="cm-lego-toggle">
          <span>Auto close-up</span>
          <input type="checkbox" checked={closeUp} onChange={(event) => setCloseUp(event.target.checked)} />
        </label>
        <label className="cm-lego-range">
          <span>Tightness</span>
          <input type="range" min={0.4} max={0.95} step={0.01} value={closeUpTightness} onChange={(event) => setCloseUpTightness(Number(event.target.value))} />
          <em>{closeUpTightness.toFixed(2)}</em>
        </label>
        <label className={`cm-lego-toggle ${!activePhoto ? 'is-disabled' : ''}`}>
          <span>Echo fill</span>
          <input
            type="checkbox"
            checked={activeEcho.mode === 'auto'}
            disabled={!activePhoto}
            onChange={(event) =>
              handleActiveEchoChange({ ...activeEcho, mode: event.target.checked ? 'auto' : 'off' })
            }
          />
        </label>
        <label className={`cm-lego-range ${!activePhoto || activeEcho.mode === 'off' ? 'is-disabled' : ''}`}>
          <span>Echo blur</span>
          <input
            type="range"
            min={0}
            max={30}
            step={1}
            value={activeEcho.blur}
            disabled={!activePhoto || activeEcho.mode === 'off'}
            onChange={(event) => handleActiveEchoChange({ ...activeEcho, blur: Number(event.target.value) })}
          />
          <em>{Math.round(activeEcho.blur)} px</em>
        </label>

        <h3>Background</h3>
        <label className="cm-lego-color">
          <span>Color</span>
          <input
            type="color"
            value={background}
            onChange={(event) => {
              setBackground(event.target.value);
              setTransparentBg(false);
            }}
          />
        </label>
        <label className="cm-lego-toggle">
          <span>Transparent</span>
          <input type="checkbox" checked={transparentBg} onChange={(event) => setTransparentBg(event.target.checked)} />
        </label>

        <h3>Preview</h3>
        <div className="cm-lego-preview-placeholder">
          <strong>{viewMode === '3d' ? '3D active' : '2D editing'}</strong>
          <span>{viewMode === '3d' ? 'Orbit to inspect; use Front/Back to flip the camera.' : 'Switch to 3D for the assembled double-sided panel.'}</span>
        </div>
      </aside>

      <FrameEditorModal
        photo={editingPhoto}
        aspectRatio={dimensions.width / dimensions.height}
        closeUpTightness={closeUpTightness}
        onClose={() => setEditingFace(null)}
        onSave={handleSaveManualFrame}
        onReset={handleResetManualFrame}
        onEchoChange={handleEchoChange}
      />

      <ExportModal
        open={exportOpen}
        onClose={() => onExportRequest(false)}
        onExport={handleExport}
        previewLabel={`Lego ${face}`}
        previewSrc={previewSrc}
        bgColor={background}
        aspectRatio={stageW / stageH}
        allowTransparency={true}
        initialTransparent={transparentBg}
        fixedSize={{
          width: exportSize.width,
          height: exportSize.height,
          label: `${formatMm(dimensions.width)} x ${formatMm(dimensions.height)} mm`,
          note: `${exportSize.width.toLocaleString()} x ${exportSize.height.toLocaleString()} px at ${DEFAULT_PRINT_DPI} DPI`,
        }}
        description="Export the visible Lego panel face as clean production artwork without brick labels or guide maps."
      />
    </main>
  );
}

const Lego2DFrame = forwardRef<Konva.Stage, Lego2DFrameProps>(function Lego2DFrame(
  {
    set,
    face,
    photo,
    width,
    height,
    background,
    transparentBg,
    showGuides,
    closeUp,
    closeUpTightness,
    onManualFrameChange,
  },
  ref
) {
  return (
    <div className="cm-lego-canvas-frame" style={{ width, height }}>
      {transparentBg && <div className="cm-checker" />}
      <LegoBuilderCanvas
        ref={ref}
        set={set}
        face={face}
        photo={photo}
        width={width}
        height={height}
        background={background}
        transparentBg={transparentBg}
        showGuides={showGuides}
        closeUp={closeUp}
        closeUpTightness={closeUpTightness}
        onManualFrameChange={onManualFrameChange}
      />
    </div>
  );
});

function LegoPhotoSlot({
  face,
  photo,
  active,
  onFiles,
  onEdit,
  onSelect,
}: {
  face: Face;
  photo: LoadedPhoto | null;
  active: boolean;
  onFiles: (face: Face, files: File[]) => void;
  onEdit: () => void;
  onSelect: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const ingest = (files: File[]) => onFiles(face, files);
  const handleDrag = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(true);
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    ingest(Array.from(event.dataTransfer.files));
  };
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    ingest(files);
  };

  return (
    <div
      className={`cm-lego-photo-slot ${active ? 'is-active' : ''} ${dragging ? 'is-dragging' : ''}`}
      onClick={onSelect}
      onDragOver={handleDrag}
      onDragEnter={handleDrag}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <input ref={inputRef} type="file" accept="image/*" hidden onChange={handleChange} />
      {photo ? (
        <>
          <img src={photo.src} alt="" />
          <div>
            <strong>{face === 'front' ? 'Front' : 'Back'}</strong>
            <span>{photo.name}</span>
          </div>
          <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(); }}>Frame</button>
        </>
      ) : (
        <>
          <div className="cm-lego-photo-empty">{face === 'front' ? 'F' : 'B'}</div>
          <div>
            <strong>{face === 'front' ? 'Front image' : 'Back image'}</strong>
            <span>Drop or browse</span>
          </div>
          <button type="button" onClick={(event) => { event.stopPropagation(); inputRef.current?.click(); }}>Add</button>
        </>
      )}
    </div>
  );
}

function MiniPreset({ shape }: { shape: { cols: number; rows: number; cellMask: boolean[] } }) {
  return (
    <svg viewBox={`0 0 ${shape.cols} ${shape.rows}`} aria-hidden="true">
      {shape.cellMask.map((enabled, index) => {
        if (!enabled) return null;
        const col = index % shape.cols;
        const row = Math.floor(index / shape.cols);
        return <rect key={index} x={col} y={row} width={0.86} height={0.86} rx={0.1} />;
      })}
    </svg>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function fitLegoStage(aspect: number) {
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  if (safeAspect >= 1) {
    return {
      stageW: LEGO_STAGE_MAX,
      stageH: Math.max(1, Math.round(LEGO_STAGE_MAX / safeAspect)),
    };
  }
  return {
    stageW: Math.max(1, Math.round(LEGO_STAGE_MAX * safeAspect)),
    stageH: LEGO_STAGE_MAX,
  };
}

function formatMm(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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
