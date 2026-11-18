import { beforeEach, expect, it } from 'vitest';
import { spacing } from '../../src/rules/spacing.js';
import { box, resetBoxIds, snap } from '../helpers/boxes.js';

beforeEach(resetBoxIds);
const opts = spacing.defaults;
const row = (y: number, h = 40) => box({ x: 0, y, w: 300, h, tag: 'li' });

it('flags one 14px gap among 16px gaps', () => {
  const items = [row(0), row(56), row(112), row(166), row(222)]; // gaps 16,16,14,16
  const f = spacing.check(snap(items), opts, 'error');
  expect(f).toEqual([expect.objectContaining({
    rule: 'spacing', check: 'gap', severity: 'error', measured: 14, expected: 16,
    boxIds: [items[2].id, items[3].id], peerIds: [items[0].id, items[1].id, items[4].id],
    message: 'gap 14px, siblings use 16px',
  })]);
});

it('leaves an intentionally large gap alone', () =>
  expect(spacing.check(snap([row(0), row(56), row(112), row(216)]), opts, 'error')).toEqual([])); // 16,16,64

it('needs a dominant value', () =>
  expect(spacing.check(snap([row(0), row(54), row(110)]), opts, 'error')).toEqual([])); // 14,16

it('checks gaps in a row too', () => {
  const b = (x: number) => box({ x, y: 0, w: 40, h: 36, kind: 'control' });
  const f = spacing.check(snap([b(0), b(48), b(96), b(142)]), opts, 'error'); // 8,8,6
  expect(f[0]).toMatchObject({ check: 'gap', measured: 6, expected: 8 });
});

it('flags uneven horizontal padding on a card', () => {
  const card = box({ x: 0, y: 0, w: 300, h: 100 });
  const btn = box({ x: 13, y: 16, w: 271, h: 36, kind: 'control', containerId: card.id }); // left 13, right 16
  expect(spacing.check(snap([card, btn]), opts, 'error')[0]).toMatchObject({
    check: 'inset-x', measured: 13, expected: 16, boxIds: [card.id], message: 'left inset 13px, right inset 16px',
  });
});

it('flags uneven vertical padding on a card', () => {
  const card = box({ x: 0, y: 0, w: 300, h: 70 });
  const t = box({ x: 16, y: 16, w: 100, h: 20, kind: 'text', containerId: card.id }); // top 16
  const btn = box({ x: 16, y: 40, w: 268, h: 16, kind: 'control', containerId: card.id }); // bottom 14, left 16, right 16
  expect(spacing.check(snap([card, t, btn]), opts, 'error').map((f) => [f.check, f.message])).toEqual([
    ['inset-y', 'top inset 16px, bottom inset 14px'],
  ]);
});

it('ignores ragged text for horizontal insets', () => {
  const card = box({ x: 0, y: 0, w: 300, h: 60 });
  const t = box({ x: 16, y: 16, w: 266, h: 16, kind: 'text', containerId: card.id });
  expect(spacing.check(snap([card, t]), opts, 'error')).toEqual([]);
});

it('applies the optional scale', () => {
  const f = spacing.check(snap([row(0), row(54), row(108)]), { ...opts, scale: 4 }, 'error'); // 14,14
  expect(f.map((x) => x.check)).toEqual(['scale', 'scale']);
});

it('applies the optional minimum gap between text blocks', () => {
  const t = (y: number) => box({ x: 0, y, w: 100, h: 16, kind: 'text' });
  const f = spacing.check(snap([t(0), t(20)]), { ...opts, minTextGap: 8 }, 'warn');
  expect(f).toEqual([expect.objectContaining({ check: 'min-gap', measured: 4, expected: 8, severity: 'warn' })]);
});
