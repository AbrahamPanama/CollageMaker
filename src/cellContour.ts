// Trace the outer perimeter formed by the union of axis-aligned cells.
//
// Cells may have non-integer positions and non-uniform widths/heights, so we
// rasterize onto a 1-pixel grid (the only step that's guaranteed to align with
// every possible cell). Offset is applied via a two-pass chamfer distance
// transform, which is O(W·H) regardless of offset magnitude — so dragging the
// slider stays smooth.

import type { Cell, Point } from './types';

export type ContourResult = {
  loops: Point[][];      // closed polylines, exterior first
  bbox: { x: number; y: number; w: number; h: number };
};

export function computeCellContour(
  cells: Cell[],
  offsetPx: number = 0
): ContourResult {
  if (cells.length === 0) return { loops: [], bbox: { x: 0, y: 0, w: 0, h: 0 } };

  // ---- 1. Bounding box (padded for offset)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of cells) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x + c.w > maxX) maxX = c.x + c.w;
    if (c.y + c.h > maxY) maxY = c.y + c.h;
  }
  const pad = Math.max(2, Math.ceil(Math.abs(offsetPx)) + 2);
  minX = Math.floor(minX - pad);
  minY = Math.floor(minY - pad);
  maxX = Math.ceil(maxX + pad);
  maxY = Math.ceil(maxY + pad);

  const cols = Math.max(1, maxX - minX);
  const rows = Math.max(1, maxY - minY);

  // ---- 2. Rasterize cells at 1-pixel resolution (floor start, ceil end so
  // every cell is fully covered; adjacent cells overlap by 0 or 1 pixel, which
  // is what we want for a watertight union).
  let grid: Uint8Array = new Uint8Array(cols * rows);
  for (const c of cells) {
    const x0 = Math.max(0, Math.floor(c.x - minX));
    const y0 = Math.max(0, Math.floor(c.y - minY));
    const x1 = Math.min(cols, Math.ceil(c.x + c.w - minX));
    const y1 = Math.min(rows, Math.ceil(c.y + c.h - minY));
    for (let y = y0; y < y1; y++) {
      const row = y * cols;
      for (let x = x0; x < x1; x++) grid[row + x] = 1;
    }
  }

  // ---- 3. Offset via distance transform.
  if (offsetPx > 0) {
    // Dilation: every pixel within `offsetPx` Manhattan-distance of an
    // "inside" pixel becomes inside.
    const dist = distanceTransform(grid, cols, rows, /*target*/ 1);
    grid = thresholdLE(dist, offsetPx);
  } else if (offsetPx < 0) {
    // Erosion: an inside pixel stays inside iff it's at least |offsetPx|
    // pixels away from any outside pixel.
    const dist = distanceTransform(grid, cols, rows, /*target*/ 0);
    grid = thresholdGT(dist, -offsetPx);
  }

  // ---- 4. Emit directed boundary edges (clockwise around each filled pixel)
  // ---- with a 4-neighbour adjacency check.
  const segments: [Point, Point][] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (grid[y * cols + x] !== 1) continue;
      const px = minX + x;
      const py = minY + y;
      // Top edge — empty above ⇒ boundary; walk →
      if (y === 0 || grid[(y - 1) * cols + x] === 0) {
        segments.push([{ x: px, y: py }, { x: px + 1, y: py }]);
      }
      // Right edge — empty right ⇒ boundary; walk ↓
      if (x === cols - 1 || grid[y * cols + (x + 1)] === 0) {
        segments.push([{ x: px + 1, y: py }, { x: px + 1, y: py + 1 }]);
      }
      // Bottom edge — empty below ⇒ boundary; walk ←
      if (y === rows - 1 || grid[(y + 1) * cols + x] === 0) {
        segments.push([{ x: px + 1, y: py + 1 }, { x: px, y: py + 1 }]);
      }
      // Left edge — empty left ⇒ boundary; walk ↑
      if (x === 0 || grid[y * cols + (x - 1)] === 0) {
        segments.push([{ x: px, y: py + 1 }, { x: px, y: py }]);
      }
    }
  }

  // ---- 5. Stitch into closed loops, then drop collinear midpoints.
  const loops = stitchLoops(segments)
    .map(simplifyAxisAligned)
    .filter((l) => l.length >= 3);

  return {
    loops,
    bbox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
  };
}

