import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { BASIC_SHAPES, type BasicShape } from '../shapes/library';
import {
  loadUserShapes,
  parseUploadedSvg,
  saveUserShapes,
  type UserShape,
} from '../userShapes';

export type SelectedShape = {
  id: string;
  d: string;
  viewBox: string;
  name: string;
  source: 'basic' | 'user';
};

type Props = {
  selectedId: string;
  onSelect: (s: SelectedShape) => void;
};

export function ShapeBrowser({ selectedId, onSelect }: Props) {
  const [userShapes, setUserShapes] = useState<UserShape[]>(() => loadUserShapes());
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Detect the active category from the current selection
  const isUserSelected = userShapes.some((s) => s.id === selectedId);
  const [cat, setCat] = useState<'basic' | 'user'>(isUserSelected ? 'user' : 'basic');

  const cats = useMemo(
    () => [
      { id: 'basic' as const, label: 'Basic' },
      { id: 'user' as const, label: 'User' },
    ],
    []
  );

  const shapes: Array<BasicShape | UserShape> = cat === 'user' ? userShapes : BASIC_SHAPES;

  const persist = (next: UserShape[]) => {
    setUserShapes(next);
    saveUserShapes(next);
  };

  const handleUpload = async (file: File | undefined) => {
    if (!file) return;
    if (!/svg/i.test(file.type) && !/\.svg$/i.test(file.name)) {
      alert('Please upload an .svg file.');
      return;
    }
    const text = await file.text();
    const shape = parseUploadedSvg(text, file.name);
    if (!shape) {
      alert("Couldn't read a shape from this SVG. Try one with a single <path>.");
      return;
    }
    const next = [shape, ...userShapes].slice(0, 24);
    persist(next);
    setCat('user');
    onSelect({ ...shape, source: 'user' });
  };

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    handleUpload(file);
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const next = userShapes.filter((s) => s.id !== id);
    persist(next);
    if (selectedId === id) {
      const fallback = BASIC_SHAPES[0];
      onSelect({ ...fallback, source: 'basic' });
      setCat('basic');
    }
  };

  const handleRename = (id: string, newName: string) => {
    const next = userShapes.map((s) =>
      s.id === id ? { ...s, name: newName.slice(0, 32) || 'Untitled' } : s
    );
    persist(next);
  };

  const handleSelect = (s: BasicShape | UserShape) => {
    onSelect({
      id: s.id,
      d: s.d,
      viewBox: s.viewBox,
      name: s.name,
      source: cat,
    });
  };

  return (
    <div className="cm-shape-browser">
      <div className="cm-cat-list">
        {cats.map((c) => (
          <button
            key={c.id}
            className={`cm-cat-chip ${cat === c.id ? 'is-active' : ''}`}
            onClick={() => setCat(c.id)}
          >
            {c.label}
            {c.id === 'user' && userShapes.length > 0 && (
              <span className="cm-cat-count">{userShapes.length}</span>
            )}
          </button>
        ))}
      </div>

      {cat === 'user' && shapes.length === 0 ? (
        <div className="cm-user-empty">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          <p>No saved shapes yet</p>
          <span>Upload an SVG — it'll be saved here for next time.</span>
        </div>
      ) : (
        <div className="cm-shape-grid">
          {shapes.map((s) => (
            <button
              key={s.id}
              className={`cm-shape-cell ${selectedId === s.id ? 'is-active' : ''}`}
              onClick={() => handleSelect(s)}
              title={s.name}
            >
              {cat === 'user' && (
                <span
                  className="cm-shape-del"
                  role="button"
                  aria-label={`Delete ${s.name}`}
                  onClick={(e) => handleDelete(s.id, e)}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </span>
              )}
              <svg viewBox={s.viewBox}>
                <path d={s.d} fill="currentColor" />
              </svg>
              {cat === 'user' ? (
                <input
                  className="cm-shape-cell-rename"
                  defaultValue={s.name}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={(e) => handleRename(s.id, e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                />
              ) : (
                <span className="cm-shape-cell-name">{s.name}</span>
              )}
            </button>
          ))}
        </div>
      )}

      <div className="cm-panel-foot">
        <input
          ref={fileInputRef}
          type="file"
          accept=".svg,image/svg+xml"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />
        <button className="cm-foot-link" onClick={() => fileInputRef.current?.click()}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Upload custom SVG
        </button>
        {cat === 'user' && userShapes.length > 0 && (
          <button
            className="cm-foot-link cm-foot-link-muted"
            onClick={() => {
              if (confirm(`Delete all ${userShapes.length} saved shapes?`)) {
                persist([]);
                if (isUserSelected) {
                  const fallback = BASIC_SHAPES[0];
                  onSelect({ ...fallback, source: 'basic' });
                  setCat('basic');
                }
              }
            }}
          >
            Clear saved
          </button>
        )}
      </div>
    </div>
  );
}
