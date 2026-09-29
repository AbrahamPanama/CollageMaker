import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { EchoFill, ManualFrame, Photo } from '../types';
import {
  MAX_MANUAL_ZOOM,
  MIN_MANUAL_ZOOM,
  computeEchoPlacement,
  computePhotoPlacement,
  constrainManualFrame,
  getFitSubjectsFrame,
  getInitialManualFrame,
  isDefaultEchoFill,
  normalizeEchoFill,
  placementUnderfills,
} from '../photoFraming';

type Props = {
  photo: Photo | null;
  closeUpTightness: number;
  aspectRatio?: number;
  onClose: () => void;
  onSave: (photoId: string, frame: ManualFrame) => void;
  onReset: (photoId: string) => void;
  onEchoChange?: (photoId: string, echo: EchoFill | undefined) => void;
};

type DragState = {
  pointerId: number;
  startX: number;
  startY: number;
  frame: ManualFrame;
  imgW: number;
  imgH: number;
};

export function FrameEditorModal({
  photo,
  closeUpTightness,
  aspectRatio = 1,
  onClose,
  onSave,
  onReset,
  onEchoChange,
}: Props) {
  const cropRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const initializedAutoFrameRef = useRef<string | null>(null);
  const [box, setBox] = useState({ w: 1, h: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [frame, setFrame] = useState<ManualFrame>(() =>
    photo ? getInitialManualFrame(photo, closeUpTightness) : { cx: 0.5, cy: 0.5, zoom: 1 }
  );
  const [echo, setEcho] = useState<EchoFill>(() => normalizeEchoFill(photo?.echo));

  useEffect(() => {
    if (!photo) return;
    initializedAutoFrameRef.current = null;
    setFrame(getInitialManualFrame(photo, closeUpTightness));
    setEcho(normalizeEchoFill(photo.echo));
  }, [photo, closeUpTightness]);

  useEffect(() => {
    const el = cropRef.current;
    if (!el) return;

    const sync = () => {
      const rect = el.getBoundingClientRect();
      setBox({ w: Math.max(1, rect.width), h: Math.max(1, rect.height) });
    };

    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [photo]);

  useEffect(() => {
    if (!photo || box.w <= 1 || box.h <= 1) return;
    if (initializedAutoFrameRef.current === photo.id) return;
    initializedAutoFrameRef.current = photo.id;
    setFrame(getInitialManualFrame(photo, closeUpTightness, box.w, box.h));
  }, [box.h, box.w, closeUpTightness, photo]);

  const placement = useMemo(() => {
    if (!photo) return null;
    return computePhotoPlacement(
      { ...photo, manualFrame: constrainManualFrame(frame, photo, box.w, box.h) },
      box.w,
      box.h,
      { closeUp: false, closeUpTightness }
    );
  }, [box.h, box.w, closeUpTightness, frame, photo]);

  if (!photo || !placement) return null;
  const safeAspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const echoActive = echo.mode === 'auto' && placementUnderfills(placement, box.w, box.h);
  const echoPlacement = echoActive ? computeEchoPlacement(photo, box.w, box.h, placement) : null;

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const constrained = constrainManualFrame(frame, photo, box.w, box.h);
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      frame: constrained,
      imgW: placement.w,
      imgH: placement.h,
    };
    setFrame(constrained);
    setIsDragging(true);
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;

    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setFrame(
      constrainManualFrame(
        {
          cx: drag.frame.cx - dx / Math.max(1, drag.imgW),
          cy: drag.frame.cy - dy / Math.max(1, drag.imgH),
          zoom: drag.frame.zoom,
        },
        photo,
        box.w,
        box.h
      )
    );
  };

  const handlePointerEnd = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === e.pointerId) {
      dragRef.current = null;
      setIsDragging(false);
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const handleZoom = (value: number) => {
    setFrame(
      constrainManualFrame(
        { ...frame, zoom: value },
        photo,
        box.w,
        box.h
      )
    );
  };

  return (
    <div className="cm-modal-back" onClick={onClose}>
      <div className="cm-modal cm-frame-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cm-modal-head">
          <div>
            <h2>Manual frame</h2>
            <p>{photo.manualFrame ? 'Override active' : 'Auto source'}</p>
          </div>
          <button className="cm-icon-btn" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="cm-frame-body">
          <div
            ref={cropRef}
            className={`cm-frame-crop ${isDragging ? 'is-dragging' : ''}`}
            style={{ aspectRatio: String(safeAspect) }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
          >
            {echoPlacement && (
              <>
                <img
                  className="cm-frame-echo"
                  src={photo.src}
                  alt=""
                  draggable={false}
                  style={{
                    left: echoPlacement.x,
                    top: echoPlacement.y,
                    width: echoPlacement.w,
                    height: echoPlacement.h,
                    filter: echo.blur > 0 ? `blur(${echo.blur}px)` : undefined,
                  }}
                />
                {echo.dim > 0 && (
                  <span className="cm-frame-echo-dim" style={{ opacity: echo.dim / 100 }} />
                )}
              </>
            )}
            <img
              className={`cm-frame-foreground ${echo.outline && echoPlacement ? 'has-outline' : ''}`}
              src={photo.src}
              alt=""
              draggable={false}
              style={{
                left: placement.x,
                top: placement.y,
                width: placement.w,
                height: placement.h,
              }}
            />
            {placement.subjectBox && (
              <span
                className={`cm-frame-subject is-${placement.subjectBox.source}`}
                style={{
                  left: placement.subjectBox.x,
                  top: placement.subjectBox.y,
                  width: placement.subjectBox.w,
                  height: placement.subjectBox.h,
                }}
              />
            )}
            <span className="cm-frame-reticle" />
          </div>

          <div className="cm-frame-tools">
            <button
              className="cm-mini"
              type="button"
              onClick={() => setFrame(getFitSubjectsFrame(photo, box.w, box.h))}
            >
              Fit subjects
            </button>
            <button
              className="cm-mini"
              type="button"
              onClick={() => setEcho({ mode: 'auto', blur: 16, dim: 25, outline: true })}
            >
              Soft echo
            </button>
          </div>

          <label className="cm-slider cm-frame-zoom">
            <span className="cm-slider-row">
              <span className="cm-slider-label">Zoom</span>
              <span className="cm-slider-val">{frame.zoom.toFixed(2)}×</span>
            </span>
            <input
              type="range"
              min={MIN_MANUAL_ZOOM}
              max={MAX_MANUAL_ZOOM}
              step={0.05}
              value={frame.zoom}
              onChange={(e) => handleZoom(+e.target.value)}
            />
          </label>

          <div className="cm-frame-echo-panel">
            <label className="cm-toggle">
              <span>Echo fill</span>
              <input
                type="checkbox"
                checked={echo.mode === 'auto'}
                onChange={(event) =>
                  setEcho((prev) => ({ ...prev, mode: event.target.checked ? 'auto' : 'off' }))
                }
              />
            </label>
            <label className={`cm-slider ${echo.mode === 'off' ? 'is-disabled' : ''}`}>
              <span className="cm-slider-row">
                <span className="cm-slider-label">Blur</span>
                <span className="cm-slider-val">{Math.round(echo.blur)}px</span>
              </span>
              <input
                type="range"
                min={0}
                max={40}
                step={1}
                value={echo.blur}
                disabled={echo.mode === 'off'}
                onChange={(event) => setEcho((prev) => ({ ...prev, blur: +event.target.value }))}
              />
            </label>
            <label className={`cm-slider ${echo.mode === 'off' ? 'is-disabled' : ''}`}>
              <span className="cm-slider-row">
                <span className="cm-slider-label">Dim</span>
                <span className="cm-slider-val">{Math.round(echo.dim)}%</span>
              </span>
              <input
                type="range"
                min={0}
                max={60}
                step={1}
                value={echo.dim}
                disabled={echo.mode === 'off'}
                onChange={(event) => setEcho((prev) => ({ ...prev, dim: +event.target.value }))}
              />
            </label>
            <label className="cm-toggle">
              <span>Foreground outline</span>
              <input
                type="checkbox"
                checked={echo.outline}
                disabled={echo.mode === 'off'}
                onChange={(event) => setEcho((prev) => ({ ...prev, outline: event.target.checked }))}
              />
            </label>
            <p className="cm-frame-hint">Below 100%, the photo's enlarged copy fills the background.</p>
          </div>
        </div>

        <div className="cm-modal-foot">
          <button
            className="cm-btn cm-btn-ghost"
            onClick={() => {
              onReset(photo.id);
              onClose();
            }}
          >
            Auto
          </button>
          <div className="cm-foot-actions">
            <button className="cm-btn cm-btn-ghost" onClick={onClose}>Cancel</button>
            <button
              className="cm-btn cm-btn-primary"
              onClick={() => {
                onSave(photo.id, constrainManualFrame(frame, photo, box.w, box.h));
                onEchoChange?.(photo.id, isDefaultEchoFill(echo) ? undefined : normalizeEchoFill(echo));
                onClose();
              }}
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
