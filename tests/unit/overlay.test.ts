import { beforeEach, expect, it } from 'vitest';
import type { Hit } from '../../src/report/merge.js';
import { buildViews, type PageGeom, type Shape } from '../../src/report/overlay.js';
import type { Box, Finding } from '../../src/types.js';
import { box, resetBoxIds } from '../helpers/boxes.js';

beforeEach(resetBoxIds);

const page = (o: Partial<PageGeom> = {}): Map<number, PageGeom> => new Map([[375, { width: 375, height: 2000, captured: 2000, ...o }]]);

function hit(f: Partial<Finding>, offenders: Box[], peers: Box[] = [], viewport = 375): Hit {
  const finding: Finding = { rule: 'spacing', check: 'gap', severity: 'error', message: 'm', measured: 0, expected: null, boxIds: [], peerIds: [], ...f };
  return { viewport, finding, offenders, peers };
}

const measure = (shapes: Shape[]) => shapes.filter((s) => s.kind !== 'outline');

it('shades a vertical gap and labels it with the siblings value', () => {
  const a = box({ x: 10, y: 0, w: 100, h: 40 }), b = box({ x: 10, y: 53, w: 120, h: 40 });
  const [v] = buildViews([hit({ check: 'gap', measured: 13, expected: 16 }, [a, b])], page());
  expect(measure(v.shapes)).toEqual([{ kind: 'shade', rect: { x: 10, y: 40, width: 120, height: 13 }, label: '13px · siblings 16px' }]);
});

it('shades a horizontal gap between boxes side by side', () => {
  const a = box({ x: 0, y: 0, w: 50, h: 20 }), b = box({ x: 62, y: 4, w: 50, h: 20 });
  const [v] = buildViews([hit({ check: 'gap', measured: 12, expected: 16 }, [a, b])], page());
  expect(measure(v.shapes)[0]).toMatchObject({ rect: { x: 50, y: 0, width: 12, height: 24 } });
});

it('labels a gap below the minimum with the minimum', () => {
  const a = box({ x: 0, y: 0, w: 50, h: 20 }), b = box({ x: 0, y: 24, w: 50, h: 20 });
  const [v] = buildViews([hit({ check: 'min-gap', measured: 4, expected: 8 }, [a, b])], page());
  expect(measure(v.shapes)[0]).toMatchObject({ label: '4px · min 8px' });
});

it('measures a gap between text blocks on their layout boxes', () => {
  const a = box({ x: 0, y: 4, w: 50, h: 16, layoutRect: { x: 0, y: 0, width: 50, height: 24 } });
  const b = box({ x: 0, y: 44, w: 50, h: 16, layoutRect: { x: 0, y: 40, width: 50, height: 24 } });
  const [v] = buildViews([hit({ check: 'gap', measured: 16, expected: 12 }, [a, b])], page());
  expect(measure(v.shapes)[0]).toMatchObject({ rect: { y: 24, height: 16 } });
});

it('draws the peers left edge as a line for a left-edge miss', () => {
  const off = box({ x: 23, y: 100, w: 80, h: 20 }), peer = box({ x: 20, y: 0, w: 120, h: 20 });
  const [v] = buildViews([hit({ rule: 'alignment', check: 'left', measured: 3 }, [off], [peer])], page());
  expect(measure(v.shapes)).toEqual([{ kind: 'line', x1: 20, y1: 0, x2: 20, y2: 120, label: '3px off', labelNear: off.rect }]);
});

it('draws a horizontal line for a top-edge miss', () => {
  const off = box({ x: 200, y: 12, w: 50, h: 20 }), peer = box({ x: 0, y: 10, w: 50, h: 20 });
  const [v] = buildViews([hit({ rule: 'alignment', check: 'top', measured: 2 }, [off], [peer])], page());
  expect(measure(v.shapes)[0]).toMatchObject({ kind: 'line', x1: 0, y1: 10, x2: 250, y2: 10 });
});

it('labels a size miss with both sizes', () => {
  const off = box({ x: 0, y: 0, w: 80, h: 37 }), peer = box({ x: 100, y: 0, w: 80, h: 36 });
  const [v] = buildViews([hit({ rule: 'size-consistency', check: 'height', measured: 37, expected: 36 }, [off], [peer])], page());
  expect(measure(v.shapes)).toEqual([{ kind: 'shade', rect: off.rect, label: '37px · others 36px' }]);
});

it('shades the strip beyond the viewport for sideways scroll, and keeps it in the crop', () => {
  const culprit = box({ x: 0, y: 300, w: 433, h: 20 });
  const [v] = buildViews([hit({ rule: 'overflow', check: 'hscroll', measured: 58 }, [culprit])], page({ width: 433 }));
  const shade = measure(v.shapes)[0];
  expect(shade).toMatchObject({ kind: 'shade', label: '+58px', rect: { x: 375, width: 58 } });
  expect(v.crop.x + v.crop.width).toBe(433);
});

it('shows the sideways-scroll strip when no element is to blame', () => {
  const [v] = buildViews([hit({ rule: 'overflow', check: 'hscroll', measured: 58 }, [])], page({ width: 433 }));
  expect(Object.values(v.crop).every(Number.isFinite)).toBe(true);
  expect(v.crop.x + v.crop.width).toBe(433);
  expect(measure(v.shapes)[0]).toMatchObject({ kind: 'shade', label: '+58px', rect: { x: 375, width: 58 } });
});

