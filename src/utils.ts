import type { LayoutSlot } from './types';

export type SlotRect = { x: number; y: number; w: number; h: number };

const EPS = 0.001;

export function computeSlotRect(
  slot: LayoutSlot,
  stageW: number,
  stageH: number,
  borderWidth: number
): SlotRect {
  const isLeftEdge = slot.x < EPS;
  const isRightEdge = slot.x + slot.w > 1 - EPS;
  const isTopEdge = slot.y < EPS;
  const isBottomEdge = slot.y + slot.h > 1 - EPS;

  const leftInset = isLeftEdge ? borderWidth : borderWidth / 2;
  const rightInset = isRightEdge ? borderWidth : borderWidth / 2;
  const topInset = isTopEdge ? borderWidth : borderWidth / 2;
  const bottomInset = isBottomEdge ? borderWidth : borderWidth / 2;

  return {
    x: slot.x * stageW + leftInset,
    y: slot.y * stageH + topInset,
    w: Math.max(1, slot.w * stageW - leftInset - rightInset),
    h: Math.max(1, slot.h * stageH - topInset - bottomInset),
  };
}

export function clampPhotoPos(
  x: number,
  y: number,
  scale: number,
  naturalW: number,
  naturalH: number,
  slotW: number,
  slotH: number
) {
  const imgW = naturalW * scale;
  const imgH = naturalH * scale;
  return {
    x: Math.max(slotW - imgW, Math.min(0, x)),
    y: Math.max(slotH - imgH, Math.min(0, y)),
  };
}

export function coverScale(
  naturalW: number,
  naturalH: number,
  slotW: number,
  slotH: number
) {
  return Math.max(slotW / naturalW, slotH / naturalH);
}
