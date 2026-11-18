import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { captureContrast } from '../../src/browser/contrast.js';
import { captureSnapshot } from '../../src/browser/snapshot.js';
import type { Box, DriverPage, Snapshot } from '../../src/types.js';

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.setViewportSize({ width: 800, height: 600 });
});
afterAll(async () => { await browser.close(); });

function wrap(p: Page): DriverPage {
  return {
    status: 200,
    capabilities: { mainWorld: true },
    url: async () => p.url(),
    evaluate: <T>(e: string) => p.evaluate(e) as Promise<T>,
    addStyle: async () => {},
    waitForNetworkIdle: async () => {},
    runSetup: async () => {},
    close: async () => {},
  };
}

async function measure(html: string, keep = true): Promise<Snapshot> {
  await page.setContent('<style>body{margin:0;font:16px/24px Arial,sans-serif}</style>' + html);
  const s = await captureSnapshot(wrap(page), { url: 'http://test/', viewport: 800 }, [], keep);
  await captureContrast(wrap(page), s);
  return s;
}

const textBox = (s: Snapshot, text: string): Box => {
  const b = s.boxes.find((x) => x.kind === 'text' && x.locator.text?.includes(text));
  if (!b) throw new Error(`no text box "${text}" in ${JSON.stringify(s.boxes.map((x) => x.locator))}`);
  return b;
};

it('measures grey text on a white page', async () => {
  const s = await measure('<p style="color:#999">Updated 3 days ago</p>');
  const c = textBox(s, 'Updated').contrast!;
  expect(c.unverified).toBeNull();
  expect(c.samples).toHaveLength(1);
  expect(c.samples[0]).toMatchObject({ what: 'text', fg: '#999999', bg: '#ffffff', large: false, gradient: false });
  expect(c.samples[0].ratio).toBeCloseTo(2.85, 2);
});

it('uses the solid background of a parent', async () => {
  const s = await measure('<div style="background:#1f2328;padding:8px"><span style="color:#fff">Dark card</span></div>');
  expect(textBox(s, 'Dark card').contrast!.samples[0]).toMatchObject({ fg: '#ffffff', bg: '#1f2328' });
});

it('samples each differently coloured run of text', async () => {
  const s = await measure('<p style="color:#000">Read the <a href="#" style="color:#aaa">docs</a> first</p>');
  const fgs = textBox(s, 'Read').contrast!.samples.map((x) => x.fg);
  expect(fgs).toContain('#000000');
  expect(fgs).toContain('#aaaaaa');
});

it('leaves boxes alone when the measure pass kept nothing', async () => {
  const s = await measure('<p style="color:#999">No stash</p>', false);
  expect(textBox(s, 'No stash').contrast).toBeUndefined();
});

it('cleans up after itself', async () => {
  await measure('<p>Clean</p>');
  expect(await page.evaluate('typeof window.__uilintBoxes')).toBe('undefined');
});

const first = (s: Snapshot, text: string) => textBox(s, text).contrast!.samples[0];
const near = (hex: string, want: string) => {
  const p = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [a, b] = [p(hex), p(want)];
  return a.every((v, i) => Math.abs(v - b[i]) <= 1);
};

it('composites semi-transparent layers', async () => {
  const s = await measure('<div style="background:rgba(0,0,0,.5);padding:8px"><span style="color:#fff">Tinted</span></div>');
  expect(near(first(s, 'Tinted').bg, '#808080')).toBe(true);
});

it('fades text with opacity on the text', async () => {
  const s = await measure('<p style="color:#000;opacity:.5">Faded</p>');
  const c = first(s, 'Faded');
  expect(near(c.fg, '#808080')).toBe(true);
  expect(c.bg).toBe('#ffffff');
});

it('fades a parent with a background as one group', async () => {
  const s = await measure('<div style="background:#000;color:#fff;opacity:.5;padding:8px"><span>Group</span></div>');
  const c = first(s, 'Group');
  expect(c.fg).toBe('#ffffff');
  expect(near(c.bg, '#808080')).toBe(true);
});

it('uses a positioned sibling behind the text', async () => {
  const s = await measure(`<div style="position:relative;padding:20px">
    <div style="position:absolute;inset:0;background:#111"></div>
    <h1 style="position:relative;color:#fff;margin:0">Hero title</h1></div>`);
  expect(first(s, 'Hero title').bg).toBe('#111111');
});

it('sees through pointer-events none to the layer below the text', async () => {
  const s = await measure(`<div style="position:relative;padding:20px">
    <div style="position:absolute;inset:0;background:#111;pointer-events:none"></div>
    <h1 style="position:relative;color:#fff;margin:0;pointer-events:none">Ghost title</h1></div>`);
  expect(first(s, 'Ghost title').bg).toBe('#111111');
});

it('propagates the body background to the page canvas', async () => {
  const s = await measure('<style>body{background:#111;color:#fff;height:20px}</style><p style="margin:0;padding-top:200px">Below body</p>');
  expect(first(s, 'Below body').bg).toBe('#111111');
});

it('uses a dark canvas for a dark colour scheme', async () => {
  const s = await measure('<style>:root{color-scheme:dark}</style><p style="color:#eee">Dark scheme</p>');
  expect(first(s, 'Dark scheme').bg).toBe('#121212');
});

it('converts oklch colours', async () => {
  const s = await measure('<p style="color:oklch(0.75 0 0)">Modern grey</p>');
  const c = first(s, 'Modern grey');
  expect(c.fg).toMatch(/^#[0-9a-f]{6}$/);
  expect(c.ratio).toBeLessThan(4.5);
  expect(c.ratio).toBeGreaterThan(1.5);
});

it('measures text below the fold and restores the scroll position', async () => {
  const s = await measure('<div style="height:3000px"></div><p style="color:#999">Way down</p>');
  expect(textBox(s, 'Way down').contrast).toMatchObject({ unverified: null });
  expect(first(s, 'Way down').ratio).toBeCloseTo(2.85, 2);
  expect(await page.evaluate('window.scrollY')).toBe(0);
});

it('flags large text', async () => {
  const s = await measure('<p style="font:700 19px Arial">Bold big</p><p style="font:19px Arial">Plain big</p>');
  expect(first(s, 'Bold big').large).toBe(true);
  expect(first(s, 'Plain big').large).toBe(false);
});

it('skips text in disabled controls', async () => {
  const s = await measure('<button disabled style="color:#ccc">Off</button><p aria-disabled="true" style="color:#ccc">Also off</p>');
  expect(textBox(s, 'Off').contrast).toBeUndefined();
  expect(textBox(s, 'Also off').contrast).toBeUndefined();
});

it('measures text inside a shadow root', async () => {
  await page.setContent('<style>body{margin:0}</style><div id="host"></div>');
  await page.evaluate(`document.getElementById('host').attachShadow({ mode: 'open' }).innerHTML = '<div style="background:#222;padding:8px"><span style="color:#555">Shadowed</span></div>'`);
  const s = await captureSnapshot(wrap(page), { url: 'http://test/', viewport: 800 }, [], true);
  await captureContrast(wrap(page), s);
  expect(first(s, 'Shadowed').bg).toBe('#222222');
});

it('ignores invisible text', async () => {
  const s = await measure('<p style="color:transparent">Invisible</p>');
  expect(textBox(s, 'Invisible').contrast).toBeUndefined();
});
