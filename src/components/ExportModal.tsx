import { useEffect, useMemo, useRef, useState } from 'react';
import { pickLegibleText } from '../export';

export type ExportFormat = 'png' | 'jpg' | 'pdf' | 'svg';
export type ExportSettings = {
  format: ExportFormat;
  width: number;
  height: number;
  transparent: boolean;
};

type ResPreset = {
  id: string;
  label: string;
  w: number;
  note: string;
};

const RES_PRESETS: ResPreset[] = [
  { id: 'web',    label: 'Web',          w: 1080, note: 'Social / web'   },
  { id: 'hd',     label: 'HD',           w: 1920, note: 'Hi-res screen'  },
  { id: 'print',  label: 'Print 300dpi', w: 3600, note: 'High-res print' },
  { id: 'poster', label: 'Poster',       w: 7200, note: 'Large format'   },
  { id: 'custom', label: 'Custom',       w: 0,    note: 'Pick your own'  },
];

const FORMATS: Array<{ id: ExportFormat; label: string; desc: string }> = [
  { id: 'png', label: 'PNG', desc: 'Lossless · supports transparency' },
  { id: 'jpg', label: 'JPG', desc: 'Smaller · solid background only'  },
  { id: 'pdf', label: 'PDF', desc: 'Printable document'               },
  { id: 'svg', label: 'SVG', desc: 'Raster image in an SVG wrapper'    },
];

const MAX_EXPORT_DIM = 7200;

type Props = {
  open: boolean;
  onClose: () => void;
  onExport: (settings: ExportSettings) => void;
  previewLabel: string;
  bgColor: string;
  aspectRatio?: number;
  allowTransparency?: boolean;
};

