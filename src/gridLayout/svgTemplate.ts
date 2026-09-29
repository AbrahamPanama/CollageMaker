import { boundsFromPoints, pointInPolygon } from '../shape';
import type { Point, ViewBox } from '../types';
import { mulberry32, shuffle } from './rng';
import type { GridCell, Rect, ScoredLayout, SvgCellClip } from './types';

const PATH_TOKEN_RE = /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;
const MAX_TEMPLATE_CELLS = 30;
const MIN_CELL_AREA = 0.005;
const MASK_SIZE = 16;
const SVG_TEMPLATES_KEY = 'cm.grid.svgTemplates';
const MAX_SAVED_TEMPLATES = 12;
const MAX_SVG_LENGTH = 1_000_000;

export type SvgTemplate = {
  id: string;
  name: string;
  viewBox: ViewBox;
  aspect: number;
  cells: SvgTemplateCell[];
  sourceSvg: string;
  sourcePaths: string[];
};

export type SvgTemplateCell = {
  id: string;
  outer: Point[];
  holes: Point[][];
  bbox: Rect;
  mask: Uint8Array;
};

export type SavedSvgTemplate = {
  id: string;
  name: string;
  sourceSvg: string;
  createdAt: number;
};

export class SvgTemplateError extends Error {
  kind: 'noSections' | 'tooManySections' | 'unparseable';

  constructor(kind: SvgTemplateError['kind'], message: string) {
    super(message);
    this.name = 'SvgTemplateError';
    this.kind = kind;
  }
}

type CandidateContour = {
  points: Point[];
  area: number;
  bbox: Rect;
};

export function parseSvgTemplate(
  svgText: string,
  filename = 'template.svg',
  overrides: Partial<Pick<SvgTemplate, 'id' | 'name'>> = {}
): SvgTemplate {
  const sourceSvg = svgText.trim();
  if (!sourceSvg || sourceSvg.length > MAX_SVG_LENGTH) {
    throw new SvgTemplateError('unparseable', 'SVG is empty or too large.');
  }

  const svgTag = sourceSvg.match(/<svg\b[^>]*>/i)?.[0];
  if (!svgTag) throw new SvgTemplateError('unparseable', 'SVG must contain an <svg> element.');
  const viewBox = readViewBox(svgTag);
  if (!viewBox) throw new SvgTemplateError('unparseable', 'SVG viewBox is missing or invalid.');

  const drawableSvg = stripExcludedSvgSections(sourceSvg);
  const sourcePaths = extractPathData(drawableSvg);
  const contours = [
    ...sourcePaths.flatMap((path) => parsePathContours(path)),
    ...extractPrimitiveContours(drawableSvg),
  ]
    .map((contour) => normalizeContour(contour, viewBox))
    .filter((candidate): candidate is CandidateContour => Boolean(candidate));

  const cells = classifyCells(contours);
  if (cells.length === 0) {
    throw new SvgTemplateError('noSections', 'No closed photo sections were found in the SVG.');
  }
  if (cells.length > MAX_TEMPLATE_CELLS) {
    throw new SvgTemplateError('tooManySections', `SVG has ${cells.length} sections. The grid supports up to ${MAX_TEMPLATE_CELLS}.`);
  }

  cells.sort((a, b) => a.bbox.x - b.bbox.x || a.bbox.y - b.bbox.y || a.bbox.w * a.bbox.h - b.bbox.w * b.bbox.h);

  return {
    id: overrides.id ?? templateIdFromName(filename),
    name: normalizeTemplateName(overrides.name ?? filename.replace(/\.svg$/i, '')),
    viewBox,
    aspect: viewBox.w / viewBox.h,
    cells: cells.map((cell, index) => ({
      ...cell,
      id: `cell-${index}`,
      mask: makeMask(cell.outer, cell.holes, cell.bbox),
    })),
    sourceSvg,
    sourcePaths,
  };
}

