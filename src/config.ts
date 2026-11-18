import { access, readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { UilintError } from './errors.js';
import type { Rule, RuleName, Severity } from './types.js';

export type RuleSetting<O> = Severity | [Severity, Partial<O>];

export interface UilintConfig {
  viewports: number[];
  viewportHeight: number;
  pages: { url: string; setup?: string }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rules: Partial<Record<RuleName, RuleSetting<any>>>;
  exclude: string[];
  ignoreFile: string;
  baselineFile: string;
  driver: { name: string; options: Record<string, unknown> };
  timeouts: { navigation: number; stable: number };
}

export const RULE_NAMES: RuleName[] = ['alignment', 'spacing', 'size-consistency', 'overflow', 'contrast'];
const SEVERITIES: Severity[] = ['off', 'warn', 'error'];

export const DEFAULT_CONFIG: UilintConfig = {
  viewports: [375, 768, 1280],
  viewportHeight: 900,
  pages: [],
  rules: {},
  exclude: [],
  ignoreFile: 'uilint.ignore',
  baselineFile: 'uilint.baseline.json',
  driver: { name: 'playwright', options: {} },
  timeouts: { navigation: 30000, stable: 10000 },
};

export function defineConfig(c: Partial<UilintConfig>): Partial<UilintConfig> {
  return c;
}

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

async function readConfigFile(path: string): Promise<Partial<UilintConfig>> {
  if (!(await exists(path))) throw new UilintError(`config file not found: ${path}`);
  if (path.endsWith('.json')) {
    try {
      return JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
      throw new UilintError(`${path}: invalid JSON (${(e as Error).message})`);
    }
  }
  try {
    const mod = await tsImport(pathToFileURL(path).href, import.meta.url);
    const value = mod.default?.default ?? mod.default;
    if (!value || typeof value !== 'object') throw new Error('no default export');
    return value as Partial<UilintConfig>;
  } catch (e) {
    if (e instanceof UilintError) throw e;
    throw new UilintError(`${path}: ${(e as Error).message}`);
  }
}

function validate(c: UilintConfig, file: string): void {
  if (!Array.isArray(c.viewports) || c.viewports.length === 0 || !c.viewports.every((v) => Number.isInteger(v) && v > 0)) {
    throw new UilintError(`${file}: viewports must be a non-empty list of positive integers`);
  }
  if (!Number.isInteger(c.viewportHeight) || c.viewportHeight <= 0) {
    throw new UilintError(`${file}: viewportHeight must be a positive integer`);
  }
  for (const [name, setting] of Object.entries(c.rules ?? {})) {
    if (!RULE_NAMES.includes(name as RuleName)) throw new UilintError(`${file}: unknown rule "${name}"`);
    const sev = Array.isArray(setting) ? setting[0] : setting;
    if (!SEVERITIES.includes(sev as Severity)) {
      throw new UilintError(`${file}: rule "${name}" has invalid severity "${String(sev)}"`);
    }
  }
  if (!Array.isArray(c.pages) || !c.pages.every((p) => p && typeof p.url === 'string')) {
    throw new UilintError(`${file}: pages must be a list of { url, setup? }`);
  }
  if (!c.driver || typeof c.driver.name !== 'string') throw new UilintError(`${file}: driver.name must be a string`);
}

const isPathLike = (s: string) => s.startsWith('.') || isAbsolute(s);

export async function loadConfig(path: string | undefined, cwd: string): Promise<{ config: UilintConfig; dir: string }> {
  let file: string | undefined;
  if (path) file = resolve(cwd, path);
  else {
    for (const name of ['uilint.config.ts', 'uilint.config.json']) {
      const candidate = resolve(cwd, name);
      if (await exists(candidate)) { file = candidate; break; }
    }
  }
  const raw = file ? await readConfigFile(file) : {};
  const dir = file ? dirname(file) : cwd;
  const config: UilintConfig = {
    ...DEFAULT_CONFIG,
    ...raw,
    driver: {
      name: raw.driver?.name ?? DEFAULT_CONFIG.driver.name,
      options: { ...DEFAULT_CONFIG.driver.options, ...(raw.driver?.options ?? {}) },
    },
    timeouts: { ...DEFAULT_CONFIG.timeouts, ...(raw.timeouts ?? {}) },
  };
  validate(config, file ?? 'config');
  config.ignoreFile = resolve(dir, config.ignoreFile);
  config.baselineFile = resolve(dir, config.baselineFile);
  config.pages = config.pages.map((p) => (p.setup ? { ...p, setup: resolve(dir, p.setup) } : { ...p }));
  if (isPathLike(config.driver.name)) config.driver.name = resolve(dir, config.driver.name);
  // A betterwright profile is an identity name, not a folder.
  if (typeof config.driver.options.profile === 'string' && config.driver.name !== 'betterwright') {
    config.driver.options.profile = resolve(dir, config.driver.options.profile);
  }
  return { config, dir };
}

export function ruleSetting<O>(config: UilintConfig, rule: Rule<O>, defaultSeverity: Severity): { severity: Severity; options: O } {
  const setting = config.rules[rule.name];
  if (setting === undefined) return { severity: defaultSeverity, options: { ...rule.defaults } };
  if (Array.isArray(setting)) return { severity: setting[0], options: { ...rule.defaults, ...setting[1] } };
  return { severity: setting, options: { ...rule.defaults } };
}
