import type { Layout } from '../types';

type Props = {
  layouts: Layout[];
  selectedId: string;
  onSelect: (id: string) => void;
};

export function LayoutPicker({ layouts, selectedId, onSelect }: Props) {
  return (
    <div className="layout-picker">
      {layouts.map((layout) => (
        <button
          key={layout.id}
          className={`layout-thumb${layout.id === selectedId ? ' selected' : ''}`}
          onClick={() => onSelect(layout.id)}
          aria-label={layout.name}
          title={layout.name}
        >
          <svg viewBox="0 0 100 100" width="56" height="56" aria-hidden="true">
            <rect x="0" y="0" width="100" height="100" fill="#fff" stroke="#d0d0d0" />
            {layout.slots.map((s, i) => (
              <rect
                key={i}
                x={s.x * 100 + 3}
                y={s.y * 100 + 3}
                width={s.w * 100 - 6}
                height={s.h * 100 - 6}
                fill="#9aa0a6"
                rx="2"
              />
            ))}
          </svg>
          <div className="layout-name">{layout.name}</div>
        </button>
      ))}
    </div>
  );
}
