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
const GRID_V2_KEY = 'cm.grid.v2';

export type GridV2Settings = {
  aspectId: string;
  customAspectW: number;
  customAspectH: number;
  gutterFraction: number;
  cornerRadius: number;
  background: string;
  closeUp: boolean;
  closeUpTightness: number;
  seed: number;
};

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

// ---------- Grid v2 session settings ----------

export function loadGridV2Settings(defaults: GridV2Settings): GridV2Settings {
  const stored = readJson<Partial<GridV2Settings>>(GRID_V2_KEY, (v) =>
    v && typeof v === 'object' ? v as Partial<GridV2Settings> : null
  );
  return sanitizeGridSettings({ ...defaults, ...(stored ?? {}) }, defaults);
}

export function saveGridV2Settings(settings: GridV2Settings): void {
  writeJson(GRID_V2_KEY, sanitizeGridSettings(settings, settings));
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

function sanitizeGridSettings(settings: GridV2Settings, defaults: GridV2Settings): GridV2Settings {
  return {
    aspectId: typeof settings.aspectId === 'string' ? settings.aspectId : defaults.aspectId,
    customAspectW: saneNumber(settings.customAspectW, defaults.customAspectW, 0.2, 5),
    customAspectH: saneNumber(settings.customAspectH, defaults.customAspectH, 0.2, 5),
    gutterFraction: saneNumber(settings.gutterFraction, defaults.gutterFraction, 0, 0.08),
    cornerRadius: saneNumber(settings.cornerRadius, defaults.cornerRadius, 0, 32),
    background: typeof settings.background === 'string' ? settings.background : defaults.background,
    closeUp: typeof settings.closeUp === 'boolean' ? settings.closeUp : defaults.closeUp,
    closeUpTightness: saneNumber(settings.closeUpTightness, defaults.closeUpTightness, 0.4, 0.95),
    seed: Math.max(1, Math.floor(saneNumber(settings.seed, defaults.seed, 1, Number.MAX_SAFE_INTEGER))),
  };
}

function saneNumber(value: unknown, fallback: number, min: number, max: number) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}
