import { hexToRgb, type ExportHooks } from '../export';
import { footprint } from './tiling';
import type { Brick, Face, LegoSet } from './types';

type LegoVectorOptions = {
  width: number;
  height: number;
  sourceWidth: number;
  face: Face;
  stroke: string;
  strokeWidth: number;
};

export function makeLegoVectorExportHooks(set: LegoSet, options: LegoVectorOptions): ExportHooks {
  const bricks = set.bricks;
  const exportScale = options.sourceWidth > 0 ? options.width / options.sourceWidth : 1;
  const outputStroke = Math.max(0.25, options.strokeWidth * exportScale);

  return {
    svgExtras: makeSvgExtras(set, bricks, options, outputStroke),
    pdfOverlay: (pdf) => {
      const rgb = hexToRgb(options.stroke);
      pdf.setDrawColor(rgb.r, rgb.g, rgb.b);
      pdf.setLineWidth(outputStroke);
      pdf.setLineJoin('miter');
      pdf.setLineCap('butt');

      for (const brick of bricks) {
        const rect = brickRect(set, brick, options.width, options.height);
        pdf.rect(rect.x, rect.y, rect.w, rect.h, 'S');
      }

      pdf.setLineWidth(outputStroke * 1.4);
      pdf.rect(0, 0, options.width, options.height, 'S');
    },
  };
}

function makeSvgExtras(
  set: LegoSet,
  bricks: Brick[],
  options: LegoVectorOptions,
  outputStroke: number
) {
  const rects = bricks
    .map((brick) => {
      const rect = brickRect(set, brick, options.width, options.height);
      return `<rect x="${fmt(rect.x)}" y="${fmt(rect.y)}" width="${fmt(rect.w)}" height="${fmt(rect.h)}"/>`;
    })
    .join('');

  return (
    `<g data-collage-maker-lego="${options.face}" fill="none" stroke="${escapeAttr(options.stroke)}" ` +
    `stroke-width="${fmt(outputStroke)}" stroke-linejoin="miter" stroke-linecap="butt">` +
    `<rect x="0" y="0" width="${fmt(options.width)}" height="${fmt(options.height)}" stroke-width="${fmt(outputStroke * 1.4)}"/>` +
    rects +
    `</g>`
  );
}

function brickRect(set: LegoSet, brick: Brick, width: number, height: number) {
  const cells = footprint(brick);
  const minCol = Math.min(...cells.map((cell) => cell.col));
  const minRow = Math.min(...cells.map((cell) => cell.row));
  const maxCol = Math.max(...cells.map((cell) => cell.col));
  const maxRow = Math.max(...cells.map((cell) => cell.row));
  return {
    x: (minCol / set.cols) * width,
    y: (minRow / set.rows) * height,
    w: ((maxCol - minCol + 1) / set.cols) * width,
    h: ((maxRow - minRow + 1) / set.rows) * height,
  };
}

function escapeAttr(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmt(value: number) {
  return String(Number(value.toFixed(4)));
}
