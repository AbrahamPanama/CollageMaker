import { describe, expect, it } from 'vitest';
import { preventPureWhiteInImageData } from './export';

describe('export pure-white prevention', () => {
  it('replaces visible pure white pixels with near-white and preserves alpha', () => {
    const imageData = makeImageData([
      255, 255, 255, 255,
      255, 255, 255, 128,
    ]);

    expect(preventPureWhiteInImageData(imageData)).toBe(true);
    expect(Array.from(imageData.data)).toEqual([
      254, 254, 254, 255,
      254, 254, 254, 128,
    ]);
  });

  it('leaves transparent pure white and non-white pixels unchanged', () => {
    const imageData = makeImageData([
      255, 255, 255, 0,
      254, 255, 255, 255,
      255, 254, 255, 255,
      255, 255, 254, 255,
      12, 34, 56, 255,
    ]);
    const before = Array.from(imageData.data);

    expect(preventPureWhiteInImageData(imageData)).toBe(false);
    expect(Array.from(imageData.data)).toEqual(before);
  });
});

function makeImageData(values: number[]): Pick<ImageData, 'data'> {
  return { data: new Uint8ClampedArray(values) };
}
