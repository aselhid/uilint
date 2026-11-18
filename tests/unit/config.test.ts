import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, loadConfig, ruleSetting } from '../../src/config.js';
import { UilintError } from '../../src/errors.js';

const dir = fileURLToPath(new URL('./config-fixtures/', import.meta.url));
const fx = (f: string) => join(dir, f);
const cwd = process.cwd();
let emptyTmpDir: string;
beforeAll(async () => { emptyTmpDir = await mkdtemp(join(tmpdir(), 'uilint-cfg-')); });

describe('loadConfig', () => {
  it('returns defaults when no config file exists', async () => {
    const { config, dir: d } = await loadConfig(undefined, emptyTmpDir);
    expect(config.viewports).toEqual([375, 768, 1280]);
    expect(config.ignoreFile).toBe(join(emptyTmpDir, 'uilint.ignore'));
    expect(config.baselineFile).toBe(join(emptyTmpDir, 'uilint.baseline.json'));
    expect(config.driver).toEqual({ name: 'playwright', options: {} });
    expect(d).toBe(emptyTmpDir);
  });

  it('loads a .ts config through defineConfig', async () => {
    const { config } = await loadConfig(fx('ok.ts'), cwd);
    expect(config.viewports).toEqual([400]);
    expect(config.rules.spacing).toEqual(['warn', { max: 3 }]);
    expect(config.viewportHeight).toBe(900);
  });

  it('resolves setup, driver module and profile paths against the config directory', async () => {
    const { config } = await loadConfig(fx('ok.json'), '/');
    expect(config.pages[0].setup).toBe(fx('s.ts'));
    expect(config.driver.name).toBe(fx('my-driver.ts'));
    expect(config.driver.options.profile).toBe(fx('profile'));
    expect(config.ignoreFile).toBe(fx('uilint.ignore'));
  });

  it('rejects unknown rules with a UilintError naming the rule', async () => {
    const p = loadConfig(fx('bad.json'), cwd);
    await expect(p).rejects.toThrow(/unknown rule "spaceing"/);
    await expect(p).rejects.toBeInstanceOf(UilintError);
  });

  it('rejects a viewport that is not a positive integer', async () =>
    await expect(loadConfig(fx('bad-viewport.json'), cwd)).rejects.toThrow(/viewports/));

  it('rejects invalid JSON', async () =>
    await expect(loadConfig(fx('bad-syntax.json'), cwd)).rejects.toThrow(/bad-syntax\.json/));

  it('rejects a missing explicit config path', async () =>
    await expect(loadConfig(fx('missing.json'), cwd)).rejects.toThrow(/missing\.json/));
});

describe('ruleSetting', () => {
  const rule = { name: 'spacing' as const, defaults: { min: 0.5, max: 4 }, check: () => [] };
  it('merges rule options over defaults', () => {
    const r = ruleSetting({ ...DEFAULT_CONFIG, rules: { spacing: ['warn', { max: 3 }] } }, rule, 'error');
    expect(r).toEqual({ severity: 'warn', options: { min: 0.5, max: 3 } });
  });
  it('uses the default severity when the rule is not configured', () =>
    expect(ruleSetting(DEFAULT_CONFIG, rule, 'error')).toEqual({ severity: 'error', options: { min: 0.5, max: 4 } }));
  it('accepts a bare severity', () =>
    expect(ruleSetting({ ...DEFAULT_CONFIG, rules: { spacing: 'off' } }, rule, 'error').severity).toBe('off'));
});
