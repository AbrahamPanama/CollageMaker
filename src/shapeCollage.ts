import type { Cell, Point, ViewBox } from './types';
import { pointInPolygon } from './shape';

type Bounds = { x: number; y: number; w: number; h: number };

const MIN_BOUNDARY_CELL_SIZE = 2;
const BOUNDARY_DETAIL_FACTOR = 0.25;
const BOUNDARY_COVERAGE_SAMPLES = 3;

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
  // Curved silhouettes need finer cells only where a tile crosses the path.
  // Two extra quadtree levels preserve the interior layout while preventing
  // broad plateaus at circle/heart extrema.
  const boundaryCellSize = Math.max(
    MIN_BOUNDARY_CELL_SIZE,
    minCellSize * BOUNDARY_DETAIL_FACTOR
  );

  const out: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const b: Bounds = {
        x: bbox.x + c * cellW,
        y: bbox.y + r * cellH,
        w: cellW,
        h: cellH,
      };
      subdivide(b, out, poly, boundaryCellSize);
    }
  }
  return out;
}

function subdivide(b: Bounds, out: Cell[], poly: Point[], boundaryCellSize: number) {
  const status = classify(b, poly);
  if (status === 'outside') return;
  if (status === 'inside') {
    out.push({ ...b });
    return;
  }
  // Partial. At the final boundary resolution, keep a cell when most of its
  // area belongs to the shape. This approximates the path from both sides;
  // always dropping partial cells erodes curved silhouettes inward.
  const halfW = b.w / 2;
  const halfH = b.h / 2;
  if (halfW < boundaryCellSize || halfH < boundaryCellSize) {
    if (hasMajorityCoverage(b, poly)) out.push({ ...b });
    return;
  }
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
        boundaryCellSize
      );
    }
  }
}

