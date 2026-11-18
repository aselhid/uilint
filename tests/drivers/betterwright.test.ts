import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runDriverConformance } from '../../src/conformance.js';
import { createBetterWrightDriver, createBetterWrightDriverFrom, loadBetterWrightModule } from '../../src/drivers/betterwright.js';
import { loadDriver } from '../../src/drivers/load.js';
import { startServer } from '../helpers/server.js';
import { FakeBetterWright } from './fixtures/fake-betterwright.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const setupFile = join(here, 'fixtures/setup-title.bw.js');
let server: { url: string; close(): Promise<void> };
beforeAll(async () => { server = await startServer(join(here, 'pages')); });
afterAll(async () => { await server.close(); });

const fake = (options: Record<string, unknown> = {}) => createBetterWrightDriverFrom((o) => new FakeBetterWright(o), options);

runDriverConformance('betterwright (stand-in)', () => fake(), { setupFile });

describe('betterwright adapter', () => {
  it('returns results larger than BetterWright will hand back in one call', async () => {
    const d = await fake();
    const p = await d.open(`${server.url}/still.html`, { width: 375, height: 900 }, 30000);
    const big = await p.evaluate<number[]>('Array.from({ length: 5000 }, (_, i) => i)');
    expect(big).toHaveLength(5000);
    expect(big[4999]).toBe(4999);
    await d.close();
  });

  it('passes its options to BetterWright and denies downloads', async () => {
    let seen: Record<string, unknown> = {};
    const d = await createBetterWrightDriverFrom((o) => { seen = o; return new FakeBetterWright(o); },
      { home: '/tmp/bw', profile: 'work', headless: false, stealthRuntimeFix: true, timeout: 20000, targets: ['http://x/'] });
    expect(seen).toEqual({ home: '/tmp/bw', profile: 'work', headless: false, stealthRuntimeFix: true, defaultTimeout: 20, downloadPolicy: 'deny' });
    await d.close();
  });

  it('reports no React info in stealth mode', async () => {
    const d = await fake({ stealthRuntimeFix: true });
    const p = await d.open(`${server.url}/still.html`, { width: 375, height: 900 }, 30000);
    expect(p.capabilities.mainWorld).toBe(false);
    await d.close();
  });

  it('turns a failed navigation into a UilintError', async () => {
    const d = await fake();
    await expect(d.open('http://127.0.0.1:9/', { width: 375, height: 900 }, 5000)).rejects.toThrow(/could not load http:\/\/127\.0\.0\.1:9\//);
    await d.close();
  });

  it('refuses to measure behind a CAPTCHA', async () => {
    const d = await createBetterWrightDriverFrom(() => ({
      run: async () => ({ ok: true, result: { status: 200, url: 'http://x/' }, challenges: [{ provider: 'turnstile' }] }),
      close: async () => {},
    }), {});
    await expect(d.open('http://x/', { width: 375, height: 900 }, 5000)).rejects.toThrow(/CAPTCHA or bot check/);
  });

  it('gives an install hint when betterwright is missing', async () =>
    await expect(loadBetterWrightModule('betterwright-not-installed-xyz')).rejects.toThrow(/npm i -D betterwright/));

  it('loads by name through loadDriver', async () => {
    // Constructing the driver does not start BetterWright's worker, so this works without Bun.
    const d = await loadDriver({ name: 'betterwright', options: { headless: true } }, process.cwd(), []);
    expect(d.name).toBe('betterwright');
    await d.close();
  });
});

describe.skipIf(!process.env.UILINT_TEST_BETTERWRIGHT)('real BetterWright', () => {
  let home = '';
  beforeAll(async () => { home = await mkdtemp(join(tmpdir(), 'uilint-bw-')); });
  runDriverConformance('betterwright', () => createBetterWrightDriver({ home, headless: true }), { setupFile });
  it('reaches a localhost dev server', async () => {
    const d = await createBetterWrightDriver({ home, headless: true });
    const p = await d.open(`${server.url}/still.html`, { width: 375, height: 900 }, 30000);
    expect(p.status).toBe(200);
    await d.close();
  });
});
