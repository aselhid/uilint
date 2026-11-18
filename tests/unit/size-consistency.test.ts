import { beforeEach, expect, it } from 'vitest';
import { sizeConsistency } from '../../src/rules/size-consistency.js';
import { box, resetBoxIds, snap } from '../helpers/boxes.js';

beforeEach(resetBoxIds);
const o = sizeConsistency.defaults;
const btn = (x: number, h: number) => box({ x, y: 0, w: 80, h, kind: 'control', tag: 'button' });

it('flags a button 1px taller than its row', () => {
  const [a, b, c] = [btn(0, 36), btn(88, 36), btn(176, 37)];
  expect(sizeConsistency.check(snap([a, b, c]), o, 'error')).toEqual([expect.objectContaining({
    rule: 'size-consistency', check: 'height', severity: 'error', measured: 37, expected: 36, boxIds: [c.id],
    peerIds: [a.id, b.id], message: 'height 37px, 2 matching items are 36px',
  })]);
});

it('ignores a deliberately larger primary button', () =>
  expect(sizeConsistency.check(snap([btn(0, 36), btn(88, 36), btn(176, 48)]), o, 'error')).toEqual([]));

it('does not compare different kinds of element', () => {
  const input = box({ x: 0, y: 0, w: 200, h: 37, kind: 'control', tag: 'input' });
  expect(sizeConsistency.check(snap([input, btn(208, 36)]), o, 'error')).toEqual([]);
});

it('flags the second of a near-miss pair', () => {
  const [a, b] = [btn(0, 36), btn(88, 38)];
  expect(sizeConsistency.check(snap([a, b]), o, 'error')[0].boxIds).toEqual([b.id]);
});

it('compares widths in a column', () => {
  const card = (y: number, w: number) => box({ x: 0, y, w, h: 100 });
  const [a, b, c] = [card(0, 300), card(116, 300), card(232, 301)];
  expect(sizeConsistency.check(snap([a, b, c]), o, 'error')[0]).toMatchObject({
    check: 'width', boxIds: [c.id], message: 'width 301px, 2 matching items are 300px',
  });
});

it('never compares text', () => {
  const t = (x: number, h: number) => box({ x, y: 0, w: 50, h, kind: 'text' });
  expect(sizeConsistency.check(snap([t(0, 16), t(60, 16), t(120, 17)]), o, 'error')).toEqual([]);
});
