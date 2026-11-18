import { readFile } from 'node:fs/promises';
import { UilintError } from '../errors.js';
import type { Box, DriverPage, Snapshot } from '../types.js';

let source: string | undefined;

async function measureSource(): Promise<string> {
  source ??= await readFile(new URL('./measure.page.js', import.meta.url), 'utf8');
  return source;
}

interface MeasureResult { boxes: Box[]; scrollWidth: number; clientWidth: number; error?: string }

/** Measures every visual box on the page. Works with any adapter: the script is evaluated as a string. */
export async function captureSnapshot(page: DriverPage, info: { url: string; viewport: number }, exclude: string[]): Promise<Snapshot> {
  const options = { exclude, react: page.capabilities.mainWorld };
  const result = await page.evaluate<MeasureResult>(`(${await measureSource()})(${JSON.stringify(options)})`);
  if (result.error) throw new UilintError(result.error);
  return {
    page: {
      url: info.url,
      finalUrl: await page.url(),
      status: page.status,
      viewport: info.viewport,
      scrollWidth: result.scrollWidth,
      clientWidth: result.clientWidth,
    },
    boxes: result.boxes,
  };
}