export function ExportModal({
  open,
  onClose,
  onExport,
  previewLabel,
  bgColor,
  aspectRatio = 1,
  allowTransparency = true,
}: Props) {
  const [format, setFormat] = useState<ExportFormat>('png');
  const [presetId, setPresetId] = useState<string>('hd');
  const [customW, setCustomW] = useState(2400);
  const [customH, setCustomH] = useState(2400);
  const [transparent, setTransparent] = useState(false);

  const preset = RES_PRESETS.find((p) => p.id === presetId)!;
  const safeAspect = Number.isFinite(aspectRatio) && aspectRatio > 0 ? aspectRatio : 1;
  const presetDims = fitPresetToAspect(preset.w, safeAspect);
  const w = presetId === 'custom' ? customW : presetDims.w;
  const h = presetId === 'custom' ? customH : presetDims.h;
  const transparentAvailable =
    allowTransparency && (format === 'png' || format === 'svg' || format === 'pdf');
  const finalTransparent = transparent && transparentAvailable;
  // With both sides clamped to MAX_EXPORT_DIM, the product is bounded too,
  // so a separate pixel-area check would be redundant.
  const canExport = w > 0 && h > 0 && w <= MAX_EXPORT_DIM && h <= MAX_EXPORT_DIM;

  // When the parent's aspect ratio changes (e.g. the user switched grid
  // layout), recompute the custom height while preserving the user's current
  // width. We track `customW` via a ref so the effect only fires on aspect
  // changes — typing a new width is handled by the onChange handler below.
  const customWRef = useRef(customW);
  customWRef.current = customW;
  useEffect(() => {
    setCustomH(Math.max(1, Math.round(customWRef.current / safeAspect)));
  }, [safeAspect]);

  const estMb = useMemo(() => {
    if (format === 'jpg') return (w * h * 0.0000005 * 1.5).toFixed(1);
    if (format === 'png') return (w * h * 0.0000016 * 1.2).toFixed(1);
    if (format === 'pdf') return (w * h * 0.0000018 * 1.3).toFixed(1);
    return (w * h * 0.0000004).toFixed(2);
  }, [format, w, h]);

  if (!open) return null;

  return (
    <div className="cm-modal-back" onClick={onClose}>
      <div className="cm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="cm-modal-head">
          <div>
            <h2>Export collage</h2>
            <p>Choose a format and resolution for the current canvas.</p>
          </div>
          <button className="cm-icon-btn" onClick={onClose} aria-label="Close">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="cm-modal-body">
          <div className="cm-modal-col">
            <h4>Format</h4>
            <div className="cm-format-list">
              {FORMATS.map((f) => (
                <button
                  key={f.id}
                  className={`cm-format-row ${format === f.id ? 'is-active' : ''}`}
                  onClick={() => setFormat(f.id)}
                >
                  <span className="cm-format-mark">{f.label}</span>
                  <span className="cm-format-desc">{f.desc}</span>
                  <span className="cm-format-radio" />
                </button>
              ))}
            </div>

            <h4>Resolution</h4>
            <div className="cm-res-grid">
              {RES_PRESETS.map((r) => (
                <button
                  key={r.id}
                  className={`cm-res-tile ${presetId === r.id ? 'is-active' : ''}`}
                  onClick={() => setPresetId(r.id)}
                >
                  <span className="cm-res-label">{r.label}</span>
                  {r.id !== 'custom' ? (
                    <span className="cm-res-dim">
                      {fitPresetToAspect(r.w, safeAspect).w}
                      <span>×</span>
                      {fitPresetToAspect(r.w, safeAspect).h}
                    </span>
                  ) : (
                    <span className="cm-res-dim cm-res-dim-custom">— × —</span>
                  )}
                  <span className="cm-res-note">{r.note}</span>
                </button>
              ))}
            </div>

            {presetId === 'custom' && (
              <div className="cm-custom-dims">
                <label>
                  <span>Width</span>
                  <div className="cm-num">
                    <input
                      type="number"
                      min={1}
                      max={MAX_EXPORT_DIM}
                      value={customW}
                      onChange={(e) => {
                        const next = clampExportDim(+e.target.value);
                        setCustomW(next);
                        setCustomH(Math.max(1, Math.round(next / safeAspect)));
                      }}
                    />
                    <span className="cm-num-suffix">px</span>
                  </div>
                </label>
                <span className="cm-times">×</span>
                <label>
                  <span>Height</span>
                  <div className="cm-num">
                    <input
                      type="number"
                      min={1}
                      max={MAX_EXPORT_DIM}
                      value={customH}
                      onChange={(e) => {
                        const next = clampExportDim(+e.target.value);
                        setCustomH(next);
                        setCustomW(Math.max(1, Math.round(next * safeAspect)));
                      }}
                    />
                    <span className="cm-num-suffix">px</span>
                  </div>
                </label>
              </div>
            )}
          </div>

          <div className="cm-modal-col">
            <h4>Options</h4>
            <ExportToggle
              label="Transparent background"
              hint={
                transparentAvailable
                  ? 'Background fill is omitted'
                  : allowTransparency
                  ? `Not available for ${format.toUpperCase()}`
                  : 'This canvas exports with its background'
              }
              checked={finalTransparent}
              disabled={!transparentAvailable}
              onChange={setTransparent}
            />

            <h4>Preview</h4>
            <div className="cm-preview-card">
              <div
                className="cm-preview-img"
                style={{
                  backgroundColor: finalTransparent ? 'transparent' : bgColor,
                  backgroundImage: finalTransparent
                    ? 'linear-gradient(45deg, #2a2a2c 25%, transparent 25%), linear-gradient(-45deg, #2a2a2c 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #2a2a2c 75%), linear-gradient(-45deg, transparent 75%, #2a2a2c 75%)'
                    : 'none',
                  backgroundSize: '12px 12px',
                  backgroundPosition: '0 0, 0 6px, 6px -6px, -6px 0',
                }}
              >
                <span
                  style={{
                    color: finalTransparent ? '#aaa' : pickLegibleText(bgColor),
                  }}
                >
                  {previewLabel}
                </span>
              </div>
              <dl className="cm-preview-meta">
                <div><dt>Format</dt><dd>{format.toUpperCase()}</dd></div>
                <div><dt>Pixels</dt><dd>{w.toLocaleString()} × {h.toLocaleString()}</dd></div>
                <div><dt>Bg</dt><dd>{finalTransparent ? 'transparent' : bgColor}</dd></div>
                <div><dt>Est. size</dt><dd>~{estMb} MB</dd></div>
              </dl>
            </div>
          </div>
        </div>

        <div className="cm-modal-foot">
          <span className="cm-foot-meta">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            Render runs locally — your photos never leave the browser.
          </span>
          <div className="cm-foot-actions">
            <button className="cm-btn cm-btn-ghost" onClick={onClose}>Cancel</button>
            <button
              className="cm-btn cm-btn-primary"
              disabled={!canExport}
              onClick={() => {
                onExport({
                  format,
                  width: w,
                  height: h,
                  transparent: finalTransparent,
                });
              }}
            >
              Export {format.toUpperCase()}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExportToggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className={`cm-ex-toggle ${disabled ? 'is-disabled' : ''}`}>
      <span className="cm-ex-label">
        <span>{label}</span>
        <small>{hint}</small>
      </span>
      <span
        className={`cm-switch ${checked ? 'is-on' : ''}`}
        onClick={() => !disabled && onChange(!checked)}
      >
        <span className="cm-switch-knob" />
      </span>
    </label>
  );
}

function clampExportDim(value: number) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(MAX_EXPORT_DIM, Math.round(value)));
}

function fitPresetToAspect(longSide: number, aspectRatio: number) {
  if (aspectRatio >= 1) {
    return { w: longSide, h: Math.max(1, Math.round(longSide / aspectRatio)) };
  }
  return { w: Math.max(1, Math.round(longSide * aspectRatio)), h: longSide };
}
