import { describe, expect, it } from 'vitest';
import {
  buildFlipbookBlades,
  buildPrintPages,
  buildStableFrames,
  validateBladeMap,
} from './logic';

describe('flipbook mechanics', () => {
  it('maps each blade front to A(i) and back to D(i+1)', () => {
    const blades = buildFlipbookBlades(4);

    expect(blades).toEqual([
      { index: 0, frontFrame: 0, backFrame: 1 },
      { index: 1, frontFrame: 1, backFrame: 2 },
      { index: 2, frontFrame: 2, backFrame: 3 },
      { index: 3, frontFrame: 3, backFrame: 0 },
    ]);
  });

  it('reconstructs stable frames from current front and previous back', () => {
    const stable = buildStableFrames(4);

    expect(stable).toEqual([
      { frame: 0, topBlade: 0, bottomBlade: 3 },
      { frame: 1, topBlade: 1, bottomBlade: 0 },
      { frame: 2, topBlade: 2, bottomBlade: 1 },
      { frame: 3, topBlade: 3, bottomBlade: 2 },
    ]);
    expect(validateBladeMap(4)).toBe(true);
    expect(validateBladeMap(16)).toBe(true);
  });

  it('pads partial rows before mirroring backs', () => {
    const items = buildFlipbookBlades(5);
    const [page] = buildPrintPages(items, 3, 5, 'row-mirror');

    expect(page.frontSlots.map((slot) => slot.item?.index ?? null)).toEqual([
      0,
      1,
      2,
      3,
      4,
      null,
    ]);
    expect(page.backSlots.map((slot) => slot.item?.index ?? null)).toEqual([
      2,
      1,
      0,
      null,
      4,
      3,
    ]);
  });

  it('places the next D half behind each front blade after row mirroring', () => {
    const items = buildFlipbookBlades(4);
    const [page] = buildPrintPages(items, 2, 8, 'row-mirror');

    expect(page.frontSlots.map((slot) => slot.item?.index ?? null)).toEqual([0, 1, 2, 3]);
    expect(page.backSlots.map((slot) => slot.item?.index ?? null)).toEqual([1, 0, 3, 2]);
    expect(page.backSlots[1].item).toMatchObject({ index: 0, backFrame: 1 });
  });

  it('keeps front and back blade positions identical for flatbed template printing', () => {
    const items = buildFlipbookBlades(4);
    const [page] = buildPrintPages(items, 2, 8, 'flatbed');

    expect(page.frontSlots.map((slot) => slot.item?.index ?? null)).toEqual([0, 1, 2, 3]);
    expect(page.backSlots.map((slot) => slot.item?.index ?? null)).toEqual([0, 1, 2, 3]);
    page.frontSlots.forEach((slot, index) => {
      expect(page.backSlots[index].item?.index).toBe(slot.item?.index);
    });
  });
});
