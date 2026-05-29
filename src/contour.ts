import * as ClipperModule from 'clipper-lib';
import type { Path as ClipperPath, Paths as ClipperPaths } from 'clipper-lib';
import type { Cell, Point, ViewBox } from './types';

const ClipperLib =
  (ClipperModule as { default?: typeof ClipperModule }).default ?? ClipperModule;

const SCALE = 1000;
const POINT_EPSILON = 0.001;
const CLEAN_DISTANCE_PX = 0.05;
const ARC_TOLERANCE_PX = 0.25;
const MIN_LOOP_AREA_PX = 0.5;

export type ContourResult = {
  loops: Point[][];
  bbox: ViewBox;
  path: string;
};

export function computeCellContour(
  cells: Cell[],
  offsetPx: number = 0
): ContourResult {
  const cellPaths = cellsToClipperPaths(cells);
  if (cellPaths.length === 0) return emptyContour();

  let paths = unionClipperPaths(cellPaths);
  if (paths.length === 0) return emptyContour();

  if (Math.abs(offsetPx) >= POINT_EPSILON) {
    const offsetter = new ClipperLib.ClipperOffset(2, ARC_TOLERANCE_PX * SCALE);
    offsetter.AddPaths(
      paths,
      ClipperLib.JoinType.jtMiter,
      ClipperLib.EndType.etClosedPolygon
    );

    const offsetPaths: ClipperPaths = [];
    offsetter.Execute(offsetPaths, offsetPx * SCALE);
    paths = cleanClipperPaths(offsetPaths);
  }

  return contourFromClipperPaths(paths);
}

export function computeShapeContour(
  points: Point[],
  offsetPx: number = 0
): ContourResult {
  const sourceLoop = normalizeLoop(points);
  if (sourceLoop.length < 3) return emptyContour();

  if (Math.abs(offsetPx) < POINT_EPSILON) {
    const loops = [sourceLoop];
    return {
      loops,
      bbox: bboxFromLoops(loops),
      path: contourLoopsToSvgPath(loops),
    };
  }

  const clipperPath = toClipperPath(sourceLoop);
  const cleaned = ClipperLib.Clipper.CleanPolygon(
    clipperPath,
    CLEAN_DISTANCE_PX * SCALE
  );
  if (cleaned.length < 3) return emptyContour();

  const subject = prepareClipperPaths([cleaned]);
  if (subject.length === 0) return emptyContour();

  const offsetter = new ClipperLib.ClipperOffset(
    2,
    ARC_TOLERANCE_PX * SCALE
  );
  offsetter.AddPaths(
    subject,
    ClipperLib.JoinType.jtRound,
    ClipperLib.EndType.etClosedPolygon
  );

  const solution: ClipperPaths = [];
  offsetter.Execute(solution, offsetPx * SCALE);

  return contourFromClipperPaths(solution);
}

export function contourLoopsToSvgPath(
  loops: Point[][],
  scaleX: number = 1,
  scaleY: number = scaleX,
  precision: number = 2
): string {
  if (loops.length === 0) return '';

  return loops
    .map((loop) => {
      const normalized = normalizeLoop(loop);
      if (normalized.length < 3) return '';

      const [head, ...tail] = normalized;
      const move = `M${formatNumber(head.x * scaleX, precision)} ${formatNumber(
        head.y * scaleY,
        precision
      )}`;
      const lines = tail
        .map(
          (point) =>
            `L${formatNumber(point.x * scaleX, precision)} ${formatNumber(
              point.y * scaleY,
              precision
            )}`
        )
        .join('');

      return `${move}${lines}Z`;
    })
    .filter(Boolean)
    .join(' ');
}

function prepareClipperPaths(paths: ClipperPaths): ClipperPaths {
  const simplified = ClipperLib.Clipper.SimplifyPolygons(
    paths,
    ClipperLib.PolyFillType.pftNonZero
  );

  return simplified
    .map((path) =>
      ClipperLib.Clipper.CleanPolygon(path, CLEAN_DISTANCE_PX * SCALE)
    )
    .filter((path) => path.length >= 3)
    .map((path) => {
      const oriented = path.slice();
      if (!ClipperLib.Clipper.Orientation(oriented)) oriented.reverse();
      return oriented;
    });
}

