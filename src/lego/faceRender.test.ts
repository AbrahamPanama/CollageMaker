import { describe, expect, it } from 'vitest';
import { computeLegoFaceTextureSize, MAX_FACE_TEXTURE_EDGE } from './faceRender';

describe('lego face texture sizing', () => {
  it('uses 96 px cells for normal Lego panel presets', () => {
    expect(computeLegoFaceTextureSize({ cols: 10, rows: 11 })).toMatchObject({
      width: 480,
      height: 634,
      scale: 1,
    });
  });

  it('caps large panel textures by long edge', () => {
    const size = computeLegoFaceTextureSize({ cols: 80, rows: 40 });
    expect(Math.max(size.width, size.height)).toBe(MAX_FACE_TEXTURE_EDGE);
    expect(size.scale).toBeLessThan(1);
  });
});
