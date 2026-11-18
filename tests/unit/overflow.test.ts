import { beforeEach, expect, it } from 'vitest';
import { overflow } from '../../src/rules/overflow.js';
import { box, resetBoxIds, snap } from '../helpers/boxes.js';

beforeEach(resetBoxIds);
const o = overflow.defaults;

it('flags clipped text', () => {
  const t = box({ x: 0, y: 0, w: 100, h: 16, kind: 'text', clipped: { x: 22, y: 0 } });
  expect(overflow.check(snap([t]), o, 'error')[0]).toMatchObject({
    rule: 'overflow', check: 'clipped', severity: 'error', measured: 22, boxIds: [t.id],
    message: 'text clipped horizontally by 22px',
  });
});

it('reports vertical clipping', () =>
  expect(overflow.check(snap([box({ x: 0, y: 0, w: 10, h: 10, kind: 'text', clipped: { x: 0, y: 6 } })]), o, 'error')[0].message)
    .toBe('text clipped vertically by 6px'));

it('reports ellipsis as a warning', () =>
  expect(overflow.check(snap([box({ x: 0, y: 0, w: 10, h: 10, kind: 'text', ellipsis: true })]), o, 'error')[0])
    .toMatchObject({ check: 'ellipsis', severity: 'warn', message: 'text truncated with ellipsis' }));

it('treats a spilling badge as decorative', () => {
  const card = box({ x: 0, y: 0, w: 40, h: 40 }), dot = box({ x: 34, y: -6, w: 12, h: 12, containerId: card.id });
  expect(overflow.check(snap([card, dot]), o, 'error')[0]).toMatchObject({ check: 'spill', severity: 'warn', boxIds: [dot.id] });
});

it('flags a control spilling out of its card as an error', () => {
  const card = box({ x: 0, y: 0, w: 200, h: 80 }), btn = box({ x: 16, y: 16, w: 196, h: 36, kind: 'control', containerId: card.id });
  expect(overflow.check(snap([card, btn]), o, 'error')[0]).toMatchObject({
    check: 'spill', severity: 'error', measured: 12, message: 'extends 12px outside its container',
  });
});

it('flags horizontal page scroll', () => {
  const wide = box({ x: 0, y: 0, w: 500, h: 20 });
  expect(overflow.check(snap([wide], { scrollWidth: 500, clientWidth: 375 }), o, 'error')[0])
    .toMatchObject({ check: 'hscroll', measured: 125, boxIds: [wide.id], message: 'page scrolls horizontally by 125px' });
});

it('flags overlapping text but not text inside its own button', () => {
  const a = box({ x: 0, y: 0, w: 50, h: 16, kind: 'text' }), b = box({ x: 42, y: 2, w: 50, h: 16, kind: 'text' });
  const button = box({ x: 200, y: 0, w: 80, h: 36, kind: 'control' });
  const label = box({ x: 210, y: 10, w: 60, h: 16, kind: 'text', containerId: button.id });
  const f = overflow.check(snap([a, b, button, label]), o, 'error');
  expect(f.map((x) => x.check)).toEqual(['overlap']);
  expect(f[0]).toMatchObject({ boxIds: [a.id, b.id], measured: 112, message: 'text overlaps another element by 8×14px' });
});

it('never reports overlap between a modal layer and the page', () => {
  const page = box({ x: 0, y: 0, w: 100, h: 16, kind: 'text' }), modal = box({ x: 0, y: 0, w: 100, h: 16, kind: 'text', layer: 1 });
  expect(overflow.check(snap([page, modal]), o, 'error')).toEqual([]);
});

it('caps sub-check severity at the rule severity', () =>
  expect(overflow.check(snap([box({ x: 0, y: 0, w: 1, h: 1, kind: 'text', clipped: { x: 5, y: 0 } })]), o, 'warn')[0].severity).toBe('warn'));

it('skips a sub-check set to off', () =>
  expect(overflow.check(snap([box({ x: 0, y: 0, w: 1, h: 1, kind: 'text', clipped: { x: 5, y: 0 } })]), { ...o, clipped: 'off' }, 'error')).toEqual([]));
