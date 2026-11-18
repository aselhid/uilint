import { beforeEach, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config.js';
import { RULES, runRules } from '../../src/rules/index.js';
import { box, resetBoxIds, snap } from '../helpers/boxes.js';

beforeEach(resetBoxIds);
const row = (y: number) => box({ x: 0, y, w: 300, h: 40 });
const page = () => snap([row(0), row(56), row(112), row(166), box({ x: 0, y: 300, w: 10, h: 10, kind: 'text', clipped: { x: 4, y: 0 } })]);

it('registers the four rules in order', () =>
  expect(RULES.map((r) => r.name)).toEqual(['alignment', 'spacing', 'size-consistency', 'overflow']));

it('runs every rule by default', () =>
  expect(new Set(runRules(page(), DEFAULT_CONFIG).map((f) => f.rule))).toEqual(new Set(['spacing', 'overflow'])));

it('skips rules set to off', () =>
  expect(runRules(page(), { ...DEFAULT_CONFIG, rules: { spacing: 'off' } }).map((f) => f.rule)).toEqual(['overflow']));

it('returns findings in a stable order', () => {
  const s = page();
  expect(runRules(s, DEFAULT_CONFIG)).toEqual(runRules(s, DEFAULT_CONFIG));
  expect(runRules(s, DEFAULT_CONFIG).map((f) => f.rule)).toEqual(['spacing', 'overflow']);
});
