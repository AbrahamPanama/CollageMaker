import { mulberry32, randomInt, shuffle } from './rng';
import { scoreLayout } from './scoring';
import type { GenOptions, LayoutTree, PhotoMeta, ScoredLayout } from './types';
import { clampAspect, layoutTree, makeSplit, treeSignature } from './tree';

const DEFAULT_TOP_K = 8;

export function generateLayouts(
  metas: PhotoMeta[],
  targetAspect: number,
  options: GenOptions = {},
  seed = 1
): ScoredLayout[] {
  const topK = options.topK ?? DEFAULT_TOP_K;
  if (metas.length === 0) return [];
  if (metas.length === 1) {
    const tree: LayoutTree = { type: 'leaf', photoId: metas[0].id, aspect: clampAspect(metas[0].aspect) };
    return [buildScoredLayout(tree, metas, targetAspect, options, 0)];
  }

  const next = mulberry32(seed);
  const budget = candidateBudget(metas.length);
  const bySignature = new Map<string, ScoredLayout>();

  for (let index = 0; index < budget; index++) {
    const order = seedOrder(metas, next, index);
    const tree = buildRandomTree(order, next, 0);
    addCandidate(bySignature, buildScoredLayout(tree, metas, targetAspect, options, index));

    if (metas.length === 2) {
      addCandidate(
        bySignature,
        buildScoredLayout(
          makeSplit(index % 2 === 0 ? 'H' : 'V', leaf(order[0]), leaf(order[1])),
          metas,
          targetAspect,
          options,
          index + budget
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
  return buildScoredLayout(tree, metas, targetAspect, options, 0, idSuffix);
}

function buildScoredLayout(
  tree: LayoutTree,
  metas: PhotoMeta[],
  targetAspect: number,
  options: GenOptions,
  index: number,
  idSuffix = String(index)
): ScoredLayout {
  const cells = layoutTree(tree);
  const score = scoreLayout(cells, metas, {
    minCellFraction: options.minCellFraction,
    weights: options.weights,
    heroPhotoId: options.heroPhotoId,
    targetAspect,
  });
  return {
    id: `${hashTree(tree)}-${idSuffix}`,
    tree,
    cells,
    score: score.total,
    breakdown: score.breakdown,
  };
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
  return layout.cells
    .map((cell) => `${round(cell.rect.x)},${round(cell.rect.y)},${round(cell.rect.w)},${round(cell.rect.h)}`)
    .sort()
    .join('|');
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