it('starts the sideways-scroll strip at the page client width, not the viewport', () => {
  const culprit = box({ x: 0, y: 300, w: 418, h: 20 });
  const [v] = buildViews([hit({ rule: 'overflow', check: 'hscroll', measured: 58 }, [culprit])], page({ width: 418, clientWidth: 360 }));
  expect(measure(v.shapes)[0]).toMatchObject({ rect: { x: 360, width: 58 } });
});

it('shades the intersection of overlapping boxes', () => {
  const a = box({ x: 0, y: 0, w: 50, h: 50 }), b = box({ x: 40, y: 30, w: 50, h: 50 });
  const [v] = buildViews([hit({ rule: 'overflow', check: 'overlap', measured: 200 }, [a, b])], page());
  expect(measure(v.shapes)).toEqual([{ kind: 'shade', rect: { x: 40, y: 30, width: 10, height: 20 }, label: 'overlap' }]);
});

it('shades clipped text with the message', () => {
  const t = box({ x: 0, y: 0, w: 100, h: 20 });
  const [v] = buildViews([hit({ rule: 'overflow', check: 'clipped', message: 'text clipped by 30px' }, [t])], page());
  expect(measure(v.shapes)).toEqual([{ kind: 'shade', rect: t.rect, label: 'text clipped by 30px' }]);
});

it('outlines offenders red and every peer blue', () => {
  const off = box({ x: 23, y: 100, w: 80, h: 20 });
  const peers = [0, 1, 2, 3, 4].map((i) => box({ x: 20, y: i * 20, w: 80, h: 16 }));
  const [v] = buildViews([hit({ rule: 'alignment', check: 'left', measured: 3 }, [off], peers)], page());
  const outlines = v.shapes.filter((s) => s.kind === 'outline');
  expect(outlines.filter((s) => s.kind === 'outline' && s.role === 'offender')).toHaveLength(1);
  expect(outlines.filter((s) => s.kind === 'outline' && s.role === 'peer')).toHaveLength(5);
});

it('pads the crop by 48px and clamps it to the page', () => {
  const t = box({ x: 0, y: 500, w: 300, h: 200 });
  const [v] = buildViews([hit({ rule: 'overflow', check: 'clipped' }, [t])], page());
  expect(v.crop).toEqual({ x: 0, y: 452, width: 348, height: 296 });
});

it('gives a tiny element a crop of at least 240 by 120', () => {
  const t = box({ x: 150, y: 500, w: 4, h: 4 });
  const [v] = buildViews([hit({ rule: 'overflow', check: 'clipped' }, [t])], page());
  expect(v.crop.width).toBeGreaterThanOrEqual(240);
  expect(v.crop.height).toBeGreaterThanOrEqual(120);
  expect(v.crop.x).toBeLessThanOrEqual(150);
  expect(v.crop.x + v.crop.width).toBeGreaterThanOrEqual(154);
});

it('marks a finding below the captured area', () => {
  const t = box({ x: 0, y: 12000, w: 100, h: 20 });
  const [v] = buildViews([hit({ rule: 'overflow', check: 'clipped' }, [t])], page({ height: 13000, captured: 10000 }));
  expect(v.belowCapture).toBe(true);
});

it('makes one view per viewport, ascending, outlining every repeated instance', () => {
  const a = box({ x: 0, y: 0, w: 50, h: 20 }), b = box({ x: 0, y: 33, w: 50, h: 20 });
  const c = box({ x: 0, y: 100, w: 50, h: 20 }), d = box({ x: 0, y: 133, w: 50, h: 20 });
  const pages = new Map([[375, { width: 375, height: 900, captured: 900 }], [1280, { width: 1280, height: 900, captured: 900 }]]);
  const views = buildViews([
    hit({ check: 'gap', measured: 13, expected: 16 }, [a, b], [], 1280),
    hit({ check: 'gap', measured: 13, expected: 16 }, [a, b], [], 375),
    hit({ check: 'gap', measured: 13, expected: 16 }, [c, d], [], 375),
  ], pages);
  expect(views.map((v) => v.viewport)).toEqual([375, 1280]);
  expect(views[0].shapes.filter((s) => s.kind === 'shade')).toHaveLength(2);
});

it('tags a contrast failure with its ratio and minimum, without shading the text', () => {
  const t = box({ x: 10, y: 10, w: 120, h: 16, kind: 'text' });
  const [v] = buildViews([hit({ rule: 'contrast', check: 'ratio', measured: 2.85, expected: 4.5 }, [t])], page());
  expect(measure(v.shapes)).toEqual([{ kind: 'tag', label: '2.85:1 · min 4.5:1', near: t.rect }]);
});

it('tags a placeholder the same way', () => {
  const t = box({ x: 10, y: 10, w: 240, h: 36, kind: 'control' });
  const [v] = buildViews([hit({ rule: 'contrast', check: 'placeholder', measured: 1.9, expected: 4.5 }, [t])], page());
  expect(measure(v.shapes)).toEqual([{ kind: 'tag', label: '1.9:1 · min 4.5:1', near: t.rect }]);
});

it('tags unverified contrast with the reason', () => {
  const t = box({ x: 10, y: 10, w: 120, h: 16, kind: 'text', contrast: { samples: [], unverified: 'backdrop-filter' } });
  const [v] = buildViews([hit({ rule: 'contrast', check: 'unverified', measured: 0, expected: null }, [t])], page());
  expect(measure(v.shapes)).toEqual([{ kind: 'tag', label: 'not checked: backdrop-filter', near: t.rect }]);
});
