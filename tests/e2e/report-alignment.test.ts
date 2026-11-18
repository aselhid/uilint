import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { chromium, type Page } from 'playwright';
import { expect, it } from 'vitest';
import { startServer } from '../helpers/server.js';

const repo = fileURLToPath(new URL('../../', import.meta.url));

function cli(args: string[], cwd: string): Promise<number | null> {
  return new Promise((resolve) => {
    const child = spawn(join(repo, 'node_modules/.bin/tsx'), [join(repo, 'src/cli.ts'), ...args], { cwd });
    child.on('close', resolve);
  });
}

/** RGB of a 1x1 PNG. Every PNG filter type leaves a lone pixel's bytes as they are. */
function pixel(png: Buffer): [number, number, number] {
  let at = 8;
  const idat: Buffer[] = [];
  while (at < png.length) {
    const len = png.readUInt32BE(at), type = png.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') idat.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  return [raw[1], raw[2], raw[3]];
}

/** Samples the screenshot pixel 5 CSS px inside the top-left corner of the n-th card's offender outline. */
async function insideOffender(page: Page, card: number): Promise<[number, number, number]> {
  const rect = page.locator('section.finding').nth(card).locator('svg rect.offender').first();
  const box = (await rect.boundingBox())!;
  const shot = await page.screenshot({ clip: { x: box.x + 5, y: box.y + 5, width: 1, height: 1 } });
  return pixel(shot);
}

const close = (a: number[], b: number[]) => a.every((v, i) => Math.abs(v - b[i]) <= 8);

it('outlines sit on the elements they name, including fixed layers', async () => {
  const server = await startServer(join(repo, 'tests/e2e/pages'));
  const tmp = await mkdtemp(join(tmpdir(), 'uilint-report-'));
  try {
    expect(await cli([`${server.url}/report-align.html`, '--viewport', '800', '--report', 'r.html'], tmp)).toBe(1);
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
      await page.goto(pathToFileURL(join(tmp, 'r.html')).href);
      const texts = await page.locator('section.finding pre').allTextContents();
      const fixed = texts.findIndex((t) => t.includes('div.off'));
      const row = texts.findIndex((t) => t.includes('div.row.off'));
      expect(fixed).toBeGreaterThanOrEqual(0);
      expect(row).toBeGreaterThanOrEqual(0);
      const blue = await insideOffender(page, fixed);
      const green = await insideOffender(page, row);
      expect(close(blue, [0, 0, 255]), `fixed-layer offender pixel ${blue}`).toBe(true);
      expect(close(green, [0, 255, 0]), `page offender pixel ${green}`).toBe(true);
    } finally {
      await browser.close();
    }
  } finally {
    await server.close();
  }
}, 60000);
