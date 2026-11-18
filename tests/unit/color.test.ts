import { describe, expect, it } from 'vitest';
import { composite, contrastRatio, isLarge, minimumFor, toHex, truncate2, type RGBA } from '../../src/contrast/color.js';

const WHITE: RGBA = [255, 255, 255, 1];
const BLACK: RGBA = [0, 0, 0, 1];
const grey = (v: number): RGBA => [v, v, v, 1];

describe('contrastRatio', () => {
  it('is 21 for black on white', () => expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 6));
  it('does not depend on the order', () => expect(contrastRatio(WHITE, grey(0x77))).toBe(contrastRatio(grey(0x77), WHITE)));
  it('puts #777 on white just under 4.5', () => {
    const r = contrastRatio(grey(0x77), WHITE);
    expect(r).toBeLessThan(4.5);
    expect(truncate2(r)).toBe(4.47);
  });
  it('puts #767676 on white at or above 4.5', () => expect(contrastRatio(grey(0x76), WHITE)).toBeGreaterThanOrEqual(4.5));
});

describe('thresholds', () => {
  it('classifies large text', () => {
    expect(isLarge(24, 400)).toBe(true);
    expect(isLarge(18.66, 700)).toBe(true);
    expect(isLarge(18.66, 400)).toBe(false);
    expect(isLarge(18, 700)).toBe(false);
  });
  it('gives the WCAG minimums', () => {
    expect(minimumFor('AA', false)).toBe(4.5);
    expect(minimumFor('AA', true)).toBe(3);
    expect(minimumFor('AAA', false)).toBe(7);
    expect(minimumFor('AAA', true)).toBe(4.5);
  });
});

describe('composite', () => {
  it('blends a half-transparent layer over the base', () => {
    const c = composite(WHITE, [{ color: [0, 0, 0, 0.5], groups: [] }], {});
    expect(c[0]).toBeCloseTo(127.5, 6);
    expect(c[3]).toBe(1);
  });

  it('returns the base when there are no layers', () => expect(composite(WHITE, [], {})).toEqual(WHITE));

  it('applies group opacity to the group as a whole', () => {
    // A black panel and a red panel on top, both inside one 50% group: the black is hidden inside the group.
    const c = composite(WHITE, [{ color: BLACK, groups: [1] }, { color: [255, 0, 0, 1], groups: [1] }], { 1: 0.5 });
    expect(c.slice(0, 3).map((v) => Math.round(v * 10) / 10)).toEqual([255, 127.5, 127.5]);
  });

  it('closes a group before a later layer outside it', () => {
    const c = composite(WHITE, [{ color: BLACK, groups: [1] }, { color: [0, 0, 255, 0.5], groups: [] }], { 1: 0.5 });
    // group: 50% black over white = 127.5 grey; then 50% blue on top.
    expect(c.slice(0, 3).map((v) => Math.round(v * 100) / 100)).toEqual([63.75, 63.75, 191.25]);
  });

  it('nests groups', () => {
    const c = composite(WHITE, [{ color: BLACK, groups: [1, 2] }], { 1: 0.5, 2: 0.5 });
    expect(c[0]).toBeCloseTo(255 * 0.75, 6);
  });
});

describe('formatting', () => {
  it('truncates to 2 decimals without float noise', () => {
    expect(truncate2(2.85)).toBe(2.85);
    expect(truncate2(4.499)).toBe(4.49);
    expect(truncate2(3)).toBe(3);
  });
  it('prints hex', () => expect(toHex([255, 0, 127.6, 1])).toBe('#ff0080'));
});
