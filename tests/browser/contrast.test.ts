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
