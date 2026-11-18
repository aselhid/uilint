import { isAbsolute, resolve } from 'node:path';
import { loadConfig } from './config.js';
import { loadDriver } from './drivers/load.js';
import { preparePage, stableSnapshot } from './drivers/stabilize.js';
import { UilintError } from './errors.js';
import { applyBaseline, loadBaseline, writeBaseline } from './exceptions/baseline.js';
import { applyIgnores, loadIgnore } from './exceptions/ignore.js';
import { formatJson, formatText, type UrlReport } from './report/format.js';
import { collapseRepeats, mergeViewports, sortViolations } from './report/merge.js';
import { runRules } from './rules/index.js';
import type { Finding, Snapshot, Violation } from './types.js';

export interface RunOptions {
  urls: string[];
  config?: string;
  viewports?: number[];
  driver?: string;
  profile?: string;
  cdp?: string;
  setup?: string;
  json: boolean;
  max: number;
  updateBaseline: boolean;
  cwd: string;
}

export interface RunResult { exitCode: 0 | 1 | 2; stdout: string; stderr: string }

const isPath = (s: string) => s.startsWith('.') || isAbsolute(s);

export async function run(opts: RunOptions): Promise<RunResult> {
  try {
    return await runInner(opts);
  } catch (e) {
    if (e instanceof UilintError) return { exitCode: 2, stdout: '', stderr: `uilint: ${e.message}\n` };
    throw e;
  }
}

async function runInner(opts: RunOptions): Promise<RunResult> {
  const { config } = await loadConfig(opts.config, opts.cwd);
  const usingConfigPages = opts.urls.length === 0;
  const targets = usingConfigPages
    ? config.pages
    : opts.urls.map((url) => ({ url, setup: opts.setup ? resolve(opts.cwd, opts.setup) : undefined }));
  if (targets.length === 0) throw new UilintError('no URL given and no pages in config');
  const viewports = opts.viewports ?? config.viewports;

  const name = opts.driver ? (isPath(opts.driver) ? resolve(opts.cwd, opts.driver) : opts.driver) : config.driver.name;
  const options = { ...config.driver.options };
  if (opts.profile || opts.cdp) {
    const flag = opts.profile ? '--profile' : '--cdp';
    if (name !== 'playwright') throw new UilintError(`${flag} only applies to the playwright driver (driver is "${name}")`);
    if (opts.profile) options.profile = resolve(opts.cwd, opts.profile);
    if (opts.cdp) options.cdp = opts.cdp;
  }

  const notes: string[] = [];
  const perTarget: { url: string; finalUrl: string; violations: Violation[] }[] = [];
  const driver = await loadDriver({ name, options }, opts.cwd, targets.map((t) => t.url));
  let isolated = false;
  try {
    for (const target of targets) {
      const runs: { snapshot: Snapshot; findings: Finding[] }[] = [];
      let finalUrl = target.url;
      for (const width of viewports) {
        const page = await driver.open(target.url, { width, height: config.viewportHeight }, config.timeouts.navigation);
        try {
          if (page.status !== null && page.status >= 400) throw new UilintError(`${target.url} returned HTTP ${page.status}`);
          if (!page.capabilities.mainWorld) isolated = true;
          await preparePage(page);
          if (target.setup) {
            try {
              await page.runSetup(target.setup);
            } catch (e) {
              throw new UilintError(`setup ${target.setup} failed: ${(e as Error).message.split('\n')[0]}`);
            }
            await page.waitForNetworkIdle(2000);
          }
          const snapshot = await stableSnapshot(page, { url: target.url, viewport: width }, config.exclude, config.timeouts.stable);
          finalUrl = snapshot.page.finalUrl;
          runs.push({ snapshot, findings: runRules(snapshot, config) });
        } finally {
          await page.close();
        }
      }
      perTarget.push({ url: target.url, finalUrl, violations: mergeViewports(target.url, runs) });
    }
  } finally {
    await driver.close();
  }

  const ignores = await loadIgnore(config.ignoreFile);
  const used = new Set<number>();
  for (const t of perTarget) {
    const r = applyIgnores(t.violations, ignores);
    t.violations = r.kept;
    for (const line of r.used) used.add(line);
  }

  if (opts.updateBaseline) {
    const all = perTarget.flatMap((t) => t.violations);
    await writeBaseline(config.baselineFile, all);
    return { exitCode: 0, stdout: `uilint: wrote ${all.length} violation(s) to ${config.baselineFile}\n`, stderr: '' };
  }

  const known = await loadBaseline(config.baselineFile);
  const urlOrder = targets.map((t) => t.url);
  const reports: UrlReport[] = perTarget.map((t) => {
    const { kept, baselined } = applyBaseline(t.violations, known);
    return { url: t.url, finalUrl: t.finalUrl, baselined, violations: sortViolations(collapseRepeats(kept), urlOrder) };
  });

  if (isolated) {
    notes.push(`${driver.name}: page scripts run in an isolated world, so React component names and source files are unavailable`);
  }
  if (usingConfigPages) {
    for (const e of ignores) if (!used.has(e.line)) notes.push(`ignore entry unused: ${config.ignoreFile}:${e.line}`);
  }

  const failed = reports.some((r) => r.violations.some((v) => v.severity === 'error'));
  const stdout = opts.json ? formatJson(reports, notes) : formatText(reports, notes, opts.max);
  return { exitCode: failed ? 1 : 0, stdout, stderr: '' };
}
