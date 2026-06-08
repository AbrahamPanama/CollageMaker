import { computeShapeContour, contourLoopsToSvgPath } from '../contour';
import type { Point } from '../types';

export const FLIPBOOK_BLADE_VIEWBOX = {
  x: -1853.287598,
  y: 12.724396,
  w: 88.575073,
  h: 42.551208,
};

export const FLIPBOOK_BLADE_PATH_TRANSFORM = 'matrix(-1,0,0,1,-1491.210815,12.724701)';

export const FLIPBOOK_BLADE_PATH_D =
  'M362.076721,41.550903C362.076721,42.10321,361.629028,42.550903,361.076721,42.550903L274.501678,42.550903C273.949432,42.550903,273.501709,42.10321,273.501709,41.550903L273.501709,39.550903C273.501709,38.998596,273.949432,38.550903,274.501678,38.550903L280.284851,38.550903C280.837128,38.550903,281.284851,38.10321,281.284851,37.550903L281.284851,0.999695C281.284851,0.447388,281.732574,-0.000305,282.284851,-0.000305L353.293579,-0.000305C353.845856,-0.000305,354.293579,0.447388,354.293579,0.999695L354.293579,37.550903C354.293579,38.10321,354.741272,38.550903,355.293549,38.550903L361.076721,38.550903C361.629028,38.550903,362.076721,38.998596,362.076721,39.550903L362.076721,41.550903z';

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
  const matrix = parseSvgMatrix(FLIPBOOK_BLADE_PATH_TRANSFORM);
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

function parseSvgMatrix(transform: string) {
  const values = transform.match(/matrix\(([^)]+)\)/)?.[1].split(/[\s,]+/).map(Number) ?? [];
  if (values.length !== 6 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('Invalid blade path transform');
  }
  return {
    a: values[0],
    b: values[1],
    c: values[2],
    d: values[3],
    e: values[4],
    f: values[5],
  };
}

function isCommand(token: string) {
  return /^[a-zA-Z]$/.test(token);
}

function normalizeBleed(bleedMm: number) {
  if (!Number.isFinite(bleedMm) || bleedMm <= 0) return 0;
  return Math.round(bleedMm * BLEED_CACHE_PRECISION) / BLEED_CACHE_PRECISION;
}
