import { chromium, type Browser, type Page } from 'playwright';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { captureSnapshot } from '../../src/browser/snapshot.js';
import type { DriverPage, Snapshot } from '../../src/types.js';

let browser: Browser;
let page: Page;
beforeAll(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.setViewportSize({ width: 800, height: 900 });
});
afterAll(async () => { await browser.close(); });

function wrap(p: Page, mainWorld = true): DriverPage {
  return {
    status: 200,
    capabilities: { mainWorld },
    url: async () => p.url(),
    evaluate: <T>(e: string) => p.evaluate(e) as Promise<T>,
    addStyle: async () => {},
    waitForNetworkIdle: async () => {},
    runSetup: async () => {},
    close: async () => {},
  };
}

async function snap(html: string, exclude: string[] = []): Promise<Snapshot> {
  await page.setContent('<style>body{margin:0;font-family:Arial,sans-serif}</style>' + html);
  return captureSnapshot(wrap(page), { url: 'http://test/', viewport: 800 }, exclude);
}

it('skips plain wrappers and measures text by its glyphs', async () => {
  const s = await snap(`<div style="padding:20px"><div><p style="margin:0;font:16px/24px Arial">Hello</p></div></div>`);
  expect(s.boxes).toHaveLength(1);
  const [t] = s.boxes;
  expect(t).toMatchObject({ kind: 'text', containerId: null, layer: 0, textAlign: 'left', tag: 'p' });
  expect(t.rect.x).toBe(20);
  expect(t.layoutRect.height).toBeCloseTo(24, 0);
  expect(t.layoutRect.y).toBeCloseTo(20, 0);
  expect(t.baseline).toBeGreaterThan(t.rect.y);
  expect(t.baseline).toBeLessThan(t.rect.y + t.rect.height);
  expect(t.locator.text).toBe('Hello');
  expect(s.page).toMatchObject({ url: 'http://test/', viewport: 800, status: 200, clientWidth: 800, scrollWidth: 800 });
});

it('treats a styled card as a container', async () => {
  const s = await snap(`<div style="background:#eee;padding:16px"><span>Hi</span></div>`);
  expect(s.boxes.map((b) => b.kind)).toEqual(['surface', 'text']);
  expect(s.boxes[1].containerId).toBe(s.boxes[0].id);
});

it('classifies media and controls', async () => {
  const s = await snap(`<img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" width="20" height="20"><svg width="10" height="10"><rect width="10" height="10"/></svg><input><button>Go</button>`);
  expect(s.boxes.map((b) => [b.kind, b.tag])).toEqual([
    ['media', 'img'], ['media', 'svg'], ['control', 'input'], ['control', 'button'], ['text', 'button'],
  ]);
  expect(s.boxes[4].containerId).toBe(s.boxes[3].id);
});

it('records one rect per line for wrapped text', async () => {
  const s = await snap(`<p style="width:80px;margin:0">one two three four five six</p>`);
  expect(s.boxes[0].lines.length).toBeGreaterThan(1);
});

it('does not measure screen-reader-only text', async () => {
  const s = await snap(`<span style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">skip</span><p>keep</p>`);
  expect(s.boxes.map((b) => b.locator.text)).toEqual(['keep']);
});

it('skips hidden and transparent content', async () => {
  const s = await snap(`<p style="display:none">a</p><p style="visibility:hidden">b</p><div style="opacity:0"><p>c</p></div><p>d</p>`);
  expect(s.boxes.map((b) => b.locator.text)).toEqual(['d']);
});

it('reports clipped text and ellipsis', async () => {
  const s = await snap(`<div style="width:100px;overflow:hidden;white-space:nowrap"><span>${'x'.repeat(60)}</span></div>
    <div style="width:100px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${'y'.repeat(60)}</div>`);
  expect(s.boxes[0].clipped!.x).toBeGreaterThan(100);
  expect(s.boxes[1].ellipsis).toBe(true);
  expect(s.boxes[1].clipped).toBeNull();
});

it('puts dialog content on its own layer', async () => {
  const s = await snap(`<p>page</p><div role="dialog"><p>modal</p></div><div style="position:fixed;top:0"><p>bar</p></div>`);
  expect(s.boxes.map((b) => b.layer)).toEqual([0, 1, 2]);
});

it('honours exclude selectors', async () => {
  const s = await snap(`<div class="widget"><p>skip</p></div><p>keep</p>`, ['.widget']);
  expect(s.boxes.map((b) => b.locator.text)).toEqual(['keep']);
});

it('measures text inside open shadow roots', async () => {
  await page.setContent('<div id="host"></div>');
  await page.evaluate(() => {
    const root = document.getElementById('host')!.attachShadow({ mode: 'open' });
    root.innerHTML = '<p>shadow text</p>';
  });
  const s = await captureSnapshot(wrap(page), { url: 'http://test/', viewport: 800 }, []);
  expect(s.boxes.map((b) => b.locator.text)).toEqual(['shadow text']);
});

it('builds unique selectors that skip hashed classes', async () => {
  const s = await snap(`<ul><li class="row css-1x2y3z">a</li><li class="row css-1x2y3z">b</li></ul><p id="intro">c</p><p id="r123456">d</p>`);
  expect(s.boxes.map((b) => b.locator.selector)).toEqual(['li.row:nth-of-type(1)', 'li.row:nth-of-type(2)', '#intro', 'p:nth-of-type(2)']);
  for (const b of s.boxes) expect(await page.locator(b.locator.selector).count()).toBe(1);
});

