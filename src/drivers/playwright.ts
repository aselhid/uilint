import { pathToFileURL } from 'node:url';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { tsImport } from 'tsx/esm/api';
import { UilintError } from '../errors.js';
import { SCROLL_SIZE } from '../report/png.js';
import type { CreateDriver, Driver, DriverPage } from '../types.js';

export interface PlaywrightOptions { profile?: string; cdp?: string; channel?: string; headless?: boolean }

const CONTEXT_DEFAULTS ={ deviceScaleFactor: 1, reducedMotion: 'reduce' as const };

function wrapPage(page: Page, status: number | null, onClose: () => Promise<void>): DriverPage {
  let closed = false;
  return {
    status,
    capabilities: { mainWorld: true },
    url: async () => page.url(),
    evaluate: async <T>(expression: string) => (await page.evaluate(expression)) as T,
    addStyle: async (css) => { await page.addStyleTag({ content: css }); },
    waitForNetworkIdle: async (timeoutMs) => { await page.waitForLoadState('networkidle', { timeout: timeoutMs }).catch(() => {}); },
    runSetup: async (file) => {
      const mod = await tsImport(pathToFileURL(file).href, import.meta.url);
      const fn = mod.default?.default ?? mod.default;
      if (typeof fn !== 'function') throw new UilintError(`setup ${file} must export a default function (page) => Promise<void>`);
      await fn(page);
    },
    screenshot: async ({ maxHeight }) => {
      const [width, height] = await page.evaluate(SCROLL_SIZE) as [number, number];
      return page.screenshot({ fullPage: true, scale: 'css', clip: { x: 0, y: 0, width, height: Math.min(height, maxHeight) } });
    },
    close: async () => {
      if (closed) return;
      closed = true;
      await onClose();
    },
  };
}

async function goto(page: Page, url: string, timeoutMs: number): Promise<number | null> {
  try {
    const response = await page.goto(url, { waitUntil: 'load', timeout: timeoutMs });
    return response?.status() ?? null;
  } catch (e) {
    throw new UilintError(`could not load ${url}: ${(e as Error).message.split('\n')[0]}`);
  }
}

export const createPlaywrightDriver: CreateDriver = async (options) => {
  const { profile, cdp, channel, headless = true } = options as PlaywrightOptions;
  let closed = false;

  if (profile) {
    let context: BrowserContext;
    try {
      context = await chromium.launchPersistentContext(profile, { headless, channel, ...CONTEXT_DEFAULTS });
    } catch (e) {
      const msg = (e as Error).message;
      if (/ProcessSingleton|in use|SingletonLock|already running/i.test(msg)) {
        throw new UilintError(`profile ${profile} is in use by another browser; close it, or start Chrome with --remote-debugging-port and pass --cdp`);
      }
      throw new UilintError(`could not launch browser with profile ${profile}: ${msg.split('\n')[0]}`);
    }
    const driver: Driver = {
      name: 'playwright',
      async open(url, viewport, timeoutMs) {
        const page = await context.newPage();
        await page.setViewportSize(viewport);
        const status = await goto(page, url, timeoutMs).catch(async (e) => { await page.close(); throw e; });
        return wrapPage(page, status, () => page.close());
      },
      async close() { if (!closed) { closed = true; await context.close(); } },
    };
    return driver;
  }

  if (cdp) {
    const endpoint = /^\d+$/.test(cdp) ? `http://127.0.0.1:${cdp}` : cdp;
    let browser: Browser;
    try {
      browser = await chromium.connectOverCDP(endpoint);
    } catch (e) {
      throw new UilintError(`could not attach to Chrome at ${endpoint}: ${(e as Error).message.split('\n')[0]}`);
    }
    const opened = new Set<Page>();
    const driver: Driver = {
      name: 'playwright',
      async open(url, viewport, timeoutMs) {
        const context = browser.contexts()[0] ?? (await browser.newContext());
        const page = await context.newPage();
        opened.add(page);
        await page.setViewportSize(viewport);
        const status = await goto(page, url, timeoutMs);
        return wrapPage(page, status, async () => { opened.delete(page); await page.close(); });
      },
      // Never closes the user's browser: only the pages uilint opened.
      async close() {
        if (closed) return;
        closed = true;
        await Promise.all([...opened].map((p) => p.close().catch(() => {})));
        opened.clear();
      },
    };
    return driver;
  }

  const browser = await chromium.launch({ headless, channel });
  const driver: Driver = {
    name: 'playwright',
    async open(url, viewport, timeoutMs) {
      const context = await browser.newContext({ viewport, ...CONTEXT_DEFAULTS });
      const page = await context.newPage();
      const status = await goto(page, url, timeoutMs).catch(async (e) => { await context.close(); throw e; });
      return wrapPage(page, status, () => context.close());
    },
    async close() { if (!closed) { closed = true; await browser.close(); } },
  };
  return driver;
};
