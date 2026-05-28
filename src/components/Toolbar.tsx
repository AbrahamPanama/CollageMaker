import type { AspectRatio } from '../types';

type Props = {
  aspectRatios: AspectRatio[];
  selectedAspectLabel: string;
  onAspectChange: (label: string) => void;
  borderWidth: number;
  onBorderWidthChange: (n: number) => void;
  borderColor: string;
  onBorderColorChange: (c: string) => void;
  onExport: () => void;
  onReset: () => void;
};

export function Toolbar({
  aspectRatios,
  selectedAspectLabel,
  onAspectChange,
  borderWidth,
  onBorderWidthChange,
  borderColor,
  onBorderColorChange,
  onExport,
  onReset,
}: Props) {
  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <label>Ratio</label>
        <div className="aspect-buttons">
          {aspectRatios.map((a) => (
            <button
              key={a.label}
              className={a.label === selectedAspectLabel ? 'active' : ''}
              onClick={() => onAspectChange(a.label)}
            >
              {a.label}
            </button>
          ))}
        </div>
      </div>
      <div className="toolbar-group">
        <label>Border</label>
        <input
          type="range"
          min={0}
          max={40}
          value={borderWidth}
          onChange={(e) => onBorderWidthChange(Number(e.target.value))}
        />
        <span className="value">{borderWidth}px</span>
        <input
          type="color"
          value={borderColor}
          onChange={(e) => onBorderColorChange(e.target.value)}
          aria-label="Border color"
        />
      </div>
      <div className="toolbar-group right">
        <button onClick={onReset} className="ghost">
          Reset
        </button>
        <button onClick={onExport} className="primary">
          Export PNG
        </button>
      </div>
    </div>
  );
}