it('reads React component names and source from a dev fiber', async () => {
  await page.setContent('<div id="x">Total</div>');
  await page.evaluate(() => {
    const el = document.getElementById('x') as unknown as Record<string, unknown>;
    el.__reactFiber$abc = {
      type: 'div',
      return: {
        type: { name: 'StatTile' },
        _debugSource: { fileName: '/app/src/StatTile.tsx', lineNumber: 12 },
        return: { type: { name: 'Dashboard' }, return: null },
      },
    };
  });
  const t = (await captureSnapshot(wrap(page), { url: 'http://test/', viewport: 800 }, [])).boxes[0];
  expect(t.locator.components).toEqual(['StatTile', 'Dashboard']);
  expect(t.locator.source).toBe('/app/src/StatTile.tsx:12');
});

it("points at the element's own JSX line, not where its component is used", async () => {
  // React 18 dev: a host fiber's _debugSource is the line that wrote the element; the component fiber's is its call site.
  await page.setContent('<p id="x">Revenue</p>');
  await page.evaluate(() => {
    const el = document.getElementById('x') as unknown as Record<string, unknown>;
    el.__reactFiber$abc = {
      type: 'p',
      _debugSource: { fileName: 'src/components/StatTile.tsx', lineNumber: 7 },
      return: {
        type: { name: 'StatTile' },
        _debugSource: { fileName: 'src/App.tsx', lineNumber: 20 },
        return: { type: { name: 'App' }, return: null },
      },
    };
  });
  const t = (await captureSnapshot(wrap(page), { url: 'http://test/', viewport: 800 }, [])).boxes[0];
  expect(t.locator.components).toEqual(['StatTile', 'App']);
  expect(t.locator.source).toBe('src/components/StatTile.tsx:7');
});

it('reads the React 19 debug stack', async () => {
  await page.setContent('<div id="x">Total</div>');
  await page.evaluate(() => {
    const el = document.getElementById('x') as unknown as Record<string, unknown>;
    el.__reactFiber$abc = {
      type: 'div',
      return: {
        type: { name: 'StatTile' },
        _debugStack: { stack: 'Error: react-stack-top-frame\n    at exports.jsxDEV (http://localhost:5173/node_modules/.vite/deps/react_jsx-dev-runtime.js?v=1:250:30)\n    at StatTile (http://localhost:5173/src/components/StatTile.tsx?t=1700:14:7)' },
        return: null,
      },
    };
  });
  const t = (await captureSnapshot(wrap(page), { url: 'http://test/', viewport: 800 }, [])).boxes[0];
  expect(t.locator.source).toBe('src/components/StatTile.tsx:14');
});

it('skips React lookups without main-world access', async () => {
  await page.setContent('<div id="x">Total</div>');
  await page.evaluate(() => {
    (document.getElementById('x') as unknown as Record<string, unknown>).__reactFiber$abc = { type: 'div', return: { type: { name: 'StatTile' }, return: null } };
  });
  const t = (await captureSnapshot(wrap(page, false), { url: 'http://test/', viewport: 800 }, [])).boxes[0];
  expect(t.locator.components).toEqual([]);
});

it('ignores data-uilint attributes', async () => {
  const s = await snap(`<p data-uilint-ignore="all">still measured</p>`);
  expect(s.boxes).toHaveLength(1);
});

it('gives identical snapshots on repeated runs', async () => {
  const html = `<div style="background:#eee;padding:16px"><h2>Title</h2><p>Body text here</p><button>Go</button></div>`;
  expect(JSON.stringify(await snap(html))).toBe(JSON.stringify(await snap(html)));
});

it('measures clipped and truncated text only where it is visible', async () => {
  const s = await snap(`<div style="width:100px;overflow:hidden;white-space:nowrap">${'x'.repeat(60)}</div>
    <div style="width:100px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis">${'y'.repeat(60)}</div>`);
  expect(s.boxes[0].clipped!.x).toBeGreaterThan(100);
  for (const b of s.boxes) {
    expect(b.rect.width).toBeLessThanOrEqual(100);
    expect(b.layoutRect.width).toBeLessThanOrEqual(100);
    expect(b.lines.every((l) => l.width <= 100)).toBe(true);
  }
});

it('records the box inside its borders', async () => {
  const s = await snap(`<div style="background:#eee;border-bottom:1px solid #000;border-left:3px solid #000;padding:8px;width:100px;font:14px/20px Arial"><span>Hi</span></div>`);
  expect(s.boxes[0].rect).toMatchObject({ width: 119, height: 37 });
  expect(s.boxes[0].innerRect).toMatchObject({ x: 3, y: 0, width: 116, height: 36 });
  expect(s.boxes[1].innerRect).toEqual(s.boxes[1].rect);
});

it('counts only half of a collapsed table border inside the cell', async () => {
  const s = await snap(`<table style="border-collapse:collapse;font:14px/20px Arial"><tr><td style="padding:12px;border-bottom:1px solid #ccc">A</td></tr></table>`);
  const td = s.boxes.find((b) => b.kind === 'surface')!;
  expect(td.rect.y + td.rect.height - (td.innerRect.y + td.innerRect.height)).toBeCloseTo(0.5, 1);
});
