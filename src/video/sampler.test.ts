import { describe, expect, it } from 'vitest';
import { sampleTimestamps, selectNearestFrames } from './sampler';
import type { RawFrame } from './types';

describe('video sampler', () => {
  it('samples timestamps from the middle of each temporal cell', () => {
    expect(sampleTimestamps(2, 6, 4)).toEqual([2.5, 3.5, 4.5, 5.5]);
  });

  it('returns monotonic timestamps inside the trim window', () => {
    const times = sampleTimestamps(0.25, 5.75, 16);
    expect(times).toHaveLength(16);
    expect(times[0]).toBeGreaterThan(0.25);
    expect(times[times.length - 1]).toBeLessThan(5.75);
    expect(times.every((time, index) => index === 0 || time > times[index - 1])).toBe(true);
  });

  it('subsamples cached frames by nearest timestamp', () => {
    const frames = [0.5, 1.5, 2.5, 3.5].map((tSec, index) => ({
      index,
      tSec,
      bitmap: {} as HTMLCanvasElement,
      width: 100,
      height: 100,
    })) satisfies RawFrame[];

    expect(selectNearestFrames(frames, 0, 4, 2).map((frame) => frame.tSec)).toEqual([1, 3]);
    expect(selectNearestFrames(frames, 0, 4, 2).map((frame) => frame.index)).toEqual([0, 1]);
  });
});
