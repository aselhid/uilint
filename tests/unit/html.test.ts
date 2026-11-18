import { beforeEach, expect, it } from 'vitest';
import type { UrlReport } from '../../src/report/format.js';
import { renderReport, type Capture } from '../../src/report/html.js';
import { mergeViewports } from '../../src/report/merge.js';
import type { Box, Finding } from '../../src/types.js';
import { box, resetBoxIds, snap } from '../helpers/boxes.js';
import { pngHeader } from '../helpers/png.js';

beforeEach(resetBoxIds);
const url = 'http://localhost:3000/';

function setup(o: { png?: Buffer | null; text?: string; scrollWidth?: number; findings?: (b: Box[]) => Finding[] } = {}) {
  const boxes = [
    box({ x: 20, y: 20, w: 100, h: 20, kind: 'text', locator: { selector: '.title', text: 'Title', components: [], source: null } }),
    box({ x: 23, y: 60, w: 100, h: 20, kind: 'text', locator: { selector: '.label', text: o.text ?? 'Revenue', components: ['StatTile'], source: 'src/StatTile.tsx:3' } }),
    box({ x: 20, y: 100, w: 100, h: 20, kind: 'text', locator: { selector: '.note', text: 'Note', components: [], source: null } }),
  ];
  const findings = o.findings?.(boxes) ?? [
    { rule: 'alignment', check: 'left', severity: 'error', message: 'left edge 3px off from 2 stacked items', measured: 3, expected: 0, boxIds: [1], peerIds: [0, 2] },
  ];
  const snapshot = snap(boxes, { viewport: 375, scrollWidth: o.scrollWidth ?? 375, clientWidth: 375 });
  const violations = mergeViewports(url, [{ snapshot, findings }]);
  const reports: UrlReport[] = [{ url, finalUrl: url, baselined: 0, violations }];
  const captures: Capture[] = [{ url, viewport: 375, snapshot, png: o.png === undefined ? pngHeader(375, 900) : o.png }];
  return renderReport({ version: '9.9.9', reports, notes: [], captures });
}

const count = (s: string, needle: string) => s.split(needle).length - 1;

it('embeds each screenshot once however many findings use it', () => {
  const html = setup({ findings: () => [
    { rule: 'alignment', check: 'left', severity: 'error', message: 'a', measured: 3, expected: 0, boxIds: [1], peerIds: [0, 2] },
    { rule: 'size-consistency', check: 'width', severity: 'warn', message: 'b', measured: 100, expected: 98, boxIds: [2], peerIds: [0] },
  ] });
  expect(count(html, 'data:image/png;base64,')).toBe(1);
  expect(count(html, '<section class="finding')).toBe(2);
});

it('shows the same text the CLI prints for each finding', () => {
  const html = setup();
  expect(html).toContain('error  alignment  left edge 3px off from 2 stacked items  @375');
  expect(html).toContain('.label &quot;Revenue&quot;  &lt;StatTile&gt;  src/StatTile.tsx:3');
});

it('escapes element text', () => {
  const html = setup({ text: '<b>&"x"' });
  expect(html).toContain('&lt;b&gt;&amp;&quot;x&quot;');
  expect(html).not.toContain('<b>&');
});

it('sizes a 2x screenshot by the page CSS width', () => {
  expect(setup({ png: pngHeader(750, 2000) })).toMatch(/<image [^>]*width="375" height="1000"/);
});

it('outlines the offender red and its peers blue', () => {
  const html = setup();
  expect(html).toMatch(/<rect [^>]*class="offender"/);
  expect(count(html, 'class="peer"')).toBeGreaterThanOrEqual(2);
  expect(html).toContain('#e5484d');
  expect(html).toContain('#3e63dd');
  expect(html).toContain('3px off');
});

it('draws a wireframe when the adapter has no screenshots', () => {
  const html = setup({ png: null });
  expect(html).not.toContain('data:image/png');
  expect(html).toContain('screenshots unavailable for this adapter; showing measured boxes');
  expect(count(html, 'class="wire')).toBeGreaterThanOrEqual(3);
});

it('falls back to the wireframe for a finding below the captured area', () => {
  const html = setup({ png: pngHeader(375, 50) });
  expect(html).toContain('below the captured area');
});

it('makes no network requests', () => {
  const html = setup();
  expect(html).not.toMatch(/src="http|<link|@import|url\(http/);
});

it('says no problems found for a clean page', () => {
  const html = setup({ findings: () => [] });
  expect(html).toContain('no problems found');
  expect(html).toContain('uilint 9.9.9');
});
