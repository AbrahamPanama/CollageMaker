import { describe, expect, it } from 'vitest';
import papaSvg from './__fixtures__/papa.svg?raw';
import { parseSvgTemplate, svgTemplateToLayout, SvgTemplateError } from './svgTemplate';
import { makeSvgTemplateVectorExportHooks } from './svgTemplateExport';

describe('svg template parsing', () => {
  it('parses the PAPA fixture into four visually sorted cells', () => {
    const template = parseSvgTemplate(papaSvg, 'papa.svg');

    expect(template.cells).toHaveLength(4);
    expect(template.aspect).toBeCloseTo(117463.7 / 48063.4, 2);
    expect(template.cells.every((cell) => cell.holes.length === 0)).toBe(true);
    expect(template.cells.every((cell) => cell.mask.some(Boolean))).toBe(true);
    expect(template.cells.map((cell) => cell.bbox.x)).toEqual(
      template.cells.map((cell) => cell.bbox.x).slice().sort((a, b) => a - b)
    );
  });

  it('treats an inner contour as a hole', () => {
    const svg = `
      <svg viewBox="0 0 100 100">
        <rect x="10" y="10" width="80" height="80"/>
        <rect x="35" y="35" width="30" height="30"/>
      </svg>
    `;
    const template = parseSvgTemplate(svg, 'donut.svg');

    expect(template.cells).toHaveLength(1);
    expect(template.cells[0].holes).toHaveLength(1);
  });

  it('drops tiny specks but keeps real cells', () => {
    const svg = `
      <svg viewBox="0 0 100 100">
        <rect x="0" y="0" width="1" height="1"/>
        <rect x="20" y="20" width="40" height="40"/>
      </svg>
    `;
    const template = parseSvgTemplate(svg, 'speck.svg');

    expect(template.cells).toHaveLength(1);
  });

  it('builds a one-variant layout with seeded reassignment', () => {
    const template = parseSvgTemplate(papaSvg, 'papa.svg');
    const natural = svgTemplateToLayout(template, ['a', 'b', 'c', 'd'], 1);
    const shuffled = svgTemplateToLayout(template, ['a', 'b', 'c', 'd'], 9);

    expect(natural.family).toBe('svgTemplate');
    expect(natural.cells.map((cell) => cell.photoId)).toEqual(['a', 'b', 'c', 'd']);
    expect(shuffled.cells.map((cell) => cell.photoId)).not.toEqual(['a', 'b', 'c', 'd']);
    expect(natural.cells.every((cell) => cell.clip && cell.label)).toBe(true);
  });

  it('creates vector export hooks for the template cut lines', () => {
    const template = parseSvgTemplate(papaSvg, 'papa.svg');
    const hooks = makeSvgTemplateVectorExportHooks(template, {
      width: 3600,
      height: Math.round(3600 / template.aspect),
      stageW: 600,
      stageH: Math.round(600 / template.aspect),
      stroke: '#ffffff',
      strokeWidth: 1.5,
    });

    expect(hooks.svgExtras).toContain('<g');
    expect(hooks.svgExtras).toContain('<path d=');
    expect(hooks.svgExtras).toContain('stroke="#ffffff"');
    expect(hooks.pdfOverlay).toBeTypeOf('function');
  });

  it('throws a typed error for empty SVGs', () => {
    expect(() => parseSvgTemplate('<svg viewBox="0 0 100 100"></svg>', 'empty.svg')).toThrow(SvgTemplateError);
  });
});
