import { computeShapeContour, contourLoopsToSvgPath } from '../contour';
import type { Point } from '../types';

export const FLIPBOOK_BLADE_VIEWBOX = {
  x: -385.252502,
  y: 14.359406,
  w: 83.495026,
  h: 41.281189,
};

export const FLIPBOOK_BLADE_PATH_TRANSFORM = 'translate(-99.529877,301.913025)';

export const FLIPBOOK_BLADE_PATH_D =
  'M-202.2276,-247.27243C-202.2276,-246.720123,-202.675293,-246.27243,-203.227615,-246.27243L-284.722656,-246.27243C-285.274902,-246.27243,-285.722626,-246.720123,-285.722626,-247.27243L-285.722626,-248.002411C-285.722626,-248.554733,-285.274902,-249.002411,-284.722656,-249.002411L-281.479462,-249.002411C-280.927185,-249.002411,-280.479492,-249.450104,-280.479492,-250.002426L-280.479492,-286.553619C-280.479492,-287.105927,-280.031738,-287.553619,-279.479462,-287.553619L-208.470734,-287.553619C-207.918472,-287.553619,-207.470734,-287.105927,-207.470734,-286.553619L-207.470734,-250.002426C-207.470734,-249.450104,-207.023041,-249.002411,-206.470779,-249.002411L-203.227615,-249.002411C-202.675293,-249.002411,-202.2276,-248.554733,-202.2276,-248.002411L-202.2276,-247.27243z';

export const FLIPBOOK_BLADE_LABEL = {
  leftX: 2.25,
  rightX: FLIPBOOK_BLADE_VIEWBOX.w - 2.25,
  y: FLIPBOOK_BLADE_VIEWBOX.h - 1.36,
  fontSizeMm: 1.4,
  previewFontSizeMm: 1.65,
  strokeMm: 0.2,
  previewStrokeMm: 0.25,
};

export const FLIPBOOK_FRAME_ASPECT = FLIPBOOK_BLADE_VIEWBOX.w / (FLIPBOOK_BLADE_VIEWBOX.h * 2);

export type FlipbookBladePathCommand =
  | { type: 'M' | 'L'; points: [number, number] }
  | { type: 'C'; points: [number, number, number, number, number, number] }
  | { type: 'Z'; points: [] };

const CURVE_FLATTEN_STEPS = 10;
const BLEED_CACHE_PRECISION = 1000;
const POINT_EPSILON = 0.001;

export const FLIPBOOK_BLADE_LOCAL_COMMANDS = parseBladePathCommands();
export const FLIPBOOK_BLADE_LOCAL_POINTS = flattenBladePathCommands(
  FLIPBOOK_BLADE_LOCAL_COMMANDS,
  CURVE_FLATTEN_STEPS
);

const bleedLoopCache = new Map<number, Point[][]>();
const bleedPathCache = new Map<number, string>();

export function getFlipbookBladeBleedLoops(bleedMm: number): Point[][] {
  const bleed = normalizeBleed(bleedMm);
  const cached = bleedLoopCache.get(bleed);
  if (cached) return cached;

  const loops =
    bleed <= POINT_EPSILON
      ? [FLIPBOOK_BLADE_LOCAL_POINTS]
      : computeShapeContour(FLIPBOOK_BLADE_LOCAL_POINTS, bleed).loops;
  const fallbackLoops = loops.length > 0 ? loops : [FLIPBOOK_BLADE_LOCAL_POINTS];
  bleedLoopCache.set(bleed, fallbackLoops);
  return fallbackLoops;
}

export function getFlipbookBladeBleedSvgPath(bleedMm: number): string {
  const bleed = normalizeBleed(bleedMm);
  const cached = bleedPathCache.get(bleed);
  if (cached) return cached;

  const path = contourLoopsToSvgPath(getFlipbookBladeBleedLoops(bleed), 1, 1, 3);
  bleedPathCache.set(bleed, path);
  return path;
}

