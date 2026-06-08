export type BladeSide = 'front' | 'back';
export type BladeHalf = 'A' | 'D';
export type DuplexMode = 'row-mirror' | 'column-mirror' | 'rotate-180' | 'flatbed' | 'none';

export type FlipbookBlade = {
  index: number;
  frontFrame: number;
  backFrame: number;
};

export type StableFrame = {
  frame: number;
  topBlade: number;
  bottomBlade: number;
};

export type PrintSlot<T> = {
  slot: number;
  item: T | null;
};

export type PrintPage<T> = {
  page: number;
  columns: number;
  frontSlots: PrintSlot<T>[];
  backSlots: PrintSlot<T>[];
};

export function mod(index: number, count: number) {
  return ((index % count) + count) % count;
}

export function formatFrame(index: number) {
  return String(index + 1).padStart(2, '0');
}

export function buildFlipbookBlades(frameCount: number): FlipbookBlade[] {
  return Array.from({ length: frameCount }, (_, index) => ({
    index,
    frontFrame: index,
    backFrame: mod(index + 1, frameCount),
  }));
}

export function buildStableFrames(frameCount: number): StableFrame[] {
  return Array.from({ length: frameCount }, (_, frame) => ({
    frame,
    topBlade: frame,
    bottomBlade: mod(frame - 1, frameCount),
  }));
}

export function mirrorSlotIndex(
  slot: number,
  columns: number,
  slotCount: number,
  mode: DuplexMode
) {
  const rows = Math.ceil(slotCount / columns);
  const row = Math.floor(slot / columns);
  const col = slot % columns;
  const mirroredRow = mode === 'column-mirror' || mode === 'rotate-180' ? rows - 1 - row : row;
  const mirroredCol = mode === 'row-mirror' || mode === 'rotate-180' ? columns - 1 - col : col;
  return mirroredRow * columns + mirroredCol;
}

export function padToGrid<T>(items: T[], columns: number) {
  const rows = Math.ceil(items.length / columns);
  const total = rows * columns;
  return Array.from({ length: total }, (_, i) => items[i] ?? null);
}

export function buildPrintPages<T extends { index: number }>(
  items: T[],
  columns: number,
  itemsPerPage: number,
  duplexMode: DuplexMode
): PrintPage<T>[] {
  const pages: PrintPage<T>[] = [];
  for (let offset = 0; offset < items.length; offset += itemsPerPage) {
    const group = items.slice(offset, offset + itemsPerPage);
    const padded = padToGrid(group, columns);
    const backItems = Array<T | null>(padded.length).fill(null);

    padded.forEach((item, slot) => {
      if (!item) return;
      backItems[mirrorSlotIndex(slot, columns, padded.length, duplexMode)] = item;
    });

    pages.push({
      page: pages.length,
      columns,
      frontSlots: padded.map((item, slot) => ({ slot, item })),
      backSlots: backItems.map((item, slot) => ({ slot, item })),
    });
  }
  return pages;
}

export function validateBladeMap(frameCount: number) {
  const blades = buildFlipbookBlades(frameCount);
  const stableFrames = buildStableFrames(frameCount);

  return stableFrames.every((stable) => {
    const top = blades[stable.topBlade];
    const bottom = blades[stable.bottomBlade];
    return top.frontFrame === stable.frame && bottom.backFrame === stable.frame;
  });
}
