import { describe, expect, it } from 'vitest';
import { makeLegoVectorExportHooks } from './legoExport';
import { LEGO_PRESETS } from './shapes';
import { tileShape } from './tiling';
import type { LegoSet } from './types';

describe('lego vector export', () => {
  it('exports the visible back face without imposition mirroring', () => {
    const set: LegoSet = {
      shapeId: 'fixture',
      cols: 12,
      rows: 1,
      cellMask: [true, true, true, true, false, false, false, false, false, false, false, false],
      bricks: [{ id: 'fixture-left', kind: '2x4', orientation: 'h', cell: { col: 0, row: 0 } }],
      pieceCount: 1,
    };
    const hooks = makeLegoVectorExportHooks(set, {
      width: 600,
      height: 100,
      sourceWidth: 300,
      face: 'back',
      stroke: '#050505',
      strokeWidth: 1.25,
    });

    expect(hooks.svgExtras).toContain('data-collage-maker-lego="back"');
    expect(hooks.svgExtras).toContain('<rect x="0" y="0" width="200" height="100"/>');
    expect(hooks.svgExtras).not.toContain('<rect x="400" y="0" width="200" height="100"/>');
  });

  it('scales vector stroke width to export resolution', () => {
    const set = tileShape(LEGO_PRESETS[0]);
    const hooks = makeLegoVectorExportHooks(set, {
      width: 600,
      height: 1100,
      sourceWidth: 300,
      face: 'front',
      stroke: '#050505',
      strokeWidth: 1.25,
    });

    expect(hooks.svgExtras).toContain('stroke-width="2.5"');
  });
});
