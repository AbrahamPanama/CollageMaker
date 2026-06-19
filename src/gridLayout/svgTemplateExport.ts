import { hexToRgb, type ExportHooks } from '../export';
import type { Point } from '../types';
import type { SvgTemplate } from './svgTemplate';

type VectorExportOptions = {
  width: number;
  height: number;
  stageW: number;
  stageH: number;
  stroke: string;
  strokeWidth: number;
};

export function makeSvgTemplateVectorExportHooks(
  template: SvgTemplate,
  options: VectorExportOptions
): ExportHooks {
  const exportScale = Math.min(
    options.width / Math.max(1, options.stageW),
    options.height / Math.max(1, options.stageH)
  );
  const outputStroke = Math.max(0.25, options.strokeWidth * exportScale);

  return {
    svgExtras: makeSvgTemplateSvgOverlay(template, options, outputStroke),
    pdfOverlay: (pdf) => {
      const rgb = hexToRgb(options.stroke);
      pdf.setDrawColor(rgb.r, rgb.g, rgb.b);
      pdf.setLineWidth(outputStroke);
      pdf.setLineJoin('miter');
      pdf.setLineCap('butt');

      for (const cell of template.cells) {
        strokePolyline(pdf, cell.outer, options.width, options.height);
        for (const hole of cell.holes) strokePolyline(pdf, hole, options.width, options.height);
      }
    },
  };
}

function makeSvgTemplateSvgOverlay(
  template: SvgTemplate,
  options: VectorExportOptions,
  outputStroke: number
) {
  const sx = options.width / template.viewBox.w;
  const sy = options.height / template.viewBox.h;
  const tx = -template.viewBox.x * sx;
  const ty = -template.viewBox.y * sy;
  const sourceStroke = outputStroke / Math.max(0.0001, Math.min(sx, sy));
  const paths = template.sourcePaths
    .map((path) => `<path d="${escapeAttr(path)}"/>`)
    .join('');

  return (
    `<g data-collage-maker-template="${escapeAttr(template.name)}" ` +
    `transform="translate(${formatNumber(tx)} ${formatNumber(ty)}) scale(${formatNumber(sx)} ${formatNumber(sy)})" ` +
    `fill="none" stroke="${escapeAttr(options.stroke)}" stroke-width="${formatNumber(sourceStroke)}" ` +
    `stroke-linejoin="miter" stroke-linecap="butt">${paths}</g>`
  );
}

function strokePolyline(
  pdf: Parameters<NonNullable<ExportHooks['pdfOverlay']>>[0],
  points: Point[],
  width: number,
  height: number
) {
  if (points.length === 0) return;
  pdf.moveTo(points[0].x * width, points[0].y * height);
  for (let index = 1; index < points.length; index++) {
    pdf.lineTo(points[index].x * width, points[index].y * height);
  }
  pdf.close();
  pdf.stroke();
}

function escapeAttr(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function formatNumber(value: number) {
  return String(Number(value.toFixed(4)));
}