export function createUploadedSvgTemplate(svgText: string, filename: string): SvgTemplate {
  return parseSvgTemplate(svgText, filename, {
    id: `svg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: normalizeTemplateName(filename.replace(/\.svg$/i, '')),
  });
}

export function svgTemplateToLayout(template: SvgTemplate, photoIds: string[], seed: number): ScoredLayout {
  const dealtIds = dealPhotoIds(photoIds, seed);
  const cells: GridCell[] = template.cells.map((cell, index) => ({
    id: cell.id,
    photoId: dealtIds[index] ?? '',
    rect: cell.bbox,
    clip: clipRelativeToCell(cell),
    label: String(index + 1),
  }));

  return {
    id: `svg-${template.id}-${Math.max(1, Math.floor(seed))}`,
    family: 'svgTemplate',
    tree: null,
    cells,
    score: 0,
    breakdown: {
      aspectFit: 0,
      subjectSafety: 0,
      areaBalance: 0,
      heroBoost: 0,
      faceWeighting: 0,
      minCell: 0,
      adjacencyVariety: 0,
    },
  };
}

export function loadUserSvgTemplates(): SvgTemplate[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(SVG_TEMPLATES_KEY);
    if (!raw) return [];
    const items = sanitizeSavedTemplates(JSON.parse(raw));
    const parsed = items.flatMap((item) => {
      try {
        return [parseSvgTemplate(item.sourceSvg, item.name, { id: item.id, name: item.name })];
      } catch {
        return [];
      }
    });
    if (parsed.length !== items.length) saveUserSvgTemplates(parsed);
    return parsed;
  } catch {
    localStorage.removeItem(SVG_TEMPLATES_KEY);
    return [];
  }
}

export function saveUserSvgTemplates(templates: SvgTemplate[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const saved: SavedSvgTemplate[] = templates.slice(0, MAX_SAVED_TEMPLATES).map((template) => ({
      id: template.id,
      name: template.name,
      sourceSvg: template.sourceSvg,
      createdAt: Date.now(),
    }));
    localStorage.setItem(SVG_TEMPLATES_KEY, JSON.stringify(saved));
  } catch (error) {
    console.warn('Failed to persist SVG templates', error);
  }
}

function readViewBox(svgTag: string): ViewBox | null {
  const viewBox = getAttr(svgTag, 'viewBox');
  if (viewBox) {
    const parts = viewBox.split(/[\s,]+/).filter(Boolean).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0) {
      return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }
  }

  const width = parseSvgLength(getAttr(svgTag, 'width'));
  const height = parseSvgLength(getAttr(svgTag, 'height'));
  if (!width || !height) return null;
  return { x: 0, y: 0, w: width, h: height };
}

function stripExcludedSvgSections(svgText: string): string {
  return svgText.replace(/<(defs|clipPath|mask|pattern|symbol)\b[\s\S]*?<\/\1>/gi, '');
}

function extractPathData(svgText: string): string[] {
  const paths: string[] = [];
  const re = /<path\b[^>]*\sd=(["'])([\s\S]*?)\1[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(svgText))) {
    const data = decodeEntities(match[2]).trim();
    if (data) paths.push(data);
  }
  return paths;
}

function extractPrimitiveContours(svgText: string): Point[][] {
  const contours: Point[][] = [];
  const re = /<(rect|circle|ellipse|polygon|polyline)\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(svgText))) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    const contour = primitiveContour(tag, attrs);
    if (contour) contours.push(contour);
  }
  return contours;
}

function primitiveContour(tag: string, attrs: string): Point[] | null {
  const n = (name: string) => parseSvgLength(getAttr(attrs, name)) ?? 0;
  if (tag === 'rect') {
    const x = n('x');
    const y = n('y');
    const w = n('width');
    const h = n('height');
    if (w <= 0 || h <= 0) return null;
    return [
      { x, y },
      { x: x + w, y },
      { x: x + w, y: y + h },
      { x, y: y + h },
    ];
  }
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = n('cx');
    const cy = n('cy');
    const rx = tag === 'circle' ? n('r') : n('rx');
    const ry = tag === 'circle' ? n('r') : n('ry');
    if (rx <= 0 || ry <= 0) return null;
    return Array.from({ length: 48 }, (_, index) => {
      const angle = (index / 48) * Math.PI * 2;
      return { x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry };
    });
  }
  if (tag === 'polygon' || tag === 'polyline') {
    const values = (getAttr(attrs, 'points') ?? '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
    if (values.length < 6 || values.some((value) => !Number.isFinite(value))) return null;
    return Array.from({ length: Math.floor(values.length / 2) }, (_, index) => ({
      x: values[index * 2],
      y: values[index * 2 + 1],
    }));
  }
  return null;
}

function parsePathContours(d: string): Point[][] {
  const tokens = d.match(PATH_TOKEN_RE);
  if (!tokens) return [];

  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let current: Point[] = [];
  const contours: Point[][] = [];

  const hasNumber = () => i < tokens.length && !isCommandToken(tokens[i]);
  const read = () => {
    if (!hasNumber()) throw new Error('missing path number');
    const value = Number(tokens[i++]);
    if (!Number.isFinite(value)) throw new Error('bad path number');
    return value;
  };
  const add = (px: number, py: number) => {
    x = px;
    y = py;
    current.push({ x, y });
  };
  const startContour = (px: number, py: number) => {
    finalizeContour();
    x = px;
    y = py;
    sx = px;
    sy = py;
    current = [{ x, y }];
  };
  const readPoint = (relative: boolean) => {
    const px = read();
    const py = read();
    return { x: relative ? x + px : px, y: relative ? y + py : py };
  };
  const finalizeContour = () => {
    const points = trimDuplicateEndpoint(current);
    if (points.length >= 3) contours.push(points);
    current = [];
  };

  try {
    while (i < tokens.length) {
      if (isCommandToken(tokens[i])) cmd = tokens[i++];
      if (!cmd) break;
      const relative = cmd === cmd.toLowerCase();

      switch (cmd.toUpperCase()) {
        case 'M': {
          const first = readPoint(relative);
          startContour(first.x, first.y);
          while (hasNumber()) {
            const point = readPoint(relative);
            add(point.x, point.y);
          }
          break;
        }
        case 'L':
        case 'T': {
          while (hasNumber()) {
            const point = readPoint(relative);
            add(point.x, point.y);
          }
          break;
        }
        case 'H': {
          while (hasNumber()) {
            const px = read();
            add(relative ? x + px : px, y);
          }
          break;
        }
        case 'V': {
          while (hasNumber()) {
            const py = read();
            add(x, relative ? y + py : py);
          }
          break;
        }
        case 'C': {
          while (hasNumber()) {
            const p0 = { x, y };
            const p1 = readPoint(relative);
            const p2 = readPoint(relative);
            const p3 = readPoint(relative);
            sampleCubic(p0, p1, p2, p3).forEach((point) => add(point.x, point.y));
          }
          break;
        }
        case 'S':
        case 'Q': {
          while (hasNumber()) {
            const p0 = { x, y };
            const p1 = readPoint(relative);
            const p2 = readPoint(relative);
            sampleQuadratic(p0, p1, p2).forEach((point) => add(point.x, point.y));
          }
          break;
        }
        case 'A': {
          while (hasNumber()) {
            read();
            read();
            read();
            read();
            read();
            const point = readPoint(relative);
            add(point.x, point.y);
          }
          break;
        }
        case 'Z': {
          x = sx;
          y = sy;
          finalizeContour();
          break;
        }
        default:
          return [];
      }
    }
    finalizeContour();
    return contours;
  } catch {
    return [];
  }
}

function normalizeContour(points: Point[], viewBox: ViewBox): CandidateContour | null {
  const normalized = trimDuplicateEndpoint(
    points.map((point) => ({
      x: (point.x - viewBox.x) / viewBox.w,
      y: (point.y - viewBox.y) / viewBox.h,
    }))
  ).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (normalized.length < 3) return null;

  const bbox = boundsFromPoints(normalized);
  const rect = { x: bbox.x, y: bbox.y, w: bbox.w, h: bbox.h };
  const area = Math.abs(signedArea(normalized));
  if (!Number.isFinite(area) || area <= 0) return null;
  return { points: normalized, area, bbox: rect };
}

function classifyCells(contours: CandidateContour[]): SvgTemplateCell[] {
  const cells: SvgTemplateCell[] = [];
  const sorted = contours.slice().sort((a, b) => b.area - a.area);
  for (const contour of sorted) {
    const sample = interiorSample(contour.points);
    const containingCell = cells.find((cell) => pointInPolygon(sample.x, sample.y, cell.outer));
    if (containingCell) {
      containingCell.holes.push(contour.points);
      continue;
    }
    if (contour.area < MIN_CELL_AREA) continue;
    cells.push({
      id: '',
      outer: contour.points,
      holes: [],
      bbox: contour.bbox,
      mask: new Uint8Array(MASK_SIZE * MASK_SIZE),
    });
  }
  return cells;
}

function makeMask(outer: Point[], holes: Point[][], bbox: Rect): Uint8Array {
  const mask = new Uint8Array(MASK_SIZE * MASK_SIZE);
  for (let y = 0; y < MASK_SIZE; y++) {
    for (let x = 0; x < MASK_SIZE; x++) {
      const px = bbox.x + ((x + 0.5) / MASK_SIZE) * bbox.w;
      const py = bbox.y + ((y + 0.5) / MASK_SIZE) * bbox.h;
      const inside = pointInPolygon(px, py, outer) && !holes.some((hole) => pointInPolygon(px, py, hole));
      if (inside) mask[y * MASK_SIZE + x] = 1;
    }
  }
  return mask;
}

function clipRelativeToCell(cell: SvgTemplateCell): SvgCellClip {
  const rel = (point: Point) => ({
    x: (point.x - cell.bbox.x) / cell.bbox.w,
    y: (point.y - cell.bbox.y) / cell.bbox.h,
  });
  return {
    outer: cell.outer.map(rel),
    holes: cell.holes.map((hole) => hole.map(rel)),
  };
}

function dealPhotoIds(photoIds: string[], seed: number) {
  if (seed <= 1) return photoIds.slice();
  return shuffle(photoIds, mulberry32(seed));
}

function interiorSample(points: Point[]): Point {
  const bbox = boundsFromPoints(points);
  const center = { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 };
  if (pointInPolygon(center.x, center.y, points)) return center;
  return points[0] ?? center;
}

function sampleCubic(p0: Point, p1: Point, p2: Point, p3: Point): Point[] {
  return Array.from({ length: 8 }, (_, index) => {
    const t = (index + 1) / 8;
    const mt = 1 - t;
    return {
      x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
      y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y,
    };
  });
}

function sampleQuadratic(p0: Point, p1: Point, p2: Point): Point[] {
  return Array.from({ length: 8 }, (_, index) => {
    const t = (index + 1) / 8;
    const mt = 1 - t;
    return {
      x: mt ** 2 * p0.x + 2 * mt * t * p1.x + t ** 2 * p2.x,
      y: mt ** 2 * p0.y + 2 * mt * t * p1.y + t ** 2 * p2.y,
    };
  });
}

function trimDuplicateEndpoint(points: Point[]): Point[] {
  if (points.length < 2) return points.slice();
  const out = points.slice();
  const first = out[0];
  const last = out[out.length - 1];
  if (Math.abs(first.x - last.x) < 1e-8 && Math.abs(first.y - last.y) < 1e-8) out.pop();
  return out;
}

function signedArea(points: Point[]) {
  let area = 0;
  for (let index = 0; index < points.length; index++) {
    const next = (index + 1) % points.length;
    area += points[index].x * points[next].y - points[next].x * points[index].y;
  }
  return area / 2;
}

function getAttr(text: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = text.match(new RegExp(`\\b${escaped}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
  return match ? decodeEntities(match[2]) : null;
}

function parseSvgLength(value: string | null): number | null {
  if (!value) return null;
  const number = parseFloat(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function isCommandToken(token: string): boolean {
  return token.length === 1 && /[AaCcHhLlMmQqSsTtVvZz]/.test(token);
}

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function templateIdFromName(name: string) {
  return `builtin-${normalizeTemplateName(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'svg-template'}`;
}

function normalizeTemplateName(name: string) {
  return name.trim().replace(/\.svg$/i, '').slice(0, 36) || 'SVG template';
}

function sanitizeSavedTemplates(value: unknown): SavedSvgTemplate[] {
  if (!Array.isArray(value)) return [];
  const out: SavedSvgTemplate[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.id !== 'string' || typeof raw.name !== 'string' || typeof raw.sourceSvg !== 'string') continue;
    if (raw.sourceSvg.length > MAX_SVG_LENGTH || seen.has(raw.id)) continue;
    seen.add(raw.id);
    out.push({
      id: raw.id,
      name: normalizeTemplateName(raw.name),
      sourceSvg: raw.sourceSvg,
      createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    });
    if (out.length >= MAX_SAVED_TEMPLATES) break;
  }
  return out;
}
