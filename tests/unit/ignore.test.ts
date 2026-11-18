import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyIgnores, loadIgnore, parseIgnore } from '../../src/exceptions/ignore.js';
import { hitsOf, mergeViewports } from '../../src/report/merge.js';
import type { Finding } from '../../src/types.js';
import { box, snap } from '../helpers/boxes.js';

it('keeps the report geometry of the viewports an ignore entry leaves', () => {
  const b = [box({ x: 0, y: 0, w: 10, h: 10, id: 0 }), box({ x: 3, y: 20, w: 10, h: 10, id: 1, locator: { selector: 'p', text: 'Revenue', components: [], source: null } })];
  const f: Finding = { rule: 'alignment', check: 'left', severity: 'error', message: 'm', measured: 3, expected: 0, boxIds: [1], peerIds: [0] };
  const vs = mergeViewports('http://x/', [{ snapshot: snap(b, { viewport: 375 }), findings: [f] }, { snapshot: snap(b, { viewport: 1280 }), findings: [f] }]);
  const { kept } = applyIgnores(vs, parseIgnore('alignment | text:Revenue | 375 | phone layout\n', 'uilint.ignore'));
  expect(kept[0].viewports).toEqual([1280]);
  expect(hitsOf(kept[0]).map((h) => h.viewport)).toEqual([1280]);
});
import { loc, violation } from '../helpers/violations.js';

describe('parseIgnore', () => {
  it('parses entries and comments', () =>
    expect(parseIgnore('# owner only\n\nspill | component:CardHeader | * | badge on purpose\n', 'uilint.ignore')).toEqual([
      { line: 3, rule: 'spill', matcher: { type: 'component', value: 'CardHeader' }, viewport: '*', reason: 'badge on purpose' },
    ]));
  it('requires a reason', () =>
    expect(() => parseIgnore('alignment | text:Revenue | * |  ', 'uilint.ignore')).toThrow(/uilint.ignore:1: .*reason/));
  it('rejects an unknown matcher type', () =>
    expect(() => parseIgnore('alignment | class:x | * | r', 'f')).toThrow(/f:1: .*matcher/));
  it('rejects a bad viewport', () =>
    expect(() => parseIgnore('alignment | text:x | wide | r', 'f')).toThrow(/f:1: .*viewport/));
  it('rejects a wrong number of fields', () =>
    expect(() => parseIgnore('alignment | text:x', 'f')).toThrow(/f:1: .*4 fields/));
  it('rejects an unknown rule or check', () =>
    expect(() => parseIgnore('aligment | text:x | * | r', 'f')).toThrow(/f:1: .*unknown rule/));
  it('accepts the contrast rule and its checks', () =>
    expect(['contrast', 'ratio', 'placeholder', 'unverified'].map((r) => parseIgnore(`${r} | text:x | * | brand colour`, 'f')[0].rule))
      .toEqual(['contrast', 'ratio', 'placeholder', 'unverified']));
  it('keeps pipes inside the reason', () =>
    expect(parseIgnore('* | text:x | 375 | a | b', 'f')[0]).toMatchObject({ rule: '*', viewport: 375, reason: 'a | b' }));
});

describe('applyIgnores', () => {
  it('drops a matching violation and reports the entry as used', () => {
    const { kept, used } = applyIgnores([violation(), violation({ elements: [loc('.x', 'Other')] })],
      parseIgnore('alignment | component:StatTile | * | ok', 'f'));
    expect(kept).toHaveLength(1);
    expect([...used]).toEqual([1]);
  });
  it('matches an overflow sub-check by its check name', () => {
    const v = violation({ rule: 'overflow', check: 'spill', elements: [loc('.dot', null, ['CardHeader'])] });
    expect(applyIgnores([v], parseIgnore('spill | component:CardHeader | * | ok', 'f')).kept).toEqual([]);
  });
  it('matches by text substring and by exact selector', () => {
    expect(applyIgnores([violation()], parseIgnore('* | text:Reven | * | ok', 'f')).kept).toEqual([]);
    expect(applyIgnores([violation()], parseIgnore('* | selector:.stat-label | * | ok', 'f')).kept).toEqual([]);
    expect(applyIgnores([violation()], parseIgnore('* | selector:.stat | * | ok', 'f')).kept).toHaveLength(1);
  });
  it('removes only the ignored viewport', () => {
    const { kept } = applyIgnores([violation({ viewports: [375, 1280] })], parseIgnore('alignment | text:Revenue | 375 | ok on mobile', 'f'));
    expect(kept[0].viewports).toEqual([1280]);
  });
  it('reports which entries were used', () => {
    const { used } = applyIgnores([violation()], parseIgnore('alignment | text:Revenue | * | a\nspacing | text:Revenue | * | b', 'f'));
    expect([...used]).toEqual([1]);
  });
});

it('loads a missing ignore file as empty', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uilint-ign-'));
  expect(await loadIgnore(join(dir, 'uilint.ignore'))).toEqual([]);
  await writeFile(join(dir, 'uilint.ignore'), 'overflow | text:x | * | r\n');
  expect(await loadIgnore(join(dir, 'uilint.ignore'))).toHaveLength(1);
});
