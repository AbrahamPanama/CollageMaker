import type { Cell, Point, ViewBox } from './types';
import { pointInPolygon } from './shape';

type Bounds = { x: number; y: number; w: number; h: number };

export type CellGenOptions = {
  targetCellSize: number;
  minCellSize: number;
};

export function generateCells(
  poly: Point[],
  bbox: ViewBox,
  opts: CellGenOptions
): Cell[] {
  const { targetCellSize, minCellSize } = opts;
  const cols = Math.max(1, Math.round(bbox.w / targetCellSize));
  const rows = Math.max(1, Math.round(bbox.h / targetCellSize));
  const cellW = bbox.w / cols;
  const cellH = bbox.h / rows;

  const out: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const b: Bounds = {
        x: bbox.x + c * cellW,
        y: bbox.y + r * cellH,
        w: cellW,
        h: cellH,
      };
      subdivide(b, out, poly, minCellSize);
    }
  }
  return out;
}

function subdivide(b: Bounds, out: Cell[], poly: Point[], minCellSize: number) {
  const status = classify(b, poly);
  if (status === 'outside') return;
  if (status === 'inside') {
    out.push({ ...b });
    return;
  }
  // Partial. If we can't subdivide further, drop the cell — it crosses
  // the shape boundary and we don't want to render outside-the-shape pixels.
  const halfW = b.w / 2;
  const halfH = b.h / 2;
  if (halfW < minCellSize || halfH < minCellSize) return;
  for (let qy = 0; qy < 2; qy++) {
    for (let qx = 0; qx < 2; qx++) {
      subdivide(
        {
          x: b.x + qx * halfW,
          y: b.y + qy * halfH,
          w: halfW,
          h: halfH,
        },
        out,
        poly,
        minCellSize
      );
    }
  }
}

/**
 * A cell is fully INSIDE the polygon iff no polygon segment crosses its boundary
 * AND its center is inside. If any segment crosses, it's PARTIAL. Otherwise it's
 * either entirely INSIDE or entirely OUTSIDE — disambiguate via a point-in-polygon
 * test on the center.
 */
function classify(b: Bounds, poly: Point[]): 'inside' | 'outside' | 'partial' {
  const x0 = b.x;
  const y0 = b.y;
  const x1 = b.x + b.w;
  const y1 = b.y + b.h;

  // Cell corners as segments
  const cell: [Point, Point][] = [
    [{ x: x0, y: y0 }, { x: x1, y: y0 }],
    [{ x: x1, y: y0 }, { x: x1, y: y1 }],
    [{ x: x1, y: y1 }, { x: x0, y: y1 }],
    [{ x: x0, y: y1 }, { x: x0, y: y0 }],
  ];

  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p1 = poly[i];
    const p2 = poly[(i + 1) % n];
    // Fast bbox reject: both segment endpoints on the same side of the cell.
    if (p1.x < x0 && p2.x < x0) continue;
    if (p1.x > x1 && p2.x > x1) continue;
    if (p1.y < y0 && p2.y < y0) continue;
    if (p1.y > y1 && p2.y > y1) continue;
    // Either endpoint inside the cell ⇒ partial (segment starts/ends inside).
    if (p1.x >= x0 && p1.x <= x1 && p1.y >= y0 && p1.y <= y1) return 'partial';
    if (p2.x >= x0 && p2.x <= x1 && p2.y >= y0 && p2.y <= y1) return 'partial';
    // Otherwise test segment vs. each of the 4 cell edges.
    for (let e = 0; e < 4; e++) {
      if (segmentsIntersect(p1, p2, cell[e][0], cell[e][1])) return 'partial';
    }
  }

  // No polygon segment touches this cell — entirely inside or entirely outside.
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return pointInPolygon(cx, cy, poly) ? 'inside' : 'outside';
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = orient(c, d, a);
  const d2 = orient(c, d, b);
  const d3 = orient(a, b, c);
  const d4 = orient(a, b, d);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
      ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  // Collinear / endpoint touch cases — treat as no intersection (rare for our
  // sampled polylines; if it does happen we'd rather under- than over-mark
  // cells as partial).
  return false;
}

