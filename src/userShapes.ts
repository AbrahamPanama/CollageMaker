// User-uploaded SVG shapes, persisted in localStorage.

export type UserShape = {
  id: string;
  name: string;
  d: string;
  viewBox: string;
};

const USER_SHAPES_KEY = 'collagemaker:userShapes:v1';
const MAX_USER_SHAPES = 24;
const MAX_PATH_DATA_LENGTH = 250_000;
const SVG_PATH_DATA_RE = /^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\-\s]+$/;

export function loadUserShapes(): UserShape[] {
  try {
    const raw = localStorage.getItem(USER_SHAPES_KEY);
    if (!raw) return [];
    const shapes = sanitizeUserShapes(JSON.parse(raw));
    if (JSON.stringify(shapes) !== raw) saveUserShapes(shapes);
    return shapes;
  } catch {
    return [];
  }
}

export function saveUserShapes(shapes: UserShape[]): void {
  try {
    localStorage.setItem(USER_SHAPES_KEY, JSON.stringify(sanitizeUserShapes(shapes)));
  } catch (e) {
    console.warn('Failed to persist user shapes', e);
  }
}

export function userShapeToSvgText(shape: UserShape): string {
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="${shape.viewBox}"><path d="${shape.d}" fill="black"/></svg>`;
}

export function parseUploadedSvg(svgText: string, filename: string): UserShape | null {
  try {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    if (doc.querySelector('parsererror')) return null;

    const svg = doc.querySelector('svg');
    if (!svg) return null;
    const viewBox = readSvgViewBox(svg);
    if (!viewBox) return null;

    const paths = Array.from(svg.querySelectorAll('path[d]'));
    const path =
      paths.find((p) => !p.closest('defs, clipPath, mask, pattern, symbol')) ?? paths[0];
    if (path) {
      return createUserShape(path.getAttribute('d') ?? '', viewBox, filename);
    }

    const prim = svg.querySelector('rect, circle, ellipse, polygon, polyline');
    if (prim) {
      const d = primitiveToPath(prim);
      if (d) return createUserShape(d, viewBox, filename);
    }
    return null;
  } catch {
    return null;
  }
}

export function sanitizeUserShapes(value: unknown): UserShape[] {
  if (!Array.isArray(value)) return [];

  const seen = new Set<string>();
  const shapes: UserShape[] = [];
  for (const item of value) {
    const shape = normalizeStoredShape(item);
    if (!shape || seen.has(shape.id)) continue;
    seen.add(shape.id);
    shapes.push(shape);
    if (shapes.length >= MAX_USER_SHAPES) break;
  }
  return shapes;
}

function normalizeStoredShape(value: unknown): UserShape | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.name !== 'string') return null;
  if (typeof raw.d !== 'string' || typeof raw.viewBox !== 'string') return null;

  const id = raw.id.trim();
  const name = normalizeShapeName(raw.name);
  const d = normalizePathData(raw.d);
  const viewBox = normalizeViewBox(raw.viewBox);
  if (!id || !d || !viewBox) return null;

  return { id, name, d, viewBox };
}

function createUserShape(d: string, viewBox: string, filename: string): UserShape | null {
  const safeD = normalizePathData(d);
  const safeViewBox = normalizeViewBox(viewBox);
  if (!safeD || !safeViewBox) return null;

  return {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: normalizeShapeName((filename || 'Untitled').replace(/\.svg$/i, '')),
    d: safeD,
    viewBox: safeViewBox,
  };
}

function normalizeShapeName(name: string): string {
  return name.trim().slice(0, 32) || 'Untitled';
}

function normalizePathData(d: string): string | null {
  const pathData = d.trim();
  if (!pathData || pathData.length > MAX_PATH_DATA_LENGTH) return null;
  if (!SVG_PATH_DATA_RE.test(pathData)) return null;
  return pathData;
}

function readSvgViewBox(svg: Element): string | null {
  const viewBox = normalizeViewBox(svg.getAttribute('viewBox') ?? '');
  if (viewBox) return viewBox;

  const w = parseSvgLength(svg.getAttribute('width'));
  const h = parseSvgLength(svg.getAttribute('height'));
  if (!w || !h) return '0 0 100 100';
  return `0 0 ${w} ${h}`;
}

function normalizeViewBox(viewBox: string): string | null {
  const nums = viewBox.trim().split(/[\s,]+/).filter(Boolean).map(Number);
  if (
    nums.length !== 4 ||
    !nums.every(Number.isFinite) ||
    nums[2] <= 0 ||
    nums[3] <= 0
  ) {
    return null;
  }
  return nums.join(' ');
}

function parseSvgLength(value: string | null): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function primitiveToPath(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  const n = (a: string) => parseFloat(el.getAttribute(a) || '0');
  if (tag === 'rect') {
    const x = n('x'), y = n('y'), w = n('width'), h = n('height');
    return `M${x} ${y} h${w} v${h} h${-w} Z`;
  }
  if (tag === 'circle') {
    const cx = n('cx'), cy = n('cy'), r = n('r');
    return `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
  }
  if (tag === 'ellipse') {
    const cx = n('cx'), cy = n('cy'), rx = n('rx'), ry = n('ry');
    return `M${cx - rx} ${cy} a${rx} ${ry} 0 1 0 ${rx * 2} 0 a${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`;
  }
  if (tag === 'polygon' || tag === 'polyline') {
    const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/);
    if (pts.length < 4) return null;
    let d = `M${pts[0]} ${pts[1]}`;
    for (let i = 2; i < pts.length - 1; i += 2) d += ` L${pts[i]} ${pts[i + 1]}`;
    if (tag === 'polygon') d += ' Z';
    return d;
  }
  return null;
}
