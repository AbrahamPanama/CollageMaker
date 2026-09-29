import type { GridCell, LayoutTree, Rect, SplitDirection } from './types';

export const MIN_PHOTO_ASPECT = 1 / 3;
export const MAX_PHOTO_ASPECT = 3;

export function clampAspect(aspect: number) {
  if (!Number.isFinite(aspect) || aspect <= 0) return 1;
  return Math.max(MIN_PHOTO_ASPECT, Math.min(MAX_PHOTO_ASPECT, aspect));
}

export function naturalAspect(tree: LayoutTree | null): number {
  if (!tree) return 1;
  if (tree.type === 'leaf') return clampAspect(tree.aspect);
  const left = naturalAspect(tree.left);
  const right = naturalAspect(tree.right);
  if (tree.direction === 'H') return left + right;
  return 1 / (1 / left + 1 / right);
}

export function layoutTree(tree: LayoutTree | null, root: Rect = { x: 0, y: 0, w: 1, h: 1 }): GridCell[] {
  if (!tree) return [];
  const cells: GridCell[] = [];
  walkLayout(tree, root, cells);
  return cells;
}

export function treeSignature(tree: LayoutTree | null): string {
  if (!tree) return 'empty';
  if (tree.type === 'leaf') return `L(${tree.photoId})`;
  return `${tree.direction}(${treeSignature(tree.left)},${treeSignature(tree.right)})`;
}

export function mapTreeLeaves(tree: LayoutTree, photoIds: string[]): LayoutTree {
  let index = 0;
  const visit = (node: LayoutTree): LayoutTree => {
    if (node.type === 'leaf') {
      return { ...node, photoId: photoIds[index++] ?? node.photoId };
    }
    return { ...node, left: visit(node.left), right: visit(node.right) };
  };
  return visit(tree);
}

export function collectPhotoIds(tree: LayoutTree | null): string[] {
  if (!tree) return [];
  if (tree.type === 'leaf') return [tree.photoId];
  return [...collectPhotoIds(tree.left), ...collectPhotoIds(tree.right)];
}

export function cloneTree(tree: LayoutTree): LayoutTree {
  if (tree.type === 'leaf') return { ...tree };
  return { ...tree, left: cloneTree(tree.left), right: cloneTree(tree.right) };
}

export function makeSplit(direction: SplitDirection, left: LayoutTree, right: LayoutTree): LayoutTree {
  return { type: 'split', direction, left, right };
}

function walkLayout(tree: LayoutTree, rect: Rect, cells: GridCell[]) {
  if (tree.type === 'leaf') {
    cells.push({ id: tree.photoId, photoId: tree.photoId, rect });
    return;
  }

  const leftAspect = naturalAspect(tree.left);
  const rightAspect = naturalAspect(tree.right);
  if (tree.direction === 'H') {
    const leftW = rect.w * (leftAspect / (leftAspect + rightAspect));
    walkLayout(tree.left, { x: rect.x, y: rect.y, w: leftW, h: rect.h }, cells);
    walkLayout(tree.right, { x: rect.x + leftW, y: rect.y, w: rect.w - leftW, h: rect.h }, cells);
    return;
  }

  const topH = rect.h * (rightAspect / (leftAspect + rightAspect));
  walkLayout(tree.left, { x: rect.x, y: rect.y, w: rect.w, h: topH }, cells);
  walkLayout(tree.right, { x: rect.x, y: rect.y + topH, w: rect.w, h: rect.h - topH }, cells);
}
