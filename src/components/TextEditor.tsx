import { FONT_LIBRARY } from '../fonts';

export type TextSourceState = {
  text: string;
  fontId: string;
  letterSpacing: number;
};

type Props = {
  state: TextSourceState;
  onChange: (next: TextSourceState) => void;
};

export function TextEditor({ state, onChange }: Props) {
  return (
    <div className="cm-text-editor">
      <label className="cm-field">
        <span className="cm-field-label">Your text</span>
        <textarea
          rows={2}
          value={state.text}
          onChange={(e) => onChange({ ...state, text: e.target.value })}
          placeholder="Type a word…"
          maxLength={24}
        />
        <span className="cm-field-hint">{state.text.length}/24</span>
      </label>

      <div className="cm-field">
        <span className="cm-field-label">Font</span>
        <div className="cm-font-grid">
          {FONT_LIBRARY.map((f) => (
            <button
              key={f.id}
              className={`cm-font-tile ${state.fontId === f.id ? 'is-active' : ''}`}
              onClick={() => onChange({ ...state, fontId: f.id })}
            >
              <span
                className="cm-font-sample"
                style={{ fontFamily: f.family, fontWeight: f.weight }}
              >
                {f.sample}
              </span>
              <span className="cm-font-name">{f.name}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="cm-field">
        <span className="cm-field-label">Local fonts</span>
        <button
          className="cm-foot-link cm-foot-link-block"
          onClick={async () => {
            // Chrome's Local Font Access API. Falls back gracefully.
            const w = window as unknown as { queryLocalFonts?: () => Promise<unknown[]> };
            if (typeof w.queryLocalFonts !== 'function') {
              alert('Local Font Access is only available in Chrome/Edge with permission.');
              return;
            }
            try {
              const fonts = await w.queryLocalFonts();
              alert(`Found ${fonts.length} local fonts. Picker UI coming soon.`);
            } catch (e) {
              alert('Local font access denied or unavailable.');
              console.warn(e);
            }
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
          </svg>
          Browse system fonts…
        </button>
        <p className="cm-field-hint cm-field-hint-block">
          Reads installed fonts via the Local Font Access API (Chrome / Edge).
        </p>
      </div>

      <div className="cm-field">
        <span className="cm-field-label">
          Letter spacing
          <span className="cm-field-val">{state.letterSpacing}</span>
        </span>
        <input
          type="range"
          min={-10}
          max={20}
          step={1}
          value={state.letterSpacing}
          onChange={(e) => onChange({ ...state, letterSpacing: +e.target.value })}
        />
      </div>
    </div>
  );
}
