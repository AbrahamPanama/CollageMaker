// Persistence for collage settings:
//   1. Last-session auto-save — the working settings + selected shape are
//      remembered across reloads so the app reopens where you left off.
//   2. Profile library — named presets the user explicitly saves and can
//      re-apply later. A profile captures the full "look" (all settings +
//      selected shape) but never the photos.

import type { Settings } from './components/ControlsPanel';
import type { SelectedShape } from './components/ShapeBrowser';
import { isSafeUserShapeData } from './userShapes';

export type SettingsSnapshot = {
  settings: Settings;
  shape: SelectedShape;
};

export type Profile = SettingsSnapshot & {
  id: string;
  name: string;
  createdAt: number;
};

const PROFILES_KEY = 'collagemaker:profiles:v1';
const LAST_SESSION_KEY = 'collagemaker:lastSession:v1';

// ---------- Last session ----------

export function loadLastSession(): SettingsSnapshot | null {
  return readJson<SettingsSnapshot>(LAST_SESSION_KEY, (v) =>
    isSnapshot(v) ? v : null
  );
}

export function saveLastSession(snapshot: SettingsSnapshot): void {
  writeJson(LAST_SESSION_KEY, snapshot);
}

// ---------- Profiles ----------

export function loadProfiles(): Profile[] {
  return (
    readJson<Profile[]>(PROFILES_KEY, (v) =>
      Array.isArray(v) ? v.filter(isProfile) : null
    ) ?? []
  );
}

export function saveProfiles(profiles: Profile[]): void {
  writeJson(PROFILES_KEY, profiles);
}

export function createProfile(name: string, snapshot: SettingsSnapshot): Profile {
  return {
    id:
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim().slice(0, 40) || 'Untitled',
    settings: snapshot.settings,
    shape: snapshot.shape,
    createdAt: Date.now(),
  };
}

// ---------- internals ----------

function readJson<T>(key: string, validate: (v: unknown) => T | null): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const value = validate(JSON.parse(raw));
    if (!value) localStorage.removeItem(key);
    return value;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.warn(`Failed to persist ${key}`, e);
  }
}

function isSnapshot(v: unknown): v is SettingsSnapshot {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return isSettings(o.settings) && isShape(o.shape);
}

function isProfile(v: unknown): v is Profile {
  if (!isSnapshot(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o.id === 'string' && typeof o.name === 'string';
}

function isSettings(v: unknown): v is Settings {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  // Spot-check a few required numeric/boolean keys; tolerate extra keys so the
  // schema can grow without invalidating stored data.
  return (
    typeof o.targetCellSize === 'number' &&
    typeof o.gap === 'number' &&
    typeof o.bgColor === 'string' &&
    typeof o.autoFit === 'boolean'
  );
}

function isShape(v: unknown): v is SelectedShape {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.id === 'string' &&
    typeof o.name === 'string' &&
    (o.source === 'basic' || o.source === 'user') &&
    typeof o.d === 'string' &&
    o.d.trim().length > 0 &&
    typeof o.viewBox === 'string' &&
    isSafeUserShapeData(o.d, o.viewBox)
  );
}

/** Merge a stored Settings onto current defaults so new keys get sane values. */
export function mergeSettings(defaults: Settings, stored: Partial<Settings>): Settings {
  return { ...defaults, ...stored };
}
