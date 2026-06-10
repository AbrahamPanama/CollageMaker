import { useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import type { LoadedPhoto } from '../photoIngest';

type Props = {
  photos: LoadedPhoto[];
  selectedPhotoId: string | null;
  heroPhotoId: string | null;
  lockedPhotoIds: Set<string>;
  analyzing: { done: number; total: number } | null;
  maxPhotos: number;
  onFiles: (files: File[]) => void;
  onSelect: (photoId: string) => void;
  onRemove: (photoId: string) => void;
  onMove: (photoId: string, direction: -1 | 1) => void;
  onSetHero: (photoId: string) => void;
  onToggleLock: (photoId: string) => void;
  onClear: () => void;
};

export function GridTray({
  photos,
  selectedPhotoId,
  heroPhotoId,
  lockedPhotoIds,
  analyzing,
  maxPhotos,
  onFiles,
  onSelect,
  onRemove,
  onMove,
  onSetHero,
  onToggleLock,
  onClear,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const handleFiles = (files: File[]) => {
    setDragging(false);
    onFiles(files);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    handleFiles(Array.from(event.target.files ?? []));
    event.target.value = '';
  };

  const handleDrag = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    handleFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <aside className="cm-grid-sidebar">
      <section className="cm-grid-panel">
        <h3>Photos</h3>
        <div
          className={`cm-grid-drop ${dragging ? 'is-dragging' : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') inputRef.current?.click();
          }}
          onDragOver={handleDrag}
          onDragEnter={handleDrag}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <strong>Add photos</strong>
          <span>Drop a batch or click to browse</span>
          {analyzing && (
            <em>
              Analyzing {analyzing.done}/{analyzing.total}
            </em>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={handleInputChange}
        />

        <div className="cm-grid-tray-meta">
          <span>{photos.length}/{maxPhotos}</span>
          <button className="cm-mini" disabled={photos.length === 0} onClick={onClear}>
            Clear
          </button>
        </div>

        <div className="cm-grid-photo-list">
          {photos.map((photo, index) => {
            const selected = photo.id === selectedPhotoId;
            const isHero = photo.id === heroPhotoId;
            const isLocked = lockedPhotoIds.has(photo.id);
            return (
              <article
                key={photo.id}
                className={`cm-grid-photo-card ${selected ? 'is-active' : ''}`}
                onClick={() => onSelect(photo.id)}
              >
                <img src={photo.src} alt="" />
                <span className="cm-grid-photo-index">{String(index + 1).padStart(2, '0')}</span>
                <span className="cm-grid-photo-name" title={photo.name}>{photo.name}</span>
                <div className="cm-grid-photo-actions">
                  <button
                    aria-label="Move photo earlier"
                    disabled={index === 0}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMove(photo.id, -1);
                    }}
                  >
                    ↑
                  </button>
                  <button
                    aria-label="Move photo later"
                    disabled={index === photos.length - 1}
                    onClick={(event) => {
                      event.stopPropagation();
                      onMove(photo.id, 1);
                    }}
                  >
                    ↓
                  </button>
                  <button
                    className={isHero ? 'is-on' : ''}
                    aria-label="Pin photo as hero"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSetHero(photo.id);
                    }}
                  >
                    ★
                  </button>
                  <button
                    className={isLocked ? 'is-on' : ''}
                    aria-label="Lock photo position"
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleLock(photo.id);
                    }}
                  >
                    {isLocked ? '●' : '○'}
                  </button>
                  <button
                    aria-label="Remove photo"
                    onClick={(event) => {
                      event.stopPropagation();
                      onRemove(photo.id);
                    }}
                  >
                    ×
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </aside>
  );
}
