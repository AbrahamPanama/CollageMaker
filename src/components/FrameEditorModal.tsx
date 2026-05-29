import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { ManualFrame, Photo } from '../types';
import {
  MAX_MANUAL_ZOOM,
  computePhotoPlacement,
  constrainManualFrame,
  getInitialManualFrame,
} from '../photoFraming';

type Props = {
  photo: Photo | null;
  closeUpTightness: number;
  onClose: () => void;
  onSave: (photoId: string, frame: ManualFrame) => void;
  onReset: (photoId: string) => void;
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
  onClose,
  onSave,
  onReset,
}: Props) {
  const cropRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const [box, setBox] = useState({ w: 1, h: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const [frame, setFrame] = useState<ManualFrame>(() =>
    photo ? getInitialManualFrame(photo, closeUpTightness) : { cx: 0.5, cy: 0.5, zoom: 1 }
  );

  useEffect(() => {
    if (!photo) return;
    setFrame(getInitialManualFrame(photo, closeUpTightness));
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
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
          >
            <img
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

          <label className="cm-slider cm-frame-zoom">
            <span className="cm-slider-row">
              <span className="cm-slider-label">Zoom</span>
              <span className="cm-slider-val">{frame.zoom.toFixed(2)}×</span>
            </span>
            <input
              type="range"
              min={1}
              max={MAX_MANUAL_ZOOM}
              step={0.05}
              value={frame.zoom}
              onChange={(e) => handleZoom(+e.target.value)}
            />
          </label>
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
