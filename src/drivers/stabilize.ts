import { setTimeout as sleep } from 'node:timers/promises';
import { captureSnapshot } from '../browser/snapshot.js';
import { UilintError } from '../errors.js';
import type { DriverPage, Snapshot } from '../types.js';

export const FREEZE_CSS =
  '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important;scroll-behavior:auto!important}';

/** Lets the page finish loading and freezes motion before measuring. */
export async function preparePage(page: DriverPage): Promise<void> {
  await page.waitForNetworkIdle(5000);
  await page.evaluate('document.fonts.ready.then(() => true)');
  await page.addStyle(FREEZE_CSS);
}

function firstDifference(prev: Snapshot, next: Snapshot): string {
  const n = Math.max(prev.boxes.length, next.boxes.length);
  for (let i = 0; i < n; i++) {
    const a = prev.boxes[i], b = next.boxes[i];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      const box = b ?? a;
      return box.locator.text ? `${box.locator.selector} "${box.locator.text}"` : box.locator.selector;
    }
  }
  return 'page size';
}

/** Measures every 100ms until two consecutive snapshots match. */
export async function stableSnapshot(page: DriverPage, info: { url: string; viewport: number }, exclude: string[], timeoutMs: number, keep = false): Promise<Snapshot> {
  const deadline = Date.now() + timeoutMs;
  let prev = await captureSnapshot(page, info, exclude, keep);
  for (;;) {
    await sleep(100);
    const next = await captureSnapshot(page, info, exclude, keep);
    if (JSON.stringify(next) === JSON.stringify(prev)) return next;
    if (Date.now() >= deadline) {
      throw new UilintError(`layout did not settle within ${timeoutMs}ms; still changing: ${firstDifference(prev, next)}`);
    }
    prev = next;
  }
}
