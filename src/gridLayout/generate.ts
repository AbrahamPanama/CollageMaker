import { mulberry32, randomInt, shuffle } from './rng';
import { scoreLayout } from './scoring';
import { clampHeroSize, getHeroShape, makeHeroOverlayRect } from './heroShapes';
import type { GenOptions, GridCell, HeroOverlay, LayoutFamily, LayoutTree, PhotoMeta, Rect, ScoredLayout } from './types';
import { clampAspect, layoutTree, makeSplit, treeSignature } from './tree';

const DEFAULT_TOP_K = 8;

export function generateLayouts(
  metas: PhotoMeta[],
  targetAspect: number,
  options: GenOptions = {},
  seed = 1
): ScoredLayout[] {
  if ((options.family ?? 'mosaic') === 'heroCenter') {
    return generateHeroCenterLayouts(metas, targetAspect, options, seed);
  }
  return generateMosaicLayouts(metas, targetAspect, options, seed, 'mosaic');
}

function generateMosaicLayouts(
  metas: PhotoMeta[],
  targetAspect: number,
  options: GenOptions,
  seed: number,
  family: LayoutFamily,
  heroOverlay?: HeroOverlay
): ScoredLayout[] {
  const topK = options.topK ?? DEFAULT_TOP_K;
  if (metas.length === 0) return [];
  if (metas.length === 1) {
    const tree: LayoutTree = { type: 'leaf', photoId: metas[0].id, aspect: clampAspect(metas[0].aspect) };
    return [buildScoredLayout(tree, metas, targetAspect, options, 0, String(0), family, heroOverlay)];
  }

  const next = mulberry32(seed);
  const budget = candidateBudget(metas.length);
  const bySignature = new Map<string, ScoredLayout>();

  for (let index = 0; index < budget; index++) {
    const order = seedOrder(metas, next, index);
    const tree = buildRandomTree(order, next, 0);
    addCandidate(bySignature, buildScoredLayout(tree, metas, targetAspect, options, index, String(index), family, heroOverlay));

    if (metas.length === 2) {
      addCandidate(
        bySignature,
        buildScoredLayout(
          makeSplit(index % 2 === 0 ? 'H' : 'V', leaf(order[0]), leaf(order[1])),
          metas,
          targetAspect,
          options,
          index + budget,
          String(index + budget),
          family,
          heroOverlay
        )
      );
    }
  }

  return Array.from(bySignature.values()).sort((a, b) => a.score - b.score).slice(0, topK);
}

export function layoutFromTree(
  tree: LayoutTree | null,
  metas: PhotoMeta[],
  targetAspect: number,
  options: GenOptions = {},
  idSuffix = 'selected'
): ScoredLayout | null {
  if (!tree) return null;
  const family = options.family ?? 'mosaic';
  const heroOverlay = family === 'heroCenter' ? makeHeroOverlay(metas, targetAspect, options) : undefined;
  return buildScoredLayout(tree, metas, targetAspect, options, 0, idSuffix, family, heroOverlay);
}

function buildScoredLayout(
  tree: LayoutTree,
  metas: PhotoMeta[],
  targetAspect: number,
  options: GenOptions,
  index: number,
  idSuffix = String(index),
  family: LayoutFamily,
  heroOverlay?: HeroOverlay
): ScoredLayout {
  const cells = layoutTree(tree);
  const score = scoreLayout(cells, metas, {
    minCellFraction: options.minCellFraction,
    weights: options.weights,
    heroPhotoId: options.heroPhotoId,
    targetAspect,
  });
  const occlusionPenalty = heroOverlay ? scoreHeroOcclusion(cells, metas, heroOverlay) : 0;
  return {
    id: `${hashTree(tree)}-${idSuffix}`,
    family,
    tree,
    cells,
    heroOverlay,
    score: score.total + occlusionPenalty,
    breakdown: {
      ...score.breakdown,
      subjectSafety: score.breakdown.subjectSafety + occlusionPenalty,
    },
  };
}

function generateHeroCenterLayouts(
  metas: PhotoMeta[],
  targetAspect: number,
  options: GenOptions,
  seed: number
): ScoredLayout[] {
  if (metas.length === 0) return [];
  const heroOverlay = makeHeroOverlay(metas, targetAspect, options);
  const baseMetas = metas.filter((meta) => meta.id !== heroOverlay.photoId);
  if (baseMetas.length === 0) {
    return [
      {
        id: `layout-hero-only-${heroOverlay.photoId}-${heroOverlay.shapeId}-${Math.round(heroOverlay.sizeFraction * 1000)}`,
        family: 'heroCenter',
        tree: null,
        cells: [],
        heroOverlay,
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
      },
    ];
  }

  const mosaicOptions: GenOptions = {
    ...options,
    family: 'mosaic',
    heroPhotoId: null,
    hero: undefined,
  };
  return generateMosaicLayouts(baseMetas, targetAspect, mosaicOptions, seed, 'heroCenter', heroOverlay).map((layout) => ({
    ...layout,
    id: `${layout.id}-hero-${heroOverlay.photoId}-${heroOverlay.shapeId}-${Math.round(heroOverlay.sizeFraction * 1000)}`,
    family: 'heroCenter',
    heroOverlay,
  }));
}

