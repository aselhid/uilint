import { beforeEach, expect, it } from 'vitest';
import { contrast } from '../../src/rules/contrast.js';
import type { ContrastInfo, ContrastSample } from '../../src/types.js';
import { box, resetBoxIds, snap } from '../helpers/boxes.js';

beforeEach(resetBoxIds);
const o = contrast.defaults;

const sample = (s: Partial<ContrastSample> = {}): ContrastSample =>
  ({ what: 'text', ratio: 2.8506, large: false, fg: '#999999', bg: '#ffffff', gradient: false, ...s });
const text = (c: ContrastInfo | undefined) => box({ x: 0, y: 0, w: 100, h: 16, kind: 'text', contrast: c });

it('reports the worst failing sample', () => {
  const t = text({ samples: [sample({ ratio: 7 }), sample()], unverified: null });
  expect(contrast.check(snap([t]), o, 'error')).toEqual([{
    rule: 'contrast', check: 'ratio', severity: 'error', measured: 2.85, expected: 4.5, boxIds: [t.id], peerIds: [],
    message: 'text contrast 2.85:1, needs 4.5:1 (#999999 on #ffffff)',
  }]);
});

it('compares each sample with its own minimum', () => {
  // 3.2 on large text passes (min 3); 4.4 on normal text fails (min 4.5), so it's the worse one.
  const t = text({ samples: [sample({ ratio: 3.2, large: true }), sample({ ratio: 4.4, fg: '#777777' })], unverified: null });
  expect(contrast.check(snap([t]), o, 'error')[0]).toMatchObject({ measured: 4.4, expected: 4.5 });
});

it('names the large-text minimum', () =>
  expect(contrast.check(snap([text({ samples: [sample({ ratio: 2.5, large: true })], unverified: null })]), o, 'error')[0].message)
    .toBe('text contrast 2.5:1, needs 3:1 for large text (#999999 on #ffffff)'));

it('uses the AAA minimums when asked', () =>
  expect(contrast.check(snap([text({ samples: [sample({ ratio: 5 })], unverified: null })]), { ...o, level: 'AAA' }, 'error')[0])
    .toMatchObject({ measured: 5, expected: 7 }));

it('says input text for a control value', () =>
  expect(contrast.check(snap([text({ samples: [sample({ what: 'value' })], unverified: null })]), o, 'error')[0].message)
    .toMatch(/^input text contrast 2\.85:1/));

it('reports a placeholder under its own check', () =>
  expect(contrast.check(snap([text({ samples: [sample({ what: 'placeholder', fg: '#bbbbbb', ratio: 1.92 })], unverified: null })]), o, 'error')[0])
    .toMatchObject({ check: 'placeholder', message: 'placeholder contrast 1.92:1, needs 4.5:1 (#bbbbbb on #ffffff)' }));

it('names a gradient background', () =>
  expect(contrast.check(snap([text({ samples: [sample({ gradient: true, bg: '#cccccc' })], unverified: null })]), o, 'error')[0].message)
    .toBe('text contrast 2.85:1, needs 4.5:1 (#999999 on #cccccc, worst gradient stop)'));

it('reports nothing for passing text or boxes without contrast data', () =>
  expect(contrast.check(snap([text({ samples: [sample({ ratio: 4.5 })], unverified: null }), text(undefined)]), o, 'error')).toEqual([]));

it('warns when the background could not be known', () => {
  const t = text({ samples: [], unverified: 'image' });
  expect(contrast.check(snap([t]), o, 'error')).toEqual([{
    rule: 'contrast', check: 'unverified', severity: 'warn', measured: 0, expected: null, boxIds: [t.id], peerIds: [],
    message: 'text over an image, contrast not checked',
  }]);
});

it('reports a measured failure instead of an unverified warning', () =>
  expect(contrast.check(snap([text({ samples: [sample()], unverified: 'gradient' })]), o, 'error').map((f) => f.check)).toEqual(['ratio']));

it('reports a failing value and a failing placeholder on separate boxes', () =>
  expect(contrast.check(snap([text({ samples: [sample()], unverified: null }), text({ samples: [sample({ what: 'placeholder' })], unverified: null })]), o, 'error')
    .map((f) => f.check)).toEqual(['ratio', 'placeholder']));

it('lets each check be switched off', () => {
  const s = snap([text({ samples: [sample()], unverified: null }), text({ samples: [], unverified: 'video' })]);
  expect(contrast.check(s, { ...o, ratio: 'off' }, 'error').map((f) => f.check)).toEqual(['unverified']);
  expect(contrast.check(s, { ...o, unverified: 'off' }, 'error').map((f) => f.check)).toEqual(['ratio']);
});

it('caps severity at the rule severity', () =>
  expect(contrast.check(snap([text({ samples: [sample()], unverified: null })]), o, 'warn')[0].severity).toBe('warn'));
