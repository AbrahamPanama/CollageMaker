import { getHeroShape } from '../gridLayout/heroShapes';
import type { GridCell, ScoredLayout } from '../gridLayout/types';

type Props = {
  layouts: ScoredLayout[];
  selectedLayoutId: string | null;
  onSelect: (layoutId: string) => void;
};

export function VariantStrip({ layouts, selectedLayoutId, onSelect }: Props) {
  if (layouts.length === 0) {
    return (
      <div className="cm-grid-variants is-empty">
        <span>No variants yet</span>
      </div>
    );
  }

  return (
    <div className="cm-grid-variants" role="listbox" aria-label="Generated grid variants">
      {layouts.map((layout, index) => (
        <button
          key={layout.id}
          className={`cm-grid-variant ${layout.id === selectedLayoutId ? 'is-active' : ''}`}
          onClick={() => onSelect(layout.id)}
          role="option"
          aria-selected={layout.id === selectedLayoutId}
          title={`Variant ${index + 1}. Score ${layout.score.toFixed(2)}`}
        >
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <rect x="0" y="0" width="100" height="100" rx="2" fill="#111113" />
            {layout.cells.map((cell) => cell.clip ? (
              <path
                key={cell.id}
                d={cellClipToPath(cell)}
                fill="#9aa0a6"
                stroke="#f6f7f8"
                strokeWidth="1"
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <rect
                key={cell.id}
                x={cell.rect.x * 100 + 1.5}
                y={cell.rect.y * 100 + 1.5}
                width={Math.max(1, cell.rect.w * 100 - 3)}
                height={Math.max(1, cell.rect.h * 100 - 3)}
                rx="1"
                fill="#9aa0a6"
              />
            ))}
            {layout.heroOverlay && (
              <path
                d={getHeroShape(layout.heroOverlay.shapeId).svgPath}
                transform={`translate(${layout.heroOverlay.rect.x * 100} ${layout.heroOverlay.rect.y * 100}) scale(${layout.heroOverlay.rect.w} ${layout.heroOverlay.rect.h})`}
                fill="#1fe08a"
                fillOpacity="0.7"
                stroke="#f6f7f8"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          <span>{index + 1}</span>
        </button>
      ))}
    </div>
  );
}

function cellClipToPath(cell: GridCell) {
  if (!cell.clip) return '';
  const scalePoint = (point: { x: number; y: number }) => ({
    x: (cell.rect.x + point.x * cell.rect.w) * 100,
    y: (cell.rect.y + point.y * cell.rect.h) * 100,
  });
  const toPath = (points: { x: number; y: number }[]) => {
    if (points.length === 0) return '';
    const first = scalePoint(points[0]);
    return `M${first.x.toFixed(2)} ${first.y.toFixed(2)} ${points
      .slice(1)
      .map((point) => {
        const scaled = scalePoint(point);
        return `L${scaled.x.toFixed(2)} ${scaled.y.toFixed(2)}`;
      })
      .join(' ')} Z`;
  };
  return [toPath(cell.clip.outer), ...cell.clip.holes.map(toPath)].join(' ');
}
