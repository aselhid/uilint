import { beforeEach, describe, expect, it } from 'vitest';
import { chains, contains, isWithin, rowPairs, scopeKey, stackedPairs } from '../../src/geometry/relations.js';
import { box, resetBoxIds } from '../helpers/boxes.js';

beforeEach(resetBoxIds);

describe('stackedPairs', () => {
  it('pairs stacked boxes in one scope with their gap', () => {
    const a = box({ x: 0, y: 0, w: 100, h: 20 }), b = box({ x: 3, y: 30, w: 100, h: 20 });
    expect(stackedPairs([a, b], { maxGap: 48 })).toEqual([{ a, b, gap: 10 }]);
  });

  it('uses layoutRect for gaps', () => {
    const a = box({ x: 0, y: 4, w: 100, h: 12, layoutRect: { x: 0, y: 0, width: 100, height: 20 } });
    const b = box({ x: 0, y: 36, w: 100, h: 12, layoutRect: { x: 0, y: 32, width: 100, height: 20 } });
    expect(stackedPairs([a, b], { maxGap: 48 })[0].gap).toBe(12);
  });

  it('never pairs boxes in different containers or layers', () => {
    const a = box({ x: 0, y: 0, w: 100, h: 20, containerId: 7 }), b = box({ x: 0, y: 30, w: 100, h: 20 });
    const c = box({ x: 0, y: 60, w: 100, h: 20, layer: 1 });
    expect(stackedPairs([a, b, c], { maxGap: 48 })).toEqual([]);
  });

  it('ignores pairs beyond maxGap', () =>
    expect(stackedPairs([box({ x: 0, y: 0, w: 10, h: 10 }), box({ x: 0, y: 100, w: 10, h: 10 })], { maxGap: 48 })).toEqual([]));

  it('ignores boxes without horizontal overlap', () =>
    expect(stackedPairs([box({ x: 0, y: 0, w: 10, h: 10 }), box({ x: 20, y: 20, w: 10, h: 10 })], { maxGap: 48 })).toEqual([]));

  it('skips pairs where one rect contains the other', () =>
    expect(stackedPairs([box({ x: 0, y: 0, w: 100, h: 100 }), box({ x: 10, y: 10, w: 10, h: 10 })], { maxGap: 48 })).toEqual([]));

  it('links only nearest neighbours and builds chains', () => {
    const [a, b, c] = [0, 30, 60].map((y) => box({ x: 0, y, w: 50, h: 20 }));
    const pairs = stackedPairs([a, b, c], { maxGap: 48 });
    expect(pairs.map((p) => [p.a.id, p.b.id])).toEqual([[a.id, b.id], [b.id, c.id]]);
    expect(chains(pairs)).toEqual([[a, b, c]]);
  });
});

describe('rowPairs', () => {
  it('pairs boxes in a row', () => {
    const a = box({ x: 0, y: 0, w: 40, h: 36 }), b = box({ x: 48, y: 0, w: 40, h: 37 });
    expect(rowPairs([a, b], { maxGap: 48 })).toEqual([{ a, b, gap: 8 }]);
  });
});

describe('chains', () => {
  it('starts a new chain at a box with two incoming links', () => {
    const [a, b, c] = [0, 1, 2].map((i) => box({ x: i * 10, y: 0, w: 5, h: 5 }));
    expect(chains([{ a, b: c, gap: 0 }, { a: b, b: c, gap: 0 }]).map((ch) => ch.map((x) => x.id))).toEqual([[a.id], [b.id], [c.id]]);
  });
});

describe('helpers', () => {
  it('scopeKey combines layer and container', () => {
    expect(scopeKey(box({ x: 0, y: 0, w: 1, h: 1, layer: 2, containerId: 5 }))).toBe('2:5');
    expect(scopeKey(box({ x: 0, y: 0, w: 1, h: 1 }))).toBe('0:root');
  });
  it('contains with tolerance', () => {
    expect(contains({ x: 0, y: 0, width: 10, height: 10 }, { x: -0.4, y: 0, width: 10, height: 10 })).toBe(true);
    expect(contains({ x: 0, y: 0, width: 10, height: 10 }, { x: -1, y: 0, width: 10, height: 10 })).toBe(false);
  });
  it('isWithin walks containers', () => {
    const a = box({ x: 0, y: 0, w: 10, h: 10 }), b = box({ x: 0, y: 0, w: 5, h: 5, containerId: a.id });
    const c = box({ x: 0, y: 0, w: 2, h: 2, containerId: b.id });
    const byId = new Map([a, b, c].map((x) => [x.id, x]));
    expect(isWithin(c, a.id, byId)).toBe(true);
    expect(isWithin(a, c.id, byId)).toBe(false);
  });
});

describe('performance', () => {
  it('handles 2,000 boxes in one scope in under 2 seconds', () => {
    const many = Array.from({ length: 2000 }, (_, i) => box({ x: (i % 4) * 120, y: Math.floor(i / 4) * 30, w: 100, h: 20 }));
    const t = performance.now();
    stackedPairs(many, { maxGap: 48 });
    rowPairs(many, { maxGap: 48 });
    expect(performance.now() - t).toBeLessThan(2000);
  });
});
