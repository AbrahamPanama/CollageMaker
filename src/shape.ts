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
  const svgEl = doc.querySelector('svg');
  const pathEl = doc.querySelector('path');
  if (!svgEl || !pathEl) {
    throw new Error('SVG must contain a <path>');
  }

  const d = pathEl.getAttribute('d') ?? '';
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

  const totalLength = tempPath.getTotalLength();
  const points: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const p = tempPath.getPointAtLength((i / segments) * totalLength);
    points.push({ x: p.x, y: p.y });
  }

  document.body.removeChild(tempSvg);

  return { points, viewBox };
}

function readViewBox(svgEl: SVGSVGElement): ViewBox {
  const vbAttr = svgEl.getAttribute('viewBox');
  if (vbAttr) {
    const parts = vbAttr.split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every((n) => !Number.isNaN(n))) {
      return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }
  }
  const w = Number(svgEl.getAttribute('width')) || 100;
  const h = Number(svgEl.getAttribute('height')) || 100;
  return { x: 0, y: 0, w, h };
}

export function transformPolyline(
  points: Point[],
  viewBox: ViewBox,
  target: ViewBox
): TransformedShape {
  const sx = target.w / viewBox.w;
  const sy = target.h / viewBox.h;
  const s = Math.min(sx, sy);
  const renderedW = viewBox.w * s;
  const renderedH = viewBox.h * s;
  const dx = target.x + (target.w - renderedW) / 2 - viewBox.x * s;
  const dy = target.y + (target.h - renderedH) / 2 - viewBox.y * s;

  const transformed = points.map((p) => ({ x: p.x * s + dx, y: p.y * s + dy }));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of transformed) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  return {
    points: transformed,
    bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
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