function hasMajorityCoverage(b: Bounds, poly: Point[]): boolean {
  const sampleCount = BOUNDARY_COVERAGE_SAMPLES * BOUNDARY_COVERAGE_SAMPLES;
  const required = Math.floor(sampleCount / 2) + 1;
  let inside = 0;

  for (let sy = 0; sy < BOUNDARY_COVERAGE_SAMPLES; sy++) {
    for (let sx = 0; sx < BOUNDARY_COVERAGE_SAMPLES; sx++) {
      const x = b.x + ((sx + 0.5) / BOUNDARY_COVERAGE_SAMPLES) * b.w;
      const y = b.y + ((sy + 0.5) / BOUNDARY_COVERAGE_SAMPLES) * b.h;
      if (pointInPolygon(x, y, poly)) inside++;
      if (inside >= required) return true;
    }
  }

  return false;
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
 * Assign one photo (by index) per cell. The largest cells are protected first:
 * every available photo is used once before repetition begins, so necessary
 * repeats are confined to the smallest possible cells. Repeated copies avoid
 * touching and maximize the distance to their nearest existing copy.
 */
export function assignPhotosToCells(
  cells: Cell[],
  photoCount: number,
  seed = 0
): number[] {
  const M = cells.length;
  const N = photoCount;
  if (M === 0 || N === 0) return new Array(M).fill(-1);

  const assignments = new Array<number>(M).fill(-1);
  const usage = new Array<number>(N).fill(0);
  const placed: number[][] = Array.from({ length: N }, () => []);

  const centers = cells.map((c) => ({ x: c.x + c.w / 2, y: c.y + c.h / 2 }));
  const rankedCells = rankCellsBySize(cells, seed ^ 0x51ed270b);

  const photoOrder = shuffleSeeded(N, seed ^ 0x2c1b3c6d);
  const photoTieRank = invertOrder(photoOrder);
  const baseQuota = Math.floor(M / N);
  const extraQuota = M % N;
  const quota = new Array<number>(N).fill(baseQuota);
  for (let rank = 0; rank < extraQuota; rank++) quota[photoOrder[rank]]++;

  const protectedCount = Math.min(M, N);
  for (let rank = 0; rank < protectedCount; rank++) {
    const idx = rankedCells[rank];
    const photo = photoOrder[rank];
    assignments[idx] = photo;
    usage[photo]++;
    placed[photo].push(idx);
  }

  for (let rank = protectedCount; rank < M; rank++) {
    const idx = rankedCells[rank];
    const cx = centers[idx].x;
    const cy = centers[idx].y;

    let bestPhoto = -1;
    let bestAdjacentCopies = Infinity;
    let bestQuotaOverflow = Infinity;
    let bestMinDistSq = -1;
    let bestUsage = Infinity;

    for (let p = 0; p < N; p++) {
      let minDistSq = Infinity;
      let adjacentCopies = 0;
      const placements = placed[p];
      for (let k = 0; k < placements.length; k++) {
        const placedIdx = placements[k];
        const dx = cx - centers[placedIdx].x;
        const dy = cy - centers[placedIdx].y;
        const d2 = dx * dx + dy * dy;
        if (d2 < minDistSq) minDistSq = d2;
        if (cellsTouch(cells[idx], cells[placedIdx])) adjacentCopies++;
      }
      const quotaOverflow = usage[p] >= quota[p] ? 1 : 0;

      const better =
        adjacentCopies < bestAdjacentCopies ||
        (adjacentCopies === bestAdjacentCopies &&
          quotaOverflow < bestQuotaOverflow) ||
        (adjacentCopies === bestAdjacentCopies &&
          quotaOverflow === bestQuotaOverflow &&
          minDistSq > bestMinDistSq) ||
        (adjacentCopies === bestAdjacentCopies &&
          quotaOverflow === bestQuotaOverflow &&
          minDistSq === bestMinDistSq &&
          usage[p] < bestUsage) ||
        (adjacentCopies === bestAdjacentCopies &&
          quotaOverflow === bestQuotaOverflow &&
          minDistSq === bestMinDistSq &&
          usage[p] === bestUsage &&
          (bestPhoto === -1 || photoTieRank[p] < photoTieRank[bestPhoto]));
      if (better) {
        bestAdjacentCopies = adjacentCopies;
        bestQuotaOverflow = quotaOverflow;
        bestMinDistSq = minDistSq;
        bestUsage = usage[p];
        bestPhoto = p;
      }
    }

    if (bestPhoto === -1) bestPhoto = idx % N;
    assignments[idx] = bestPhoto;
    usage[bestPhoto]++;
    placed[bestPhoto].push(idx);
  }

  rebalanceRepeatUsage(
    cells,
    centers,
    assignments,
    usage,
    placed,
    quota,
    rankedCells.slice(protectedCount)
  );

  return assignments;
}

function rebalanceRepeatUsage(
  cells: Cell[],
  centers: Array<{ x: number; y: number }>,
  assignments: number[],
  usage: number[],
  placed: number[][],
  quota: number[],
  repeatCells: number[]
): void {
  for (let target = 0; target < quota.length; target++) {
    while (usage[target] < quota[target]) {
      let bestIdx = -1;
      let bestDistance = -1;

      for (const idx of repeatCells) {
        const source = assignments[idx];
        if (source === target || usage[source] <= quota[source]) continue;

        let touchesTarget = false;
        let minDistance = Infinity;
        for (const placedIdx of placed[target]) {
          if (cellsTouch(cells[idx], cells[placedIdx])) {
            touchesTarget = true;
            break;
          }
          const dx = centers[idx].x - centers[placedIdx].x;
          const dy = centers[idx].y - centers[placedIdx].y;
          minDistance = Math.min(minDistance, dx * dx + dy * dy);
        }
        if (!touchesTarget && minDistance > bestDistance) {
          bestIdx = idx;
          bestDistance = minDistance;
        }
      }

      if (bestIdx === -1) break;
      const source = assignments[bestIdx];
      assignments[bestIdx] = target;
      usage[source]--;
      usage[target]++;
      placed[source].splice(placed[source].indexOf(bestIdx), 1);
      placed[target].push(bestIdx);
    }
  }
}

function rankCellsBySize(cells: Cell[], seed: number): number[] {
  const byArea = Array.from({ length: cells.length }, (_, index) => index).sort((a, b) => {
    const areaDelta = cells[b].w * cells[b].h - cells[a].w * cells[a].h;
    return Math.abs(areaDelta) > 1e-6 ? areaDelta : a - b;
  });
  const ranked: number[] = [];

  for (let start = 0; start < byArea.length;) {
    const area = cells[byArea[start]].w * cells[byArea[start]].h;
    let end = start + 1;
    while (end < byArea.length) {
      const nextArea = cells[byArea[end]].w * cells[byArea[end]].h;
      if (Math.abs(nextArea - area) > 1e-6) break;
      end++;
    }
    ranked.push(...spreadCellOrder(byArea.slice(start, end), cells, seed ^ start));
    start = end;
  }

  return ranked;
}

function spreadCellOrder(indices: number[], cells: Cell[], seed: number): number[] {
  if (indices.length <= 1) return indices;

  const shuffledPositions = shuffleSeeded(indices.length, seed);
  const shuffled = shuffledPositions.map((position) => indices[position]);
  const tieRank = new Map<number, number>(shuffled.map((index, rank) => [index, rank]));
  const selected = [shuffled[0]];
  const firstCenter = cellCenter(cells[shuffled[0]]);
  const nearestDistance = new Map<number, number>();
  for (const candidate of shuffled.slice(1)) {
    const center = cellCenter(cells[candidate]);
    const dx = center.x - firstCenter.x;
    const dy = center.y - firstCenter.y;
    nearestDistance.set(candidate, dx * dx + dy * dy);
  }

  while (nearestDistance.size > 0) {
    let best = -1;
    let bestDistance = -1;
    for (const [candidate, distance] of nearestDistance) {
      if (
        distance > bestDistance ||
        (distance === bestDistance &&
          (best === -1 || tieRank.get(candidate)! < tieRank.get(best)!))
      ) {
        best = candidate;
        bestDistance = distance;
      }
    }
    selected.push(best);
    nearestDistance.delete(best);

    const bestCenter = cellCenter(cells[best]);
    for (const [candidate, distance] of nearestDistance) {
      const center = cellCenter(cells[candidate]);
      const dx = center.x - bestCenter.x;
      const dy = center.y - bestCenter.y;
      nearestDistance.set(candidate, Math.min(distance, dx * dx + dy * dy));
    }
  }

  return selected;
}

function cellCenter(cell: Cell): { x: number; y: number } {
  return { x: cell.x + cell.w / 2, y: cell.y + cell.h / 2 };
}

function invertOrder(order: number[]): number[] {
  const rank = new Array<number>(order.length);
  for (let i = 0; i < order.length; i++) rank[order[i]] = i;
  return rank;
}

function cellsTouch(a: Cell, b: Cell): boolean {
  const epsilon = 1e-6;
  const gapX = Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w), 0);
  const gapY = Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h), 0);
  return gapX <= epsilon && gapY <= epsilon;
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
