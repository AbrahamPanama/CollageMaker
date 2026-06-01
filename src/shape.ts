import type { Point, ViewBox } from './types';

export type ParsedShape = {
  points: Point[];
  viewBox: ViewBox;
};

export type TransformedShape = {
  points: Point[];
  bbox: ViewBox;
};

export function parseShapePolyline(svgText: string, segments = 600): ParsedShape {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, 'image/svg+xml');
  if (doc.querySelector('parsererror')) {
    throw new Error('SVG could not be parsed');
  }

  const svgEl = doc.querySelector('svg');
  const pathEl = doc.querySelector('path');
  if (!svgEl || !pathEl) {
    throw new Error('SVG must contain a <path>');
  }

  const d = pathEl.getAttribute('d') ?? '';
  if (!d.trim()) {
    throw new Error('SVG path is empty');
  }

  const viewBox = readViewBox(svgEl);

  const ns = 'http://www.w3.org/2000/svg';
  const tempSvg = document.createElementNS(ns, 'svg');
  tempSvg.style.position = 'absolute';
  tempSvg.style.visibility = 'hidden';
  tempSvg.style.pointerEvents = 'none';
  tempSvg.setAttribute('width', '0');
  tempSvg.setAttribute('height', '0');
  const tempPath = document.createElementNS(ns, 'path');
  tempPath.setAttribute('d', d);
  tempSvg.appendChild(tempPath);
  document.body.appendChild(tempSvg);

  try {
    const totalLength = tempPath.getTotalLength();
    if (!Number.isFinite(totalLength) || totalLength <= 0) {
      throw new Error('SVG path has no measurable outline');
    }

    const points: Point[] = [];
    for (let i = 0; i < segments; i++) {
      const p = tempPath.getPointAtLength((i / segments) * totalLength);
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
        throw new Error('SVG path produced invalid coordinates');
      }
      points.push({ x: p.x, y: p.y });
    }

    return { points, viewBox };
  } finally {
    document.body.removeChild(tempSvg);
  }
}

function readViewBox(svgEl: SVGSVGElement): ViewBox {
  const vbAttr = svgEl.getAttribute('viewBox');
  if (vbAttr) {
    const parts = vbAttr.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
      if (parts[2] > 0 && parts[3] > 0) {
        return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
      }
    }
  }
  const w = parseFloat(svgEl.getAttribute('width') ?? '') || 100;
  const h = parseFloat(svgEl.getAttribute('height') ?? '') || 100;
  return { x: 0, y: 0, w, h };
}

export function transformPolyline(
  points: Point[],
  viewBox: ViewBox,
  target: ViewBox
): TransformedShape {
  if (points.length < 3 || viewBox.w <= 0 || viewBox.h <= 0) {
    throw new Error('Shape outline is invalid');
  }

  const sx = target.w / viewBox.w;
  const sy = target.h / viewBox.h;
  const s = Math.min(sx, sy);
  if (!Number.isFinite(s) || s <= 0) {
    throw new Error('Shape cannot be scaled into the stage');
  }

  const renderedW = viewBox.w * s;
  const renderedH = viewBox.h * s;
  const dx = target.x + (target.w - renderedW) / 2 - viewBox.x * s;
  const dy = target.y + (target.h - renderedH) / 2 - viewBox.y * s;

  const transformed = points.map((p) => ({ x: p.x * s + dx, y: p.y * s + dy }));

  return {
    points: transformed,
    bbox: boundsFromPoints(transformed),
  };
}

export function boundsFromPoints(points: Point[]): ViewBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      throw new Error('Shape contains invalid coordinates');
    }
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  const w = maxX - minX;
  const h = maxY - minY;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) {
    throw new Error('Shape has no usable bounds');
  }

  return { x: minX, y: minY, w, h };
}

export function formatViewBox(viewBox: ViewBox): string {
  return [viewBox.x, viewBox.y, viewBox.w, viewBox.h].map(formatNumber).join(' ');
}

function formatNumber(value: number): string {
  const rounded = Math.abs(value) < 1e-9 ? 0 : Number(value.toFixed(3));
  return String(rounded);
}

export function polygonArea(poly: Point[]): number {
  let a = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return Math.abs(a) / 2;
}

export function pointInPolygon(x: number, y: number, poly: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    if (((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

type PathContext = {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
};

export function applyPolylinePath(ctx: PathContext, poly: Point[]) {
  if (poly.length === 0) return;
  ctx.moveTo(poly[0].x, poly[0].y);
  for (let i = 1; i < poly.length; i++) {
    ctx.lineTo(poly[i].x, poly[i].y);
  }
  ctx.closePath();
}
