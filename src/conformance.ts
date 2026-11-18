import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Driver } from './types.js';

const PAGES: Record<string, string> = {
  '/page': '<!doctype html><html><head><title>page</title></head><body><p id="p">hello</p></body></html>',
  '/poll': '<!doctype html><html><body><p>polling</p><script>setInterval(() => fetch("/ping").catch(() => {}), 50)</script></body></html>',
  '/ping': 'ok',
  '/tall': '<!doctype html><html><body style="margin:0"><div style="height:2000px;background:#eee"></div></body></html>',
};

const pngSize = (png: Buffer) => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) });

/**
 * Registers the tests every uilint driver must pass. Call it from a vitest file:
 *   runDriverConformance('mine', () => createDriver({}), { setupFile: '/abs/setup-that-sets-title.js' })
 * The setup file is in the adapter's own format and must set document.title to 'setup-ran'.
 */
export function runDriverConformance(name: string, make: () => Promise<Driver>, opts: { setupFile: string }): void {
  describe(`driver conformance: ${name}`, () => {
    let server: Server;
    let base = '';
    let driver: Driver;
    const viewport = { width: 375, height: 900 };

    beforeAll(async () => {
      server = createServer((req, res) => {
        const path = new URL(req.url ?? '/', 'http://x').pathname;
        if (path === '/redirect') { res.writeHead(302, { location: '/page' }); res.end(); return; }
        const body = PAGES[path];
        res.writeHead(body ? 200 : 404, { 'content-type': 'text/html' });
        res.end(body ?? '<h1>missing</h1>');
      });
      await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      driver = await make();
    });
    afterAll(async () => {
      await driver?.close();
      await new Promise<void>((r) => server.close(() => r()));
    });

    it('opens at the requested viewport width', async () => {
      const p = await driver.open(`${base}/page`, viewport, 30000);
      expect(await p.evaluate('innerWidth')).toBe(375);
      await p.close();
    });
    it('reports HTTP status 200 and 404', async () => {
      const ok = await driver.open(`${base}/page`, viewport, 30000);
      expect(ok.status).toBe(200);
      await ok.close();
      const missing = await driver.open(`${base}/nope`, viewport, 30000);
      expect(missing.status).toBe(404);
      await missing.close();
    });
    it('reports the URL after a redirect', async () => {
      const p = await driver.open(`${base}/redirect`, viewport, 30000);
      expect(await p.url()).toBe(`${base}/page`);
      await p.close();
    });
    it('evaluates expressions to JSON and awaits promises', async () => {
      const p = await driver.open(`${base}/page`, viewport, 30000);
      expect(await p.evaluate('({ a: [1, "two"], b: null })')).toEqual({ a: [1, 'two'], b: null });
      expect(await p.evaluate('Promise.resolve(42)')).toBe(42);
      await p.close();
    });
    it('injects styles', async () => {
      const p = await driver.open(`${base}/page`, viewport, 30000);
      await p.addStyle('#p { margin-left: 33px }');
      expect(await p.evaluate('getComputedStyle(document.getElementById("p")).marginLeft')).toBe('33px');
      await p.close();
    });
    it('returns from waitForNetworkIdle on a page that polls forever', async () => {
      const p = await driver.open(`${base}/poll`, viewport, 30000);
      const t = Date.now();
      await p.waitForNetworkIdle(1000);
      expect(Date.now() - t).toBeLessThan(5000);
      await p.close();
    });
    it('runs a setup file', async () => {
      const p = await driver.open(`${base}/page`, viewport, 30000);
      await p.runSetup(opts.setupFile);
      expect(await p.evaluate('document.title')).toBe('setup-ran');
      await p.close();
    });
    it('takes a full-page screenshot when it offers one', async () => {
      const p = await driver.open(`${base}/tall`, viewport, 30000);
      if (!p.screenshot) { await p.close(); return; }
      expect(pngSize(await p.screenshot({ maxHeight: 10000 }))).toEqual({ width: 375, height: 2000 });
      expect(pngSize(await p.screenshot({ maxHeight: 500 }))).toEqual({ width: 375, height: 500 });
      await p.close();
    });
    it('closes pages and itself idempotently', async () => {
      const p = await driver.open(`${base}/page`, viewport, 30000);
      await p.close();
      await p.close();
      const d = await make();
      await d.close();
      await d.close();
    });
  });
}
