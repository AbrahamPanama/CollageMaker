import type { Photo } from '../types';

export type Settings = {
  targetCellSize: number;
  minCellSize: number;
  gap: number;
  bgColor: string;
  showOutline: boolean;
  showDetections: boolean;
  closeUp: boolean;
  closeUpTightness: number;
  autoFit: boolean;
  contourShow: boolean;
  contourOffset: number;   // negative = inward, positive = outward, in px
  contourThickness: number;
  contourColor: string;
  bgTransparent: boolean;
};

type Props = {
  settings: Settings;
  setSettings: (next: Settings) => void;
  photos: Photo[];
  autoTargetCellSize: number;
  autoMinCellSize: number;
  onAddPhotos: () => void;
  onShuffle: () => void;
  onClearPhotos: () => void;
  onRedetect: () => void;
  analyzing: { done: number; total: number } | null;
};

const BG_SWATCHES = ['#ffffff', '#f5f1ea', '#1a1a1a', '#0f2027', '#22e07a'];

export function ControlsPanel({
  settings,
  setSettings,
  photos,
  autoTargetCellSize,
  autoMinCellSize,
  onAddPhotos,
  onShuffle,
  onClearPhotos,
  onRedetect,
  analyzing,
}: Props) {
  const setS = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setSettings({ ...settings, [k]: v });

  const hasPhotos = photos.length > 0;

  return (
    <aside className="cm-panel cm-panel-right">
      <section className="cm-section">
        <h3 className="cm-section-h">Photos</h3>
        <div className="cm-photo-pool">
          <button className="cm-add-tile" onClick={onAddPhotos}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
            <span>Add</span>
          </button>
          {photos.map((p) => (
            <span
              key={p.id}
              className={`cm-photo-tile ${
                p.subject?.source === 'face'
                  ? 'tile-face'
                  : p.subject?.source === 'smartcrop'
                  ? 'tile-smartcrop'
                  : ''
              }`}
              style={{ backgroundImage: `url("${p.src}")` }}
              title={
                p.subject
                  ? `framed via ${p.subject.source}`
                  : 'no subject detected'
              }
            />
          ))}
        </div>
        {analyzing && (
          <div className="cm-analyzing">
            Analyzing {analyzing.done}/{analyzing.total}…
          </div>
        )}
        {hasPhotos && !analyzing && (
          <div className="cm-row cm-row-tight">
            <button className="cm-mini" onClick={onShuffle}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 3 21 3 21 8" />
                <line x1="4" y1="20" x2="21" y2="3" />
                <polyline points="21 16 21 21 16 21" />
                <line x1="15" y1="15" x2="21" y2="21" />
                <line x1="4" y1="4" x2="9" y2="9" />
              </svg>
              Shuffle
            </button>
            <button className="cm-mini" onClick={onRedetect}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6" />
                <path d="M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
                <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
              </svg>
              Re-detect
            </button>
            <button className="cm-mini" onClick={onClearPhotos}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" />
                <path d="M19 6l-2 14a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L5 6" />
              </svg>
              Clear
            </button>
          </div>
        )}
      </section>

      <section className="cm-section">
        <h3 className="cm-section-h">Layout</h3>
        <Toggle
          label="Auto-fit to photos"
          checked={settings.autoFit}
          onChange={(v) => setS('autoFit', v)}
        />
        <Slider
          label="Photo size"
          value={settings.targetCellSize}
          min={30}
          max={140}
          unit="px"
          autoText={
            settings.autoFit && hasPhotos ? `auto · ~${Math.round(autoTargetCellSize)}` : null
          }
          onChange={(v) => setSettings({ ...settings, targetCellSize: v, autoFit: false })}
          disabled={settings.autoFit && hasPhotos}
        />
        <Slider
          label="Edge detail"
          value={settings.minCellSize}
          min={6}
          max={50}
          unit="px"
          autoText={
            settings.autoFit && hasPhotos ? `auto · ~${Math.round(autoMinCellSize)}` : null
          }
          onChange={(v) => setSettings({ ...settings, minCellSize: v, autoFit: false })}
          disabled={settings.autoFit && hasPhotos}
        />
        <Slider
          label="Gap"
          value={settings.gap}
          min={0}
          max={8}
          unit="px"
          onChange={(v) => setS('gap', v)}
        />
      </section>

      <section className="cm-section">
        <h3 className="cm-section-h">Framing</h3>
        <Toggle
          label="Auto close-up"
          checked={settings.closeUp}
          onChange={(v) => setS('closeUp', v)}
        />
        <Slider
          label="Tightness"
          value={Math.round(settings.closeUpTightness * 100)}
          min={40}
          max={95}
          unit="%"
          disabled={!settings.closeUp}
          onChange={(v) => setS('closeUpTightness', v / 100)}
        />
        <Toggle
          label="Show outline"
          checked={settings.showOutline}
          onChange={(v) => setS('showOutline', v)}
        />
        <Toggle
          label="Show detected subjects"
          checked={settings.showDetections}
          onChange={(v) => setS('showDetections', v)}
        />
      </section>

      <section className="cm-section">
        <h3 className="cm-section-h">Contour</h3>
        <Toggle
          label="Show contour"
          checked={settings.contourShow}
          onChange={(v) => setS('contourShow', v)}
        />
        <Slider
          label="Offset"
          value={settings.contourOffset}
          min={-30}
          max={30}
          unit="px"
          disabled={!settings.contourShow}
          onChange={(v) => setS('contourOffset', v)}
        />
        <Slider
          label="Thickness"
          value={settings.contourThickness}
          min={1}
          max={10}
          unit="px"
          disabled={!settings.contourShow}
          onChange={(v) => setS('contourThickness', v)}
        />
        <div className="cm-row cm-row-between">
          <span className="cm-row-label">Colour</span>
          <div className="cm-swatches">
            {['#e11d48', '#22e07a', '#000000', '#ffffff', '#2563eb'].map((c) => (
              <button
                key={c}
                aria-label={`Contour ${c}`}
                className={`cm-sw ${settings.contourColor === c ? 'is-active' : ''}`}
                style={{ background: c }}
                onClick={() => setS('contourColor', c)}
              />
            ))}
            <label className="cm-sw cm-sw-pick" title="Custom">
              <input
                type="color"
                value={settings.contourColor}
                onChange={(e) => setS('contourColor', e.target.value)}
              />
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 19l7-7 3 3-7 7-3-3z" />
                <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
              </svg>
            </label>
          </div>
        </div>
      </section>

      <section className="cm-section">
        <h3 className="cm-section-h">Background</h3>
        <div className="cm-row cm-row-between">
          <span className="cm-row-label">Colour</span>
          <div className="cm-swatches">
            <button
              aria-label="Transparent background"
              title="Transparent"
              className={`cm-sw cm-sw-transparent ${settings.bgTransparent ? 'is-active' : ''}`}
              onClick={() => setS('bgTransparent', true)}
            />
            {BG_SWATCHES.map((c) => (
              <button
                key={c}
                aria-label={`Background ${c}`}
                className={`cm-sw ${
                  !settings.bgTransparent && settings.bgColor === c ? 'is-active' : ''
                }`}
                style={{ background: c }}
                onClick={() =>
                  setSettings({ ...settings, bgColor: c, bgTransparent: false })
                }
              />
            ))}
            <label className="cm-sw cm-sw-pick" title="Custom">
              <input
                type="color"
                value={settings.bgColor}
                onChange={(e) =>
                  setSettings({ ...settings, bgColor: e.target.value, bgTransparent: false })
                }
              />
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 19l7-7 3 3-7 7-3-3z" />
                <path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z" />
              </svg>
            </label>
          </div>
        </div>
      </section>
    </aside>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  unit,
  autoText,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unit?: string;
  autoText?: string | null;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <label className={`cm-slider ${disabled ? 'is-disabled' : ''}`}>
      <span className="cm-slider-row">
        <span className="cm-slider-label">{label}</span>
        <span className="cm-slider-val">
          {autoText ?? `${value}${unit ?? ''}`}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(+e.target.value)}
      />
    </label>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="cm-toggle">
      <span>{label}</span>
      <span className={`cm-switch ${checked ? 'is-on' : ''}`} onClick={() => onChange(!checked)}>
        <span className="cm-switch-knob" />
      </span>
    </label>
  );
}
