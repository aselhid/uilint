import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createPlaywrightDriver } from '../../src/drivers/playwright.js';
import { preparePage, stableSnapshot } from '../../src/drivers/stabilize.js';
import type { Driver } from '../../src/types.js';
import { startServer } from '../helpers/server.js';

const here = fileURLToPath(new URL('.', import.meta.url));
let server: { url: string; close(): Promise<void> };
let driver: Driver;
beforeAll(async () => { server = await startServer(join(here, 'pages')); driver = await createPlaywrightDriver({}); });
afterAll(async () => { await driver.close(); await server.close(); });
const open = (path: string) => driver.open(`${server.url}/${path}`, { width: 800, height: 900 }, 30000);
const info = { url: 'http://test/', viewport: 800 };

it('returns a snapshot once the page is still', async () => {
  const p = await open('still.html');
  await preparePage(p);
  expect((await stableSnapshot(p, info, [], 5000)).boxes.length).toBeGreaterThan(0);
});

it('gives up on a page that never settles', async () => {
  const p = await open('clock.html');
  await expect(stableSnapshot(p, info, [], 1000)).rejects.toThrow(/did not settle within 1000ms; still changing: #clock/);
});

it('freezes CSS animations before measuring', async () => {
  const p = await open('animated.html');
  await preparePage(p);
  expect((await stableSnapshot(p, info, [], 3000)).boxes).toHaveLength(1);
});
