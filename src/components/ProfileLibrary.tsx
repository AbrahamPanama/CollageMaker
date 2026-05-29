import { useState } from 'react';
import type { Profile } from '../settingsStore';

type Props = {
  profiles: Profile[];
  activeProfileId: string | null;
  onSave: (name: string) => void;
  onApply: (id: string) => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string) => void; // overwrite an existing profile with current settings
};

export function ProfileLibrary({
  profiles,
  activeProfileId,
  onSave,
  onApply,
  onDelete,
  onUpdate,
}: Props) {
  const [name, setName] = useState('');

  const commitSave = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName('');
  };

  return (
    <section className="cm-section">
      <h3 className="cm-section-h">Profiles</h3>

      <div className="cm-profile-save">
        <input
          type="text"
          className="cm-profile-input"
          placeholder="Save current look as…"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commitSave();
          }}
        />
        <button
          className="cm-mini cm-profile-save-btn"
          onClick={commitSave}
          disabled={!name.trim()}
          title="Save profile"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
            <polyline points="17 21 17 13 7 13 7 21" />
            <polyline points="7 3 7 8 15 8" />
          </svg>
          Save
        </button>
      </div>

      {profiles.length === 0 ? (
        <p className="cm-profile-empty">No saved profiles</p>
      ) : (
        <div className="cm-profile-list">
          {profiles.map((p) => (
            <div
              key={p.id}
              className={`cm-profile-row ${activeProfileId === p.id ? 'is-active' : ''}`}
            >
              <button
                className="cm-profile-apply"
                onClick={() => onApply(p.id)}
                title={`Apply "${p.name}"`}
              >
                <span className="cm-profile-dot" />
                <span className="cm-profile-name">{p.name}</span>
              </button>
              <button
                className="cm-profile-icon"
                onClick={() => onUpdate(p.id)}
                title="Overwrite with current settings"
                aria-label={`Update ${p.name}`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
                  <path d="M21 3v5h-5" />
                </svg>
              </button>
              <button
                className="cm-profile-icon cm-profile-del"
                onClick={() => onDelete(p.id)}
                title="Delete profile"
                aria-label={`Delete ${p.name}`}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
