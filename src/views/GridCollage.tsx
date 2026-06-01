import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import type Konva from 'konva';
import { LAYOUTS, ASPECT_RATIOS } from '../layouts';
import type { PhotoState } from '../types';
import { CollageStage } from '../components/CollageStage';
import { ExportModal, type ExportSettings } from '../components/ExportModal';
import { downloadExport } from '../export';
import { computeSlotRect, coverScale } from '../utils';

const MAX_STAGE_DIM = 600;

type Props = {
  onExportRequest: (open: boolean) => void;
  exportOpen: boolean;
  onPhotoCountChange: (n: number) => void;
};

export function GridCollage({ onExportRequest, exportOpen, onPhotoCountChange }: Props) {
  const [layoutId, setLayoutId] = useState<string>(LAYOUTS[3].id);
  const [aspectLabel, setAspectLabel] = useState<string>('1:1');
  const [borderWidth, setBorderWidth] = useState<number>(8);
  const [borderColor, setBorderColor] = useState<string>('#ffffff');
  const [photos, setPhotos] = useState<Record<number, PhotoState | null>>({});
  const [activeSlot, setActiveSlot] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);

  const layout = useMemo(
    () => LAYOUTS.find((l) => l.id === layoutId) ?? LAYOUTS[0],
    [layoutId]
  );
  const aspect = useMemo(
    () => ASPECT_RATIOS.find((a) => a.label === aspectLabel) ?? ASPECT_RATIOS[0],
    [aspectLabel]
  );

  const { stageW, stageH } = useMemo(() => {
    if (aspect.w >= aspect.h) {
      const w = MAX_STAGE_DIM;
      return { stageW: w, stageH: Math.round((w * aspect.h) / aspect.w) };
    }
    const h = MAX_STAGE_DIM;
    return { stageW: Math.round((h * aspect.w) / aspect.h), stageH: h };
  }, [aspect]);

  const slotPhotos = layout.slots.map((_, i) => photos[i] ?? null);
  const filledCount = slotPhotos.filter(Boolean).length;

  useEffect(() => {
    onPhotoCountChange(filledCount);
  }, [filledCount, onPhotoCountChange]);

  // Capture a thumbnail for the export modal preview when it opens.
  useEffect(() => {
    if (!exportOpen) {
      setPreviewSrc(null);
      return;
    }
    const id = requestAnimationFrame(() => {
      const stage = stageRef.current;
      if (!stage) return;
      try {
        setPreviewSrc(
          stage.toDataURL({
            mimeType: 'image/png',
            pixelRatio: 360 / Math.max(stageW, stageH),
          })
        );
      } catch (e) {
        console.warn('Preview capture failed', e);
      }
    });
    return () => cancelAnimationFrame(id);
  }, [exportOpen, stageW, stageH]);

  const handlePickPhoto = (idx: number) => {
    setActiveSlot(idx);
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || activeSlot === null) return;
    const slotIdx = activeSlot;

    const reader = new FileReader();
    reader.onload = (ev) => {
      const src = ev.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const rect = computeSlotRect(layout.slots[slotIdx], stageW, stageH, borderWidth);
        const scale = coverScale(img.naturalWidth, img.naturalHeight, rect.w, rect.h);
        const photo: PhotoState = {
          src,
          naturalWidth: img.naturalWidth,
          naturalHeight: img.naturalHeight,
          x: (rect.w - img.naturalWidth * scale) / 2,
          y: (rect.h - img.naturalHeight * scale) / 2,
          scale,
        };
        setPhotos((p) => ({ ...p, [slotIdx]: photo }));
        setActiveSlot(null);
      };
      img.src = src;
    };
    reader.readAsDataURL(file);
  };

  const handlePhotoChange = (idx: number, photo: PhotoState) => {
    setPhotos((p) => {
      const prev = p[idx];
      if (
        prev &&
        prev.x === photo.x &&
        prev.y === photo.y &&
        prev.scale === photo.scale &&
        prev.src === photo.src
      ) {
        return p;
      }
      return { ...p, [idx]: photo };
    });
  };

  const handleLayoutChange = (id: string) => {
    setLayoutId(id);
    setPhotos({});
  };

  const handleExport = async (es: ExportSettings) => {
    const stage = stageRef.current;
    if (!stage) return;

    const mime = es.format === 'jpg' ? 'image/jpeg' : 'image/png';
    let dataUrl: string;

    try {
      dataUrl = stage.toDataURL({
        mimeType: mime,
        pixelRatio: es.width / stageW,
        quality: es.format === 'jpg' ? 0.92 : 1,
      });
    } catch (e) {
      console.error('Grid export failed', e);
      alert('Export failed. Try a smaller resolution or fewer photos.');
      return;
    }

    await downloadExport({
      format: es.format,
      dataUrl,
      mime,
      width: es.width,
      height: es.height,
      baseName: `grid-collage-${Date.now()}`,
    });
    onExportRequest(false);
  };

  return (
    <main className="cm-grid-view">
      <div className="cm-grid-toolbar">
        <div className="cm-grid-aspects">
          {ASPECT_RATIOS.map((a) => (
            <button
              key={a.label}
              className={a.label === aspectLabel ? 'is-active' : ''}
              onClick={() => setAspectLabel(a.label)}
            >
              {a.label}
            </button>
          ))}
        </div>
        <label>Border</label>
        <input
          type="range"
          min={0}
          max={40}
          value={borderWidth}
          onChange={(e) => setBorderWidth(+e.target.value)}
        />
        <input
          type="color"
          value={borderColor}
          onChange={(e) => setBorderColor(e.target.value)}
        />
        <button className="cm-btn cm-btn-ghost" onClick={() => setPhotos({})}>Reset</button>
      </div>

      <div className="cm-grid-workspace">
        <aside className="cm-grid-sidebar">
          <h3>Layouts</h3>
          <div className="cm-grid-picker">
            {LAYOUTS.map((l) => (
              <button
                key={l.id}
                className={layoutId === l.id ? 'is-active' : ''}
                onClick={() => handleLayoutChange(l.id)}
              >
                <svg viewBox="0 0 100 100" width="44" height="44">
                  <rect x="0" y="0" width="100" height="100" fill="#1a1a1c" stroke="#0a0a0b" />
                  {l.slots.map((s, i) => (
                    <rect
                      key={i}
                      x={s.x * 100 + 4}
                      y={s.y * 100 + 4}
                      width={s.w * 100 - 8}
                      height={s.h * 100 - 8}
                      fill="#9aa0a6"
                      rx="1"
                    />
                  ))}
                </svg>
                <span className="cm-grid-pickname">{l.name}</span>
              </button>
            ))}
          </div>
        </aside>

        <div className="cm-grid-stage">
          <div
            className="cm-canvas-wrap"
            style={{ width: stageW, height: stageH }}
          >
            <CollageStage
              ref={stageRef}
              layout={layout}
              photos={slotPhotos}
              width={stageW}
              height={stageH}
              borderWidth={borderWidth}
              borderColor={borderColor}
              bgColor="#1a1a1c"
              onPhotoChange={handlePhotoChange}
              onPickPhoto={handlePickPhoto}
            />
          </div>
        </div>
      </div>

      <input
        type="file"
        accept="image/*"
        ref={fileInputRef}
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      <ExportModal
        open={exportOpen}
        onClose={() => onExportRequest(false)}
        onExport={handleExport}
        previewLabel={`${layout.name} ${aspect.label}`}
        previewSrc={previewSrc}
        bgColor={borderColor}
        aspectRatio={stageW / stageH}
        allowTransparency={false}
      />
    </main>
  );
}
