import { describe, expect, it } from 'vitest';
import { sanitizeUserShapes } from './userShapes';

describe('user shape persistence', () => {
  it('keeps valid saved SVG paths and normalizes their viewBox', () => {
    expect(
      sanitizeUserShapes([
        {
          id: 'user-papa',
          name: ' PAPA ',
          d: 'M0 0 L10 0 L10 10 L0 10 Z',
          viewBox: '0, 0, 10, 10',
        },
      ])
    ).toEqual([
      {
        id: 'user-papa',
        name: 'PAPA',
        d: 'M0 0 L10 0 L10 10 L0 10 Z',
        viewBox: '0 0 10 10',
      },
    ]);
  });

  it('drops malformed saved shapes before they can render at startup', () => {
    expect(
      sanitizeUserShapes([
        {
          id: 'bad-path',
          name: 'Bad',
          d: 'M0 0"><script>alert(1)</script>',
          viewBox: '0 0 10 10',
        },
        {
          id: 'bad-viewbox',
          name: 'Flat',
          d: 'M0 0 L10 0 L10 10 Z',
          viewBox: '0 0 0 10',
        },
      ])
    ).toEqual([]);
  });
});
