import { chromium, type Browser, type Page } from 'playwright';
import { createBetterWrightDriverFrom, type BetterWrightLike } from '../../../src/drivers/betterwright.js';
import type { CreateDriver } from '../../../src/types.js';

/**
 * Stands in for BetterWright's `run(code, { session })`: runs the snippet with `page` and `state` in scope on a real
 * Playwright page, and returns results the way BetterWright does (arrays cut at 200 items, big values spilled).
 */
export class FakeBetterWright implements BetterWrightLike {
  private browser?: Browser;
  private sessions = new Map<string, { page: Page; state: Record<string, unknown> }>();
  constructor(public readonly options: Record<string, unknown>) {}

  async run(code: string, opts: { session?: string } = {}) {
    try {
      this.browser ??= await chromium.launch();
      const name = opts.session ?? 'default';
      let s = this.sessions.get(name);
      if (!s) {
        s = { page: await this.browser.newPage(), state: {} };
        this.sessions.set(name, s);
      }
      const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
      const result = await new AsyncFunction('page', 'state', code)(s.page, s.state);
      return { ok: true, result: summarize(result) };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  async close() {
    await this.browser?.close();
    this.browser = undefined;
  }
}

function summarize(v: unknown): unknown {
  if (typeof v === 'string' && v.length > 20000) return { truncated: true, preview: v.slice(0, 200), fullOutputPath: '/tmp/x' };
  if (Array.isArray(v)) return v.slice(0, 200).map(summarize);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 200).map(([k, x]) => [k, summarize(x)]));
  return v;
}

export const createDriver: CreateDriver = (options) => createBetterWrightDriverFrom((o) => new FakeBetterWright(o), options);
