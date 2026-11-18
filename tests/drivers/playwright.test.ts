import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDriverConformance } from '../../src/conformance.js';
import { createPlaywrightDriver } from '../../src/drivers/playwright.js';
import { startServer } from '../helpers/server.js';

const here = fileURLToPath(new URL('.', import.meta.url));
let server: { url: string; close(): Promise<void> };
beforeAll(async () => { server = await startServer(join(here, 'pages')); });
afterAll(async () => { await server.close(); });

runDriverConformance('playwright', () => createPlaywrightDriver({}), { setupFile: join(here, 'fixtures/setup-title.ts') });

describe('playwright driver', () => {
  it('offers screenshots', async () => {
    const d = await createPlaywrightDriver({});
    const p = await d.open(`${server.url}/still.html`, { width: 375, height: 900 }, 30000);
    expect(typeof p.screenshot).toBe('function');
    await d.close();
  });

  it('opens pages with scale factor 1', async () => {
    const d = await createPlaywrightDriver({});
    const p = await d.open(`${server.url}/still.html`, { width: 375, height: 900 }, 30000);
    expect(await p.evaluate('[innerWidth, devicePixelRatio]')).toEqual([375, 1]);
    await d.close();
  });

  it('reuses cookies from a persistent profile', async () => {
    const profile = await mkdtemp(join(tmpdir(), 'uilint-profile-'));
    const d1 = await createPlaywrightDriver({ profile });
    const p1 = await d1.open(`${server.url}/still.html`, { width: 800, height: 900 }, 30000);
    await p1.evaluate(`document.cookie = 'session=abc; max-age=3600'`);
    await d1.close();
    const d2 = await createPlaywrightDriver({ profile });
    const p2 = await d2.open(`${server.url}/still.html`, { width: 800, height: 900 }, 30000);
    expect(await p2.evaluate('document.cookie')).toContain('session=abc');
    await d2.close();
  });

  it('attaches over CDP without closing the browser', async () => {
    const browser = await chromium.launch({ args: ['--remote-debugging-port=9339'] });
    try {
      const d = await createPlaywrightDriver({ cdp: '9339' });
      const p = await d.open(`${server.url}/still.html`, { width: 640, height: 900 }, 30000);
      expect(await p.evaluate('innerWidth')).toBe(640);
      await d.close();
      expect(browser.isConnected()).toBe(true);
      const page = await browser.newPage();
      await page.goto(`${server.url}/still.html`);
      expect(await page.title()).toBe('still');
    } finally {
      await browser.close();
    }
  });

  it('reports an unreachable URL as a UilintError', async () => {
    const d = await createPlaywrightDriver({});
    await expect(d.open('http://127.0.0.1:9/', { width: 800, height: 900 }, 5000)).rejects.toThrow(/could not load http:\/\/127\.0\.0\.1:9\//);
    await d.close();
  });
});