function parseBladePathCommands(): FlipbookBladePathCommand[] {
  const tokens = FLIPBOOK_BLADE_PATH_D.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? [];
  const matrix = parseSvgTransform(FLIPBOOK_BLADE_PATH_TRANSFORM);
  const commands: FlipbookBladePathCommand[] = [];
  let i = 0;
  let command = '';
  let firstMove = true;

  while (i < tokens.length) {
    if (isCommand(tokens[i])) {
      command = tokens[i++];
    }
    const upper = command.toUpperCase();
    if (upper === 'Z') {
      commands.push({ type: 'Z', points: [] });
      firstMove = true;
      command = '';
      continue;
    }
    if (upper === 'M' || upper === 'L') {
      while (i + 1 < tokens.length && !isCommand(tokens[i])) {
        const point = toBladeLocal(Number(tokens[i++]), Number(tokens[i++]), matrix);
        commands.push({ type: firstMove && upper === 'M' ? 'M' : 'L', points: [point.x, point.y] });
        firstMove = false;
      }
      continue;
    }
    if (upper === 'C') {
      while (i + 5 < tokens.length && !isCommand(tokens[i])) {
        const p1 = toBladeLocal(Number(tokens[i++]), Number(tokens[i++]), matrix);
        const p2 = toBladeLocal(Number(tokens[i++]), Number(tokens[i++]), matrix);
        const p3 = toBladeLocal(Number(tokens[i++]), Number(tokens[i++]), matrix);
        commands.push({ type: 'C', points: [p1.x, p1.y, p2.x, p2.y, p3.x, p3.y] });
      }
      continue;
    }
    throw new Error(`Unsupported blade path command: ${command}`);
  }

  return commands;
}

function flattenBladePathCommands(commands: FlipbookBladePathCommand[], curveSteps: number): Point[] {
  const points: Point[] = [];
  let current: Point = { x: 0, y: 0 };
  let start: Point | null = null;

  for (const command of commands) {
    if (command.type === 'M') {
      current = { x: command.points[0], y: command.points[1] };
      start = current;
      pushPoint(points, current);
    } else if (command.type === 'L') {
      current = { x: command.points[0], y: command.points[1] };
      pushPoint(points, current);
    } else if (command.type === 'C') {
      const p0 = current;
      const p1 = { x: command.points[0], y: command.points[1] };
      const p2 = { x: command.points[2], y: command.points[3] };
      const p3 = { x: command.points[4], y: command.points[5] };
      for (let step = 1; step <= curveSteps; step++) {
        pushPoint(points, cubicPoint(p0, p1, p2, p3, step / curveSteps));
      }
      current = p3;
    } else if (start) {
      current = start;
    }
  }

  if (points.length > 1 && pointsNearlyEqual(points[0], points[points.length - 1])) {
    points.pop();
  }

  return points;
}

function cubicPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
  const mt = 1 - t;
  const a = mt * mt * mt;
  const b = 3 * mt * mt * t;
  const c = 3 * mt * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: a * p0.y + b * p1.y + c * p2.y + d * p3.y,
  };
}

function pushPoint(points: Point[], point: Point) {
  const prev = points[points.length - 1];
  if (!prev || !pointsNearlyEqual(prev, point)) points.push(point);
}

function pointsNearlyEqual(a: Point, b: Point) {
  return Math.abs(a.x - b.x) <= POINT_EPSILON && Math.abs(a.y - b.y) <= POINT_EPSILON;
}

function toBladeLocal(
  x: number,
  y: number,
  matrix: { a: number; b: number; c: number; d: number; e: number; f: number }
) {
  const worldX = matrix.a * x + matrix.c * y + matrix.e;
  const worldY = matrix.b * x + matrix.d * y + matrix.f;
  return {
    x: worldX - FLIPBOOK_BLADE_VIEWBOX.x,
    y: worldY - FLIPBOOK_BLADE_VIEWBOX.y,
  };
}

function parseSvgTransform(transform: string) {
  const matrixValues = transform.match(/matrix\(([^)]+)\)/)?.[1].split(/[\s,]+/).map(Number) ?? [];
  if (matrixValues.length === 6 && matrixValues.every((value) => Number.isFinite(value))) {
    return {
      a: matrixValues[0],
      b: matrixValues[1],
      c: matrixValues[2],
      d: matrixValues[3],
      e: matrixValues[4],
      f: matrixValues[5],
    };
  }

  const translateValues =
    transform.match(/translate\(([^)]+)\)/)?.[1].split(/[\s,]+/).filter(Boolean).map(Number) ?? [];
  if (
    (translateValues.length === 1 || translateValues.length === 2) &&
    translateValues.every((value) => Number.isFinite(value))
  ) {
    return {
      a: 1,
      b: 0,
      c: 0,
      d: 1,
      e: translateValues[0],
      f: translateValues[1] ?? 0,
    };
  }

  throw new Error('Invalid blade path transform');
}

function isCommand(token: string) {
  return /^[a-zA-Z]$/.test(token);
}

function normalizeBleed(bleedMm: number) {
  if (!Number.isFinite(bleedMm) || bleedMm <= 0) return 0;
  return Math.round(bleedMm * BLEED_CACHE_PRECISION) / BLEED_CACHE_PRECISION;
}