function makeHeroOverlay(metas: PhotoMeta[], targetAspect: number, options: GenOptions): HeroOverlay {
  const preferredHero = options.hero?.photoId ?? options.heroPhotoId ?? null;
  const meta = metas.find((candidate) => candidate.id === preferredHero) ?? pickAutoHero(metas);
  const shape = getHeroShape(options.hero?.shapeId);
  const sizeFraction = clampHeroSize(options.hero?.sizeFraction ?? 0.42);
  return {
    photoId: meta.id,
    shapeId: shape.id,
    rect: makeHeroOverlayRect(targetAspect, sizeFraction),
    sizeFraction,
  };
}

function pickAutoHero(metas: PhotoMeta[]) {
  return metas
    .slice()
    .sort((a, b) => {
      const faceDelta = Number(b.subject?.source === 'face') - Number(a.subject?.source === 'face');
      if (faceDelta !== 0) return faceDelta;
      return subjectArea(b) - subjectArea(a);
    })[0];
}

function subjectArea(meta: PhotoMeta) {
  return meta.subject ? meta.subject.w * meta.subject.h : 0;
}

function scoreHeroOcclusion(cells: GridCell[], metas: PhotoMeta[], heroOverlay: HeroOverlay) {
  const metaById = new Map(metas.map((meta) => [meta.id, meta]));
  return cells.reduce((penalty, cell) => {
    const subject = metaById.get(cell.photoId)?.subject;
    if (!subject) return penalty;
    const subjectRect: Rect = {
      x: cell.rect.x + subject.x * cell.rect.w,
      y: cell.rect.y + subject.y * cell.rect.h,
      w: subject.w * cell.rect.w,
      h: subject.h * cell.rect.h,
    };
    const ratio = intersectionArea(subjectRect, heroOverlay.rect) / Math.max(0.0001, subjectRect.w * subjectRect.h);
    return penalty + ratio * 8;
  }, 0);
}

function addCandidate(map: Map<string, ScoredLayout>, layout: ScoredLayout) {
  const signature = rectSignature(layout);
  const existing = map.get(signature);
  if (!existing || layout.score < existing.score) map.set(signature, layout);
}

function buildRandomTree(metas: PhotoMeta[], next: () => number, depth: number): LayoutTree {
  if (metas.length === 1) return leaf(metas[0]);

  const direction = chooseDirection(metas, next, depth);
  const split = chooseSplit(metas.length, next);
  const left = metas.slice(0, split);
  const right = metas.slice(split);
  return makeSplit(direction, buildRandomTree(left, next, depth + 1), buildRandomTree(right, next, depth + 1));
}

function seedOrder(metas: PhotoMeta[], next: () => number, index: number) {
  const sorted = metas.slice().sort((a, b) => {
    const heroDelta = Number(Boolean(b.heroPinned)) - Number(Boolean(a.heroPinned));
    if (heroDelta !== 0 && index % 4 === 0) return heroDelta;
    return clampAspect(b.aspect) - clampAspect(a.aspect);
  });
  return index % 3 === 0 ? shuffle(sorted, next) : shuffle(metas, next);
}

function chooseDirection(metas: PhotoMeta[], next: () => number, depth: number) {
  const wideCount = metas.filter((meta) => clampAspect(meta.aspect) >= 1).length;
  const biasHorizontal = wideCount >= metas.length / 2;
  const roll = next();
  if (depth === 0 && metas.length > 2) return biasHorizontal ? 'H' : 'V';
  return roll < (biasHorizontal ? 0.58 : 0.42) ? 'H' : 'V';
}

function chooseSplit(length: number, next: () => number) {
  if (length <= 2) return 1;
  const center = Math.floor(length / 2);
  const spread = Math.max(1, Math.floor(length / 3));
  const offset = randomInt(next, spread * 2 + 1) - spread;
  return Math.max(1, Math.min(length - 1, center + offset));
}

function leaf(meta: PhotoMeta): LayoutTree {
  return { type: 'leaf', photoId: meta.id, aspect: clampAspect(meta.aspect) };
}

function candidateBudget(n: number) {
  if (n <= 2) return 8;
  if (n <= 8) return 240;
  if (n <= 16) return 320;
  return 420;
}

function rectSignature(layout: ScoredLayout) {
  const cells = layout.cells
    .map((cell) => `${round(cell.rect.x)},${round(cell.rect.y)},${round(cell.rect.w)},${round(cell.rect.h)}`)
    .sort()
    .join('|');
  const hero = layout.heroOverlay
    ? `hero:${layout.heroOverlay.photoId}:${layout.heroOverlay.shapeId}:${round(layout.heroOverlay.rect.x)},${round(layout.heroOverlay.rect.y)},${round(layout.heroOverlay.rect.w)},${round(layout.heroOverlay.rect.h)}`
    : 'hero:none';
  return `${layout.family}|${cells}|${hero}`;
}

function hashTree(tree: LayoutTree) {
  let hash = 0;
  const text = treeSignature(tree);
  for (let index = 0; index < text.length; index++) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return `layout-${Math.abs(hash).toString(36)}`;
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

function intersectionArea(a: Rect, b: Rect) {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}