function cellsToClipperPaths(cells: Cell[]): ClipperPaths {
  return cells
    .filter((cell) => cell.w > POINT_EPSILON && cell.h > POINT_EPSILON)
    .map((cell) => {
      const x0 = cell.x;
      const y0 = cell.y;
      const x1 = cell.x + cell.w;
      const y1 = cell.y + cell.h;
      return toClipperPath([
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ]);
    });
}

function unionClipperPaths(paths: ClipperPaths): ClipperPaths {
  const clipper = new ClipperLib.Clipper();
  clipper.StrictlySimple = true;
  clipper.AddPaths(paths, ClipperLib.PolyType.ptSubject, true);

  const solution: ClipperPaths = [];
  clipper.Execute(
    ClipperLib.ClipType.ctUnion,
    solution,
    ClipperLib.PolyFillType.pftNonZero,
    ClipperLib.PolyFillType.pftNonZero
  );

  return cleanClipperPaths(solution);
}

function cleanClipperPaths(paths: ClipperPaths): ClipperPaths {
  return ClipperLib.Clipper.CleanPolygons(paths, CLEAN_DISTANCE_PX * SCALE).filter(
    (path) =>
      path.length >= 3 &&
      Math.abs(ClipperLib.Clipper.Area(path)) >= MIN_LOOP_AREA_PX * SCALE * SCALE
  );
}

function contourFromClipperPaths(paths: ClipperPaths): ContourResult {
  const loops = paths
    .map(fromClipperPath)
    .map(normalizeLoop)
    .map(simplifyCollinear)
    .filter(
      (loop) =>
        loop.length >= 3 && Math.abs(signedArea(loop)) >= MIN_LOOP_AREA_PX
    )
    .sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));

  return {
    loops,
    bbox: bboxFromLoops(loops),
    path: contourLoopsToSvgPath(loops),
  };
}

function normalizeLoop(points: Point[]): Point[] {
  const loop: Point[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue;
    const prev = loop[loop.length - 1];
    if (prev && pointsNearlyEqual(prev, point)) continue;
    loop.push({ x: point.x, y: point.y });
  }

  if (loop.length > 1 && pointsNearlyEqual(loop[0], loop[loop.length - 1])) {
    loop.pop();
  }

  return loop;
}

function simplifyCollinear(points: Point[]): Point[] {
  if (points.length < 4) return points;

  const simplified: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    const prev = points[(i - 1 + points.length) % points.length];
    const curr = points[i];
    const next = points[(i + 1) % points.length];

    const abx = curr.x - prev.x;
    const aby = curr.y - prev.y;
    const bcx = next.x - curr.x;
    const bcy = next.y - curr.y;
    const cross = abx * bcy - aby * bcx;
    const scale = Math.hypot(abx, aby) + Math.hypot(bcx, bcy);

    if (Math.abs(cross) <= POINT_EPSILON * Math.max(1, scale)) continue;
    simplified.push(curr);
  }

  return simplified.length >= 3 ? simplified : points;
}

function toClipperPath(points: Point[]): ClipperPath {
  return points.map((point) => ({
    X: Math.round(point.x * SCALE),
    Y: Math.round(point.y * SCALE),
  }));
}

function fromClipperPath(path: ClipperPath): Point[] {
  return path.map((point) => ({ x: point.X / SCALE, y: point.Y / SCALE }));
}

function bboxFromLoops(loops: Point[][]): ViewBox {
  if (loops.length === 0) return { x: 0, y: 0, w: 0, h: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const loop of loops) {
    for (const point of loop) {
      if (point.x < minX) minX = point.x;
      if (point.y < minY) minY = point.y;
      if (point.x > maxX) maxX = point.x;
      if (point.y > maxY) maxY = point.y;
    }
  }

  if (!Number.isFinite(minX)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

function signedArea(loop: Point[]): number {
  let area = 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i];
    const b = loop[(i + 1) % loop.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

function pointsNearlyEqual(a: Point, b: Point): boolean {
  return (
    Math.abs(a.x - b.x) <= POINT_EPSILON &&
    Math.abs(a.y - b.y) <= POINT_EPSILON
  );
}

function formatNumber(value: number, precision: number): string {
  const rounded = Number(value.toFixed(precision));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function emptyContour(): ContourResult {
  return { loops: [], bbox: { x: 0, y: 0, w: 0, h: 0 }, path: '' };
}