/**
 * Chamfer L1 distance transform (4-neighbour). Two passes — O(W·H) total —
 * gives every pixel its Manhattan distance to the nearest pixel with the
 * `target` value.
 */
function distanceTransform(
  grid: Uint8Array,
  w: number,
  h: number,
  target: number
): Int32Array {
  const INF = 1 << 28;
  const dist = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) dist[i] = grid[i] === target ? 0 : INF;

  // Forward pass: top-down, left-right.
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) {
      let v = dist[row + x];
      if (x > 0) {
        const c = dist[row + x - 1] + 1;
        if (c < v) v = c;
      }
      if (y > 0) {
        const c = dist[row - w + x] + 1;
        if (c < v) v = c;
      }
      dist[row + x] = v;
    }
  }
  // Backward pass: bottom-up, right-left.
  for (let y = h - 1; y >= 0; y--) {
    const row = y * w;
    for (let x = w - 1; x >= 0; x--) {
      let v = dist[row + x];
      if (x < w - 1) {
        const c = dist[row + x + 1] + 1;
        if (c < v) v = c;
      }
      if (y < h - 1) {
        const c = dist[row + w + x] + 1;
        if (c < v) v = c;
      }
      dist[row + x] = v;
    }
  }
  return dist;
}

function thresholdLE(dist: Int32Array, t: number): Uint8Array {
  const out = new Uint8Array(dist.length);
  for (let i = 0; i < dist.length; i++) out[i] = dist[i] <= t ? 1 : 0;
  return out;
}

function thresholdGT(dist: Int32Array, t: number): Uint8Array {
  const out = new Uint8Array(dist.length);
  for (let i = 0; i < dist.length; i++) out[i] = dist[i] > t ? 1 : 0;
  return out;
}

function stitchLoops(segments: [Point, Point][]): Point[][] {
  if (segments.length === 0) return [];
  const key = (p: Point) => `${p.x}|${p.y}`;

  // Map each unique start-point to all segment indices starting there.
  const startMap = new Map<string, number[]>();
  for (let i = 0; i < segments.length; i++) {
    const k = key(segments[i][0]);
    if (!startMap.has(k)) startMap.set(k, []);
    startMap.get(k)!.push(i);
  }
  const used = new Uint8Array(segments.length);
  const loops: Point[][] = [];

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    const loop: Point[] = [segments[i][0]];
    let currIdx = i;
    let safety = segments.length + 1;
    while (safety-- > 0) {
      used[currIdx] = 1;
      const seg = segments[currIdx];
      loop.push(seg[1]);
      const candidates = startMap.get(key(seg[1])) || [];
      let nextIdx = -1;
      for (const idx of candidates) {
        if (!used[idx]) { nextIdx = idx; break; }
      }
      if (nextIdx === -1) break;
      currIdx = nextIdx;
      if (currIdx === i) break;
    }
    if (loop.length > 1 && key(loop[0]) === key(loop[loop.length - 1])) {
      loop.pop();
    }
    if (loop.length >= 3) loops.push(loop);
  }
  return loops;
}

function simplifyAxisAligned(loop: Point[]): Point[] {
  if (loop.length < 4) return loop;
  const out: Point[] = [];
  const n = loop.length;
  for (let i = 0; i < n; i++) {
    const prev = loop[(i - 1 + n) % n];
    const curr = loop[i];
    const next = loop[(i + 1) % n];
    const horizPrev = prev.y === curr.y;
    const horizNext = curr.y === next.y;
    const vertPrev = prev.x === curr.x;
    const vertNext = curr.x === next.x;
    if ((horizPrev && horizNext) || (vertPrev && vertNext)) continue;
    out.push(curr);
  }
  return out;
}
