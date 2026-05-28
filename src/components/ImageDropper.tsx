import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';

export type ImageSourceState = {
  recent: string[]; // data URLs
  selectedIdx: number | null;
};

type Props = {
  state: ImageSourceState;
  onChange: (next: ImageSourceState) => void;
};

export function ImageDropper({ state, onChange }: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const ingest = async (files: File[]) => {
    const imageFiles = files.filter((f) => /^image\//i.test(f.type));
    if (imageFiles.length === 0) return;
    const reads = imageFiles.map(
      (f) =>
        new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(f);
        })
    );
    const next = await Promise.all(reads);
    const merged = [...next, ...state.recent].slice(0, 9);
    onChange({ recent: merged, selectedIdx: 0 });
  };

  const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    ingest(files);
  };

  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };
  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    ingest(Array.from(e.dataTransfer.files));
  };

  return (
    <div className="cm-image-drop">
      <div
        className={`cm-image-dropzone ${isDragging ? 'is-dragging' : ''}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
        <p>Drop an SVG or PNG with transparency</p>
        <span>Used as the collage mask. High-contrast silhouettes work best.</span>
      </div>

      <div className="cm-field">
        <span className="cm-field-label">Recent uploads</span>
        <div className="cm-recent-grid">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => {
            const src = state.recent[i];
            const active = state.selectedIdx === i;
            return (
              <div
                key={i}
                className={`cm-recent-tile ${active ? 'is-active' : ''}`}
                style={src ? { backgroundImage: `url("${src}")` } : undefined}
                onClick={() => src && onChange({ ...state, selectedIdx: i })}
              >
                {!src && <span className="cm-empty-tile" />}
              </div>
            );
          })}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleChange}
      />
    </div>
  );
}
