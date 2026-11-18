import { readFile } from 'node:fs/promises';
import { UilintError } from '../errors.js';
import type { CreateDriver, Driver, DriverPage } from '../types.js';

/*
 * BetterWright (https://github.com/BetterWright/betterwright) never hands out its page object: every step is a snippet
 * sent through `bw.run(code, { session })` with `page` and `state` in scope. Notes from its docs (v2.9):
 * - Its default NetworkPolicy allows loopback and private networks, so local dev servers need no extra policy.
 * - Return values are summarized (arrays cut at 200 items, big values spilled to a file), so results are stashed in
 *   the session's `state` as a JSON string and read back in chunks.
 * - Its worker runs on Bun 1.4+; constructing BetterWright does not start it, the first run() does.
 */

export interface BetterWrightOptions {
  home?: string;
  profile?: string;
  headless?: boolean | 'auto';
  stealthRuntimeFix?: boolean;
  /** Per-snippet timeout in ms. */
  timeout?: number;
}

interface Envelope { ok: boolean; result?: unknown; error?: string; challenges?: unknown[] }

export interface BetterWrightLike {
  run(code: string, opts?: { session?: string; timeout?: number }): Promise<Envelope>;
  close(): Promise<void>;
}

const CHUNK = 8000;

export async function loadBetterWrightModule(specifier = 'betterwright'): Promise<{ BetterWright: new (o: Record<string, unknown>) => BetterWrightLike }> {
  try {
    return await import(specifier);
  } catch {
    throw new UilintError('the betterwright driver needs the betterwright package: npm i -D betterwright (it also needs Bun 1.4+)');
  }
}

export async function createBetterWrightDriverFrom(
  make: (options: Record<string, unknown>) => BetterWrightLike | Promise<BetterWrightLike>,
  options: Record<string, unknown>,
): Promise<Driver> {
  const o = options as BetterWrightOptions;
  const ctor: Record<string, unknown> = { downloadPolicy: 'deny' };
  if (o.home !== undefined) ctor.home = o.home;
  if (o.profile !== undefined) ctor.profile = o.profile;
  if (o.headless !== undefined) ctor.headless = o.headless;
  if (o.stealthRuntimeFix !== undefined) ctor.stealthRuntimeFix = o.stealthRuntimeFix;
  if (o.timeout !== undefined) ctor.defaultTimeout = Math.max(5, Math.ceil(o.timeout / 1000));
  const bw = await make(ctor);
  const mainWorld = !o.stealthRuntimeFix;
  let sessions = 0;
  let closed = false;

  const exec = async (session: string, code: string, what: string): Promise<unknown> => {
    let env: Envelope;
    try {
      env = await bw.run(code, { session });
    } catch (e) {
      throw new UilintError(`betterwright ${what} failed: ${(e as Error).message.split('\n')[0]}`);
    }
    if (!env.ok) throw new UilintError(`betterwright ${what} failed: ${env.error ?? 'unknown error'}`);
    if (env.challenges?.length) throw new UilintError(`a CAPTCHA or bot check is showing during ${what}; uilint can't measure behind it`);
    return env.result;
  };

  return {
    name: 'betterwright',
    async open(url, viewport, timeoutMs) {
      const session = `uilint-${process.pid}-${++sessions}`;
      let nav: { status: number | null; url: string };
      try {
        nav = (await exec(session, `
          await page.setViewportSize(${JSON.stringify(viewport)});
          const response = await page.goto(${JSON.stringify(url)}, { waitUntil: 'load', timeout: ${timeoutMs} });
          return { status: response ? response.status() : null, url: page.url() };`, `loading ${url}`)) as typeof nav;
      } catch (e) {
        if (e instanceof UilintError && /CAPTCHA/.test(e.message)) throw e;
        throw new UilintError(`could not load ${url}: ${(e as Error).message.replace(/^betterwright loading \S+ failed: /, '')}`);
      }
      let pageClosed = false;
      const page: DriverPage = {
        status: nav.status,
        capabilities: { mainWorld },
        url: async () => (await exec(session, 'return page.url();', 'reading the URL')) as string,
        async evaluate<T>(expression: string): Promise<T> {
          const length = (await exec(session,
            `state.uilintOut = JSON.stringify((await page.evaluate(${JSON.stringify(expression)})) ?? null); return state.uilintOut.length;`,
            'evaluating a script')) as number;
          let json = '';
          for (let i = 0; i < length; i += CHUNK) {
            const part = await exec(session, `return state.uilintOut.slice(${i}, ${i + CHUNK});`, 'reading a result');
            if (typeof part !== 'string') throw new UilintError('betterwright returned a truncated result');
            json += part;
          }
          await exec(session, 'delete state.uilintOut; return true;', 'clearing a result');
          return JSON.parse(json) as T;
        },
        async addStyle(css) {
          await exec(session, `await page.addStyleTag({ content: ${JSON.stringify(css)} }); return true;`, 'adding a style');
        },
        async waitForNetworkIdle(timeoutMs2) {
          await exec(session, `await page.waitForLoadState('networkidle', { timeout: ${timeoutMs2} }).catch(() => {}); return true;`, 'waiting for the network');
        },
        async runSetup(file) {
          await exec(session, await readFile(file, 'utf8'), `setup ${file}`);
        },
        async close() {
          if (pageClosed) return;
          pageClosed = true;
          await exec(session, 'await page.close(); return true;', 'closing a page').catch(() => {});
        },
      };
      return page;
    },
    async close() {
      if (closed) return;
      closed = true;
      await bw.close();
    },
  };
}

export const createBetterWrightDriver: CreateDriver = async (options) => {
  const { BetterWright } = await loadBetterWrightModule();
  return createBetterWrightDriverFrom((o) => new BetterWright(o), options);
};

export const createDriver = createBetterWrightDriver;
