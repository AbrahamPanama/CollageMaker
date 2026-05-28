type Props = {
  shapeLabel: string;
  meta: string;
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
};

export function StageBar({ shapeLabel, meta, zoom, onZoomIn, onZoomOut, onFit }: Props) {
  return (
    <div className="cm-stage-bar">
      <div className="cm-bar-left">
        <span className="cm-bar-pill">{shapeLabel}</span>
        <span className="cm-bar-sep">·</span>
        <span className="cm-bar-meta">{meta}</span>
      </div>
      <div className="cm-bar-right">
        <button className="cm-bar-btn" title="Zoom out" onClick={onZoomOut}>−</button>
        <span className="cm-bar-zoom">{Math.round(zoom * 100)}%</span>
        <button className="cm-bar-btn" title="Zoom in" onClick={onZoomIn}>+</button>
        <span className="cm-bar-sep">·</span>
        <button className="cm-bar-btn cm-bar-btn-wide" title="Fit to screen" onClick={onFit}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M3 7V3h4M21 7V3h-4M3 17v4h4M21 17v4h-4" />
          </svg>
          Fit
        </button>
      </div>
    </div>
  );
}
