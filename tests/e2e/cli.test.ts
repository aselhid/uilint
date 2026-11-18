import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { startServer } from '../helpers/server.js';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const tsxBin = join(repo, 'node_modules/.bin/tsx');
const cliPath = join(repo, 'src/cli.ts');
const fake = join(repo, 'tests/drivers/fixtures/wrapped-playwright.ts');
let server: { url: string; close(): Promise<void> };
let base = '';
let tmp = '';

beforeAll(async () => {
  server = await startServer(join(repo, 'tests/e2e/pages'), { '/redirect-to-login': '/clean.html' });
  base = server.url;
  tmp = await mkdtemp(join(tmpdir(), 'uilint-cli-'));
});
afterAll(async () => { await server.close(); });

function cli(args: string[], opts: { cwd?: string } = {}): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(tsxBin, [cliPath, ...args], { cwd: opts.cwd ?? repo });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

it('exits 0 and says so on a clean page', async () => {
  const r = await cli([`${base}/clean.html`], { cwd: tmp });
  expect(r.stderr).toBe('');
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/no problems found/);
});

it('exits 1 with an alignment error on a misaligned page', async () => {
  const r = await cli([`${base}/misaligned.html`], { cwd: tmp });
  expect(r.code).toBe(1);
  expect(r.stdout).toMatch(/^error  alignment  left edge 3px off from 2 stacked items  @375,768,1280$/m);
  expect(r.stdout).toMatch(/^  p\.stat-label "Revenue"$/m);
});

it('keeps the result when an adapter fails while closing', async () => {
  const r = await cli([`${base}/misaligned.html`, '--viewport', '800', '--driver', join(repo, 'tests/drivers/fixtures/close-throws.ts')], { cwd: tmp });
  expect(r.stderr).toBe('');
  expect(r.code).toBe(1);
  expect(r.stdout).toMatch(/left edge 3px off/);
});

it('exits 2 on HTTP 404', async () => {
  const r = await cli([`${base}/nope.html`], { cwd: tmp });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/returned HTTP 404/);
});

it('runs a setup script before measuring', async () => {
  const r = await cli([`${base}/setup-modal.html`, '--setup', join(repo, 'tests/e2e/pages/setup-modal.ts'), '--viewport', '800'], { cwd: tmp });
  expect(r.stdout).toMatch(/modal-title/);
  expect(r.code).toBe(1);
});

it('notes a redirect to another page', async () => {
  const r = await cli([`${base}/redirect-to-login`, '--viewport', '800'], { cwd: tmp });
  expect(r.stdout).toMatch(/note  landed on .*\/clean\.html/);
});

it('baselines existing violations', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'uilint-bl-'));
  const w = await cli([`${base}/misaligned.html`, '--update-baseline'], { cwd: dir });
  expect(w.code).toBe(0);
  const r = await cli([`${base}/misaligned.html`], { cwd: dir });
  expect(r.code).toBe(0);
  expect(r.stdout).toMatch(/1 baselined/);
});

it('prints JSON with --json', async () => {
  const r = await cli([`${base}/misaligned.html`, '--json', '--viewport', '800'], { cwd: tmp });
  const j = JSON.parse(r.stdout);
  expect(j.reports).toHaveLength(1);
  expect(j.reports[0].violations[0]).toMatchObject({ rule: 'alignment', check: 'left' });
});

it('rejects --profile with a non-Playwright driver', async () => {
  const r = await cli([`${base}/clean.html`, '--driver', 'betterwright', '--profile', '/tmp/x'], { cwd: tmp });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/--profile only applies to the playwright driver/);
});

it('runs through a custom adapter module', async () => {
  const r = await cli([`${base}/misaligned.html`, '--driver', fake, '--viewport', '800'], { cwd: tmp });
  expect(r.code).toBe(1);
});

it('exits 2 when no URL and no configured pages', async () => {
  const r = await cli([], { cwd: tmp });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/no URL given and no pages in config/);
});

it('exits 2 on a bad --viewport', async () => {
  const r = await cli([`${base}/clean.html`, '--viewport', 'wide'], { cwd: tmp });
  expect(r.code).toBe(2);
  expect(r.stderr).toMatch(/--viewport/);
});

it('works from the compiled build', async () => {
  // Inside the repo so the compiled CLI resolves node_modules the normal way.
  const out = await mkdtemp(join(repo, '.tmp-dist-'));
  execFileSync(process.execPath, [join(repo, 'scripts/build.mjs'), '--outDir', out], { cwd: repo });
  const r = await new Promise<{ code: number | null; stdout: string }>((resolve) => {
    const child = spawn(process.execPath, [join(out, 'cli.js'), `${base}/misaligned.html`, '--viewport', '800'], { cwd: tmp });
    let stdout = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stdout += d));
    child.on('close', (code) => resolve({ code, stdout }));
  });
  await rm(out, { recursive: true, force: true });
  expect(r.stdout).toMatch(/^error  alignment  left edge 3px off/m);
  expect(r.code).toBe(1);
}, 120_000);
