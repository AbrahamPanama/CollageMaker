type Props = {
  mode: 'shape' | 'grid';
  onMode: (m: 'shape' | 'grid') => void;
  photoCount: number;
  onExport: () => void;
};

export function Header({ mode, onMode, photoCount, onExport }: Props) {
  return (
    <header className="cm-header">
      <div className="cm-brand">
        <span className="cm-logo" />
        <span className="cm-brand-name">Collage Maker</span>
      </div>
      <nav className="cm-tabs" role="tablist">
        {(['shape', 'grid'] as const).map((m) => (
          <button
            key={m}
            role="tab"
            aria-selected={mode === m}
            className={`cm-tab ${mode === m ? 'is-active' : ''}`}
            onClick={() => onMode(m)}
          >
            {m === 'shape' ? 'Shape' : 'Grid'}
          </button>
        ))}
      </nav>
      <div className="cm-header-right">
        <span className="cm-photo-pill">
          <span className="cm-photo-pill-dot" />
          {`${photoCount} photo${photoCount === 1 ? '' : 's'}`}
        </span>
        <button className="cm-btn cm-btn-ghost" title="Undo" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7v6h6" />
            <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
          </svg>
        </button>
        <button className="cm-btn cm-btn-ghost" title="Redo" disabled>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 7v6h-6" />
            <path d="M3 17a9 9 0 0 1 15-6.7L21 13" />
          </svg>
        </button>
        <button className="cm-btn cm-btn-primary" onClick={onExport}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export
        </button>
      </div>
    </header>
  );
}
