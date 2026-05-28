import type { Layout, AspectRatio } from './types';

export const LAYOUTS: Layout[] = [
  {
    id: '1x1',
    name: 'Single',
    slots: [{ x: 0, y: 0, w: 1, h: 1 }],
  },
  {
    id: '2x1',
    name: '2 Side',
    slots: [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 1 },
    ],
  },
  {
    id: '1x2',
    name: '2 Stack',
    slots: [
      { x: 0, y: 0, w: 1, h: 0.5 },
      { x: 0, y: 0.5, w: 1, h: 0.5 },
    ],
  },
  {
    id: '2x2',
    name: '4 Grid',
    slots: [
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.5, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  {
    id: '1+2',
    name: '1 + 2',
    slots: [
      { x: 0, y: 0, w: 0.5, h: 1 },
      { x: 0.5, y: 0, w: 0.5, h: 0.5 },
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
    ],
  },
  {
    id: '3row',
    name: '3 Rows',
    slots: [
      { x: 0, y: 0, w: 1, h: 1 / 3 },
      { x: 0, y: 1 / 3, w: 1, h: 1 / 3 },
      { x: 0, y: 2 / 3, w: 1, h: 1 / 3 },
    ],
  },
];

export const ASPECT_RATIOS: AspectRatio[] = [
  { w: 1, h: 1, label: '1:1' },
  { w: 4, h: 5, label: '4:5' },
  { w: 9, h: 16, label: '9:16' },
];