function orient(p: Point, q: Point, r: Point): number {
  return (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
}

/**
 * Find (targetCellSize, minCellSize) to produce roughly `targetCount` cells.
 * In auto mode the two parameters are coupled: mc = T / 3, so edge subdivisions
 * stay proportional to interior cell size. Refines iteratively from
 * sqrt(area / N).
 */
export function findAutoParamsForCount(
  poly: Point[],
  bbox: ViewBox,
  area: number,
  targetCount: number,
  minCellSizeFloor = 6,
  maxIterations = 8
): { targetCellSize: number; minCellSize: number } {
  if (targetCount <= 0) {
    const T = Math.max(40, Math.sqrt(area / 16));
    return { targetCellSize: T, minCellSize: Math.max(minCellSizeFloor, T / 3) };
  }
  // Aim slightly above the target so every photo fits even with edge-cell drops.
  const aimCount = Math.max(1, Math.ceil(targetCount * 1.15));
  let T = Math.max(minCellSizeFloor * 2, Math.sqrt(area / aimCount));
  let mc = Math.max(minCellSizeFloor, T / 3);
  let count = generateCells(poly, bbox, { targetCellSize: T, minCellSize: mc }).length;

  for (let i = 0; i < maxIterations; i++) {
    // Good enough: at least targetCount, not wildly more
    if (count >= targetCount && count <= aimCount * 1.4) break;
    const ratio = Math.sqrt(count / aimCount);
    const next = T * ratio;
    if (Math.abs(next - T) < 0.5) {
      T = next;
      mc = Math.max(minCellSizeFloor, T / 3);
      count = generateCells(poly, bbox, { targetCellSize: T, minCellSize: mc }).length;
      break;
    }
    T = Math.max(minCellSizeFloor * 1.5, Math.min(bbox.w, next));
    mc = Math.max(minCellSizeFloor, T / 3);
    count = generateCells(poly, bbox, { targetCellSize: T, minCellSize: mc }).length;
  }
  // Final safety: if still short of target, shrink T more aggressively
  for (let i = 0; i < 6 && count < targetCount; i++) {
    T = Math.max(minCellSizeFloor * 1.2, T * 0.85);
    mc = Math.max(minCellSizeFloor, T / 3);
    count = generateCells(poly, bbox, { targetCellSize: T, minCellSize: mc }).length;
  }
  return { targetCellSize: T, minCellSize: mc };
}

/**
 * Assign one photo (by index) per cell. Greedy farthest-point: process cells
 * in a deterministic shuffled order; for each cell, pick the photo whose
 * existing placements are farthest from this cell. Ties broken by lower
 * usage, so every photo is used at least once before any is reused.
 */
export function assignPhotosToCells(
  cells: Cell[],
  photoCount: number,
  seed = 0
): number[] {
  const M = cells.length;
  const N = photoCount;
  if (M === 0 || N === 0) return new Array(M).fill(-1);

  const maxPerPhoto = Math.ceil(M / N);
  const assignments = new Array<number>(M).fill(-1);
  const usage = new Array<number>(N).fill(0);
  const placed: Array<Array<{ x: number; y: number }>> = Array.from(
    { length: N },
    () => []
  );

  // Pre-compute cell centers
  const centers = cells.map((c) => ({ x: c.x + c.w / 2, y: c.y + c.h / 2 }));

  // Deterministic shuffled iteration order
  const order = shuffleSeeded(M, seed);

  for (const idx of order) {
    const cx = centers[idx].x;
    const cy = centers[idx].y;

    let bestPhoto = -1;
    let bestMinDistSq = -1;
    let bestUsage = Infinity;

    for (let p = 0; p < N; p++) {
      if (usage[p] >= maxPerPhoto) continue;

      let minDistSq = Infinity;
      const ps = placed[p];
      for (let k = 0; k < ps.length; k++) {
        const dx = cx - ps[k].x;
        const dy = cy - ps[k].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minDistSq) minDistSq = d2;
      }

      const better =
        minDistSq > bestMinDistSq ||
        (minDistSq === bestMinDistSq && usage[p] < bestUsage);
      if (better) {
        bestMinDistSq = minDistSq;
        bestUsage = usage[p];
        bestPhoto = p;
      }
    }

    if (bestPhoto === -1) bestPhoto = idx % N;
    assignments[idx] = bestPhoto;
    usage[bestPhoto]++;
    placed[bestPhoto].push({ x: cx, y: cy });
  }

  return assignments;
}

function shuffleSeeded(n: number, seed: number): number[] {
  const arr = new Array<number>(n);
  for (let i = 0; i < n; i++) arr[i] = i;
  let s = (seed | 0) || 1;
  for (let i = n - 1; i > 0; i--) {
    // LCG
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    const j = (s >>> 0) % (i + 1);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}
