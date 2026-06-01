// User-uploaded SVG shapes, persisted in localStorage.

import { formatViewBox } from './shape';
import type { ViewBox } from './types';

export type UserShape = {
  id: string;
  name: string;
  d: string;
  viewBox: string;
};

const USER_SHAPES_KEY = 'collagemaker:userShapes:v1';
const MAX_USER_SHAPES = 24;
const MAX_STORAGE_LENGTH = 3_000_000;
const MAX_PATH_DATA_LENGTH = 120_000;
const MAX_PATH_NUMBER_COUNT = 8_000;
const MAX_PATH_COMMAND_COUNT = 4_000;
const MAX_ABS_COORDINATE = 1_000_000_000;
const SVG_PATH_DATA_RE = /^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\-\s]+$/;
const PATH_TOKEN_RE = /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

export function loadUserShapes(): UserShape[] {
  try {
    const raw = localStorage.getItem(USER_SHAPES_KEY);
    if (!raw) return [];
    if (raw.length > MAX_STORAGE_LENGTH) {
      saveUserShapes([]);
      return [];
    }
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

export function isSafeUserShapeData(d: unknown, viewBox: unknown): boolean {
  return Boolean(
    typeof d === 'string' &&
      typeof viewBox === 'string' &&
      normalizePathData(d) &&
      normalizeViewBox(viewBox)
  );
}

export function normalizeUserShapeGeometries(shapes: UserShape[]): UserShape[] {
  const normalized: UserShape[] = [];
  for (const shape of sanitizeUserShapes(shapes)) {
    const next = normalizeUserShapeGeometry(shape);
    if (next) normalized.push(next);
  }
  return normalized;
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

  const geometryViewBox = normalizePathViewBox(safeD, safeViewBox);
  if (!geometryViewBox) return null;

  return {
    id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: normalizeShapeName((filename || 'Untitled').replace(/\.svg$/i, '')),
    d: safeD,
    viewBox: geometryViewBox,
  };
}

function normalizeUserShapeGeometry(shape: UserShape): UserShape | null {
  const viewBox = normalizePathViewBox(shape.d, shape.viewBox);
  if (!viewBox) return null;
  return viewBox === shape.viewBox ? shape : { ...shape, viewBox };
}

function normalizeShapeName(name: string): string {
  return name.trim().slice(0, 32) || 'Untitled';
}

function normalizePathData(d: string): string | null {
  const pathData = d.trim();
  if (!pathData || pathData.length > MAX_PATH_DATA_LENGTH) return null;
  if (!SVG_PATH_DATA_RE.test(pathData)) return null;
  if (!pathDataBounds(pathData)) return null;
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

function normalizePathViewBox(d: string, viewBox: string): string | null {
  const bounds = pathDataBounds(d);
  return bounds ? formatViewBox(bounds) : viewBox;
}

function pathDataBounds(d: string): ViewBox | null {
  const tokens = d.match(PATH_TOKEN_RE);
  if (!tokens) return null;

  let numberCount = 0;
  let commandCount = 0;
  for (const token of tokens) {
    if (isCommandToken(token)) commandCount++;
    else numberCount++;
  }
  if (
    numberCount < 2 ||
    numberCount > MAX_PATH_NUMBER_COUNT ||
    commandCount > MAX_PATH_COMMAND_COUNT
  ) {
    return null;
  }

  try {
    return walkPathBounds(tokens);
  } catch {
    return null;
  }
}

function walkPathBounds(tokens: string[]): ViewBox | null {
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let hasPoint = false;

  const read = () => {
    if (i >= tokens.length || isCommandToken(tokens[i])) return null;
    const n = Number(tokens[i++]);
    if (!Number.isFinite(n) || Math.abs(n) > MAX_ABS_COORDINATE) return null;
    return n;
  };
  const hasNumber = () => i < tokens.length && !isCommandToken(tokens[i]);
  const add = (px: number, py: number) => {
    if (
      !Number.isFinite(px) ||
      !Number.isFinite(py) ||
      Math.abs(px) > MAX_ABS_COORDINATE ||
      Math.abs(py) > MAX_ABS_COORDINATE
    ) {
      throw new Error('coordinate out of range');
    }
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px);
    maxY = Math.max(maxY, py);
    hasPoint = true;
  };
  const point = (relative: boolean) => {
    const px = read();
    const py = read();
    if (px === null || py === null) throw new Error('bad point');
    x = relative ? x + px : px;
    y = relative ? y + py : py;
    add(x, y);
  };
  const control = (relative: boolean) => {
    const px = read();
    const py = read();
    if (px === null || py === null) throw new Error('bad control');
    add(relative ? x + px : px, relative ? y + py : py);
  };

  while (i < tokens.length) {
    const start = i;
    if (isCommandToken(tokens[i])) cmd = tokens[i++];
    if (!cmd) return null;
    const relative = cmd === cmd.toLowerCase();

    switch (cmd.toUpperCase()) {
      case 'M': {
        point(relative);
        sx = x;
        sy = y;
        while (hasNumber()) point(relative);
        break;
      }
      case 'L':
      case 'T': {
        while (hasNumber()) point(relative);
        break;
      }
      case 'H': {
        while (hasNumber()) {
          const px = read();
          if (px === null) throw new Error('bad h');
          x = relative ? x + px : px;
          add(x, y);
        }
        break;
      }
      case 'V': {
        while (hasNumber()) {
          const py = read();
          if (py === null) throw new Error('bad v');
          y = relative ? y + py : py;
          add(x, y);
        }
        break;
      }
      case 'C': {
        while (hasNumber()) {
          control(relative);
          control(relative);
          point(relative);
        }
        break;
      }
      case 'S':
      case 'Q': {
        while (hasNumber()) {
          control(relative);
          point(relative);
        }
        break;
      }
      case 'A': {
        while (hasNumber()) {
          const rx = read();
          const ry = read();
          const rotation = read();
          const largeArc = read();
          const sweep = read();
          if (
            rx === null ||
            ry === null ||
            rotation === null ||
            largeArc === null ||
            sweep === null
          ) {
            throw new Error('bad arc');
          }
          const px = read();
          const py = read();
          if (px === null || py === null) throw new Error('bad arc end');
          const endX = relative ? x + px : px;
          const endY = relative ? y + py : py;
          const arx = Math.abs(rx);
          const ary = Math.abs(ry);
          add(x - arx, y - ary);
          add(x + arx, y + ary);
          add(endX - arx, endY - ary);
          add(endX + arx, endY + ary);
          x = endX;
          y = endY;
          add(x, y);
        }
        break;
      }
      case 'Z': {
        x = sx;
        y = sy;
        add(x, y);
        break;
      }
      default:
        return null;
    }

    if (i === start) throw new Error('path parser made no progress');
  }

  const w = maxX - minX;
  const h = maxY - minY;
  if (!hasPoint || w <= 0 || h <= 0) return null;
  return { x: minX, y: minY, w, h };
}

function isCommandToken(token: string): boolean {
  return token.length === 1 && /[AaCcHhLlMmQqSsTtVvZz]/.test(token);
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
