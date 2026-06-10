import type { ScoredLayout } from '../gridLayout/types';

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
            {layout.cells.map((cell) => (
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
          </svg>
          <span>{index + 1}</span>
        </button>
      ))}
    </div>
  );
}
