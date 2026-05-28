// User-uploaded SVG shapes, persisted in localStorage.

export type UserShape = {
  id: string;
  name: string;
  d: string;
  viewBox: string;
};

const USER_SHAPES_KEY = 'collagemaker:userShapes:v1';

export function loadUserShapes(): UserShape[] {
  try {
    const raw = localStorage.getItem(USER_SHAPES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveUserShapes(shapes: UserShape[]): void {
  try {
    localStorage.setItem(USER_SHAPES_KEY, JSON.stringify(shapes));
  } catch (e) {
    console.warn('Failed to persist user shapes', e);
  }
}

export function userShapeToSvgText(shape: UserShape): string {
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="${shape.viewBox}"><path d="${shape.d}" fill="black"/></svg>`;
}

export function parseUploadedSvg(svgText: string, filename: string): UserShape | null {
  try {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    if (!svg) return null;
    const viewBox = svg.getAttribute('viewBox') ?? '0 0 100 100';

    const path = svg.querySelector('path[d]');
    if (path) {
      return {
        id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: (filename || 'Untitled').replace(/\.svg$/i, '').slice(0, 32),
        d: path.getAttribute('d') ?? '',
        viewBox,
      };
    }

    const prim = svg.querySelector('rect, circle, ellipse, polygon, polyline');
    if (prim) {
      const d = primitiveToPath(prim);
      if (d) {
        return {
          id: `user-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: (filename || 'Untitled').replace(/\.svg$/i, '').slice(0, 32),
          d,
          viewBox,
        };
      }
    }
    return null;
  } catch {
    return null;
  }
}

function primitiveToPath(el: Element): string | null {
  const tag = el.tagName.toLowerCase();
  const n = (a: string) => parseFloat(el.getAttribute(a) || '0');
  if (tag === 'rect') {
    const x = n('x'), y = n('y'), w = n('width'), h = n('height');
    return `M${x} ${y} h${w} v${h} h${-w} Z`;
  }
  if (tag === 'circle') {
    const cx = n('cx'), cy = n('cy'), r = n('r');
    return `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${r * 2} 0 a${r} ${r} 0 1 0 ${-r * 2} 0 Z`;
  }
  if (tag === 'ellipse') {
    const cx = n('cx'), cy = n('cy'), rx = n('rx'), ry = n('ry');
    return `M${cx - rx} ${cy} a${rx} ${ry} 0 1 0 ${rx * 2} 0 a${rx} ${ry} 0 1 0 ${-rx * 2} 0 Z`;
  }
  if (tag === 'polygon' || tag === 'polyline') {
    const pts = (el.getAttribute('points') || '').trim().split(/[\s,]+/);
    if (pts.length < 4) return null;
    let d = `M${pts[0]} ${pts[1]}`;
    for (let i = 2; i < pts.length - 1; i += 2) d += ` L${pts[i]} ${pts[i + 1]}`;
    if (tag === 'polygon') d += ' Z';
    return d;
  }
  return null;
}
