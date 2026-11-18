import { beforeEach, describe, expect, it } from 'vitest';
import { collapseRepeats, fingerprint, hitsOf, mergeViewports, sortViolations } from '../../src/report/merge.js';
import type { Finding, Snapshot } from '../../src/types.js';
import { box, resetBoxIds, snap } from '../helpers/boxes.js';
import { loc, violation } from '../helpers/violations.js';

beforeEach(resetBoxIds);
const url = 'http://localhost:3000/dashboard?tab=1';

function run(viewport: number, findings: Finding[]): { snapshot: Snapshot; findings: Finding[] } {
  resetBoxIds();
  const boxes = [
    box({ x: 16, y: 0, w: 100, h: 16, locator: { selector: '.card-title', text: 'Monthly revenue', components: ['CardHeader'], source: null } }),
    box({ x: 19, y: 30 + viewport / 1000, w: 100, h: 16, locator: { selector: '.stat-label', text: 'Revenue', components: ['StatTile'], source: 'src/StatTile.tsx:3' } }),
  ];
  return { snapshot: snap(boxes, { viewport }), findings };
}
const finding: Finding = { rule: 'alignment', check: 'left', severity: 'error', message: 'left edge 3px off from 1 stacked item', measured: 3, expected: 0, boxIds: [1], peerIds: [0] };

describe('mergeViewports', () => {
  it('merges the same problem across viewports', () => {
    const v = mergeViewports(url, [run(375, [finding]), run(1280, [finding])]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({
      url, rule: 'alignment', viewports: [375, 1280], count: 1, peerCount: 1,
      elements: [{ selector: '.stat-label', text: 'Revenue' }], peers: [{ selector: '.card-title' }],
      anchor: { y: 30.375, x: 19 },
    });
    expect(v[0].fingerprint).toMatch(/^[0-9a-f]{12}$/);
  });

  it('keeps different measurements apart', () => {
    const v = mergeViewports(url, [run(375, [finding]), run(1280, [{ ...finding, measured: 2, message: 'x' }])]);
    expect(v.map((x) => x.viewports)).toEqual([[375], [1280]]);
  });

  it('keeps at most 3 peers but counts all of them', () => {
    resetBoxIds();
    const boxes = Array.from({ length: 6 }, (_, i) => box({ x: 0, y: i * 30, w: 10, h: 10 }));
    const v = mergeViewports(url, [{ snapshot: snap(boxes), findings: [{ ...finding, boxIds: [5], peerIds: [0, 1, 2, 3, 4] }] }]);
    expect(v[0].peers).toHaveLength(3);
    expect(v[0].peerCount).toBe(5);
  });
});

describe('fingerprint', () => {
  const base = { rule: 'alignment' as const, check: 'left', elements: [loc('.a', 'Revenue', ['StatTile'])] };
  it('ignores pixel values, viewports and the query string', () =>
    expect(fingerprint(url, { ...base, measured: 2 } as never)).toBe(fingerprint('http://localhost:3000/dashboard', { ...base, measured: 3 } as never)));
  it('changes with the element', () =>
    expect(fingerprint(url, base)).not.toBe(fingerprint(url, { ...base, elements: [loc('.a', 'Profit', ['StatTile'])] })));
  it('uses text over selector so reordering siblings keeps it', () =>
    expect(fingerprint(url, { ...base, elements: [loc('li:nth-of-type(2)', 'Revenue', ['StatTile'])] }))
      .toBe(fingerprint(url, { ...base, elements: [loc('li:nth-of-type(5)', 'Revenue', ['StatTile'])] })));
});

describe('collapseRepeats', () => {
  it('collapses repeated list items into one entry with a count', () => {
    const vs = Array.from({ length: 12 }, (_, i) => violation({
      rule: 'spacing', check: 'gap', elements: [loc(`li.row:nth-of-type(${i + 1})`, `Order ${i}`, ['OrderRow'])], anchor: { y: 100 - i, x: 0 },
    }));
    const out = collapseRepeats(vs);
    expect(out).toEqual([expect.objectContaining({ count: 12 })]);
    expect(out[0].elements[0].text).toBe('Order 11');
  });
  it('does not collapse different measurements', () =>
    expect(collapseRepeats([violation(), violation({ measured: 2 })])).toHaveLength(2));
});

describe('hitsOf', () => {
  it('records a hit per viewport', () => {
    const [v] = mergeViewports(url, [run(375, [finding]), run(1280, [finding])]);
    expect(hitsOf(v).map((h) => h.viewport)).toEqual([375, 1280]);
    expect(hitsOf(v)[0].offenders.map((b) => b.id)).toEqual([1]);
    expect(hitsOf(v)[0].peers.map((b) => b.id)).toEqual([0]);
    expect(hitsOf(v)[1].finding).toBe(finding);
  });

  it('keeps every peer, not just the three named', () => {
    const boxes = Array.from({ length: 6 }, (_, i) => box({ x: 0, y: i * 30, w: 10, h: 10 }));
    const [v] = mergeViewports(url, [{ snapshot: snap(boxes), findings: [{ ...finding, boxIds: [5], peerIds: [0, 1, 2, 3, 4] }] }]);
    expect(v.peers).toHaveLength(3);
    expect(hitsOf(v)[0].peers).toHaveLength(5);
  });

  it('gives a collapsed group the hits of all its instances, first instance first', () => {
    const rows = Array.from({ length: 3 }, (_, i) =>
      box({ x: 0, y: i * 40, w: 100, h: 20, locator: { selector: `li.row:nth-of-type(${i + 1})`, text: 'Order', components: ['OrderRow'], source: null } }));
    const findings: Finding[] = [2, 1, 0].map((i) => ({ ...finding, rule: 'spacing', check: 'gap', boxIds: [i], peerIds: [] }));
    const [c] = collapseRepeats(mergeViewports(url, [{ snapshot: snap(rows), findings }]));
    expect(c.count).toBe(3);
    expect(hitsOf(c).map((h) => h.offenders[0].id)).toEqual([0, 2, 1]);
  });

  it('adds nothing to the JSON shape', () => {
    const [v] = mergeViewports(url, [run(375, [finding])]);
    expect(Object.keys(JSON.parse(JSON.stringify(v)))).not.toContain('hits');
  });

  it('is empty for a violation it did not make', () => expect(hitsOf(violation())).toEqual([]));
});

describe('sortViolations', () => {
  it('lists errors first, then by url, rule and position', () => {
    const vs = [
      violation({ severity: 'warn', anchor: { y: 0, x: 0 }, message: 'w' }),
      violation({ rule: 'overflow', anchor: { y: 5, x: 0 }, message: 'o' }),
      violation({ url: 'http://b/', anchor: { y: 0, x: 0 }, message: 'b' }),
      violation({ anchor: { y: 50, x: 0 }, message: 'a50' }),
      violation({ anchor: { y: 10, x: 0 }, message: 'a10' }),
    ];
    expect(sortViolations(vs, ['http://localhost:3000/dashboard', 'http://b/']).map((v) => v.message)).toEqual(['a10', 'a50', 'o', 'b', 'w']);
  });
});
