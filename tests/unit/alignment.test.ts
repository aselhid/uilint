import { beforeEach, expect, it } from 'vitest';
import { alignment } from '../../src/rules/alignment.js';
import { box, resetBoxIds, snap } from '../helpers/boxes.js';

beforeEach(resetBoxIds);
const opts = alignment.defaults;
const text = (x: number, y: number, w = 100, align: 'left' | 'center' | 'right' = 'left') =>
  box({ x, y, w, h: 16, kind: 'text', textAlign: align, baseline: y + 12 });

it('flags a stacked text block 3px off its column', () => {
  const [a, b, c] = [text(16, 0), text(16, 30), text(19, 60)];
  const f = alignment.check(snap([a, b, c]), opts, 'error');
  expect(f).toEqual([expect.objectContaining({
    rule: 'alignment', check: 'left', severity: 'error', measured: 3, expected: 0, boxIds: [c.id], peerIds: [a.id, b.id],
    message: 'left edge 3px off from 2 stacked items',
  })]);
});

it('ignores clearly different edges (indent)', () =>
  expect(alignment.check(snap([text(16, 0), text(40, 30)]), opts, 'error')).toEqual([]));

it('ignores sub-pixel differences', () =>
  expect(alignment.check(snap([text(16, 0), text(16.4, 30)]), opts, 'error')).toEqual([]));

it('skips text pairs with different text-align', () =>
  expect(alignment.check(snap([text(16, 0, 100, 'center'), text(18, 30)]), opts, 'error')).toEqual([]));

it('compares centered text by its center', () => {
  const f = alignment.check(snap([text(100, 0, 200, 'center'), text(150, 30, 100, 'center'), text(152, 60, 100, 'center')]), opts, 'error');
  expect(f[0]).toMatchObject({ check: 'center-x', measured: 2 });
});

it('ignores a lone stacked pair: two edges that happen to be close are not a column', () => {
  const pill = box({ x: 300, y: 0, w: 97.44, h: 28, kind: 'surface' });
  const card = box({ x: 0, y: 52, w: 400, h: 200, kind: 'surface' });
  expect(alignment.check(snap([pill, card]), opts, 'error')).toEqual([]);
});

it('accepts a pair aligned on any edge (button under input, right edges equal)', () => {
  const input = box({ x: 0, y: 0, w: 300, h: 36, kind: 'control' }), btn = box({ x: 220, y: 44, w: 80, h: 36, kind: 'control' });
  expect(alignment.check(snap([input, btn]), opts, 'error')).toEqual([]);
});

it('flags a row item 2px off the shared baseline', () => {
  const a = text(0, 0), b = text(120, 2);
  expect(alignment.check(snap([a, b]), opts, 'warn')[0]).toMatchObject({
    check: 'top', severity: 'warn', measured: 2, boxIds: [b.id], message: 'top edge 2px off from 1 item in the row',
  });
});

it('never compares across layers', () =>
  expect(alignment.check(snap([text(16, 0), { ...text(18, 30), layer: 1 }]), opts, 'error')).toEqual([]));

it('reports an offender once per edge', () => {
  const [a, b, c, d] = [text(16, 0), text(16, 30), text(19, 60), text(16, 90)];
  const f = alignment.check(snap([a, b, c, d]), opts, 'error');
  expect(f.map((x) => x.boxIds)).toEqual([[c.id]]);
});

it('accepts an avatar centered on a two-line stack beside it (name over email)', () => {
  const avatar = box({ x: 0, y: 4, w: 32, h: 32, kind: 'surface' });
  const name = box({ x: 44, y: 3, w: 120, h: 14, kind: 'text', textAlign: 'left', baseline: 14 });
  const email = box({ x: 44, y: 23, w: 180, h: 14, kind: 'text', textAlign: 'left', baseline: 34 });
  expect(alignment.check(snap([avatar, name, email]), opts, 'error')).toEqual([]);
});

it('still flags an icon 2px off the single label beside it', () => {
  const icon = box({ x: 0, y: 4, w: 16, h: 16, kind: 'media', tag: 'svg' });
  const label = box({ x: 24, y: 2, w: 80, h: 16, kind: 'text', textAlign: 'left', baseline: 14 });
  expect(alignment.check(snap([icon, label]), opts, 'error')).toEqual([
    expect.objectContaining({ rule: 'alignment', measured: 2 }),
  ]);
});

it('ignores inline code that wrapped to the start of a line', () => {
  const code = box({ x: 19.2, y: 60, w: 80, h: 18, inText: true });
  expect(alignment.check(snap([text(16, 0), text(16, 30), code]), opts, 'error')).toEqual([]);
});

it("ignores a left-aligned paragraph's ragged right edge and center next to an image", () => {
  // A centred image (23..352) in a 16..359 column, among paragraphs whose longest lines happen to end near 350.4.
  const p = (y: number, w: number) => box({ x: 16, y, w, h: 56, kind: 'text', textAlign: 'left' });
  const img = box({ x: 23, y: 80, w: 329, h: 300, kind: 'media', tag: 'img' });
  expect(alignment.check(snap([p(0, 334.4), img, p(400, 334.6), p(480, 334.2)]), opts, 'error')).toEqual([]);
});

it('still compares the edge text is aligned to with the boxes around it', () => {
  const card = (y: number) => box({ x: 16, y, w: 300, h: 40, kind: 'surface' });
  const t = box({ x: 19, y: 100, w: 120, h: 16, kind: 'text', textAlign: 'left' });
  const f = alignment.check(snap([card(0), card(50), t]), opts, 'error');
  expect(f).toEqual([expect.objectContaining({ check: 'left', measured: 3, boxIds: [t.id] })]);
});
