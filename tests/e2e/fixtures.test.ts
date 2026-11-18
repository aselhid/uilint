import { mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { run } from '../../src/run.js';
import type { Violation } from '../../src/types.js';
import { startServer } from '../helpers/server.js';

const driver = process.env.UILINT_TEST_DRIVER ?? 'playwright';
const fixtures = fileURLToPath(new URL('../fixtures/', import.meta.url));
let server: { url: string; close(): Promise<void> };
let cwd = '';
beforeAll(async () => { server = await startServer(fixtures); cwd = await mkdtemp(join(tmpdir(), 'uilint-fx-')); });
afterAll(async () => { await server.close(); });

async function lint(path: string, viewports?: number[]): Promise<{ exitCode: number; violations: Violation[]; stdout: string }> {
  const r = await run({ urls: [`${server.url}/${path}`], viewports, driver, json: true, max: 50, updateBaseline: false, cwd });
  if (r.exitCode === 2) throw new Error(r.stderr);
  return { exitCode: r.exitCode, violations: JSON.parse(r.stdout).reports[0].violations, stdout: r.stdout };
}

const hits = (v: Violation, target: string) =>
  v.elements.some((l) => (l.text ?? '').includes(target) || l.selector.includes(target));

const BAD: [file: string, rule: string, checks: string[], targets: string[], viewports?: number[]][] = [
  ['align-cross-parent.html', 'alignment', ['left'], ['Revenue']],
  ['align-row.html', 'alignment', ['top', 'center-y', 'bottom'], ['Settings']],
  ['spacing-list.html', 'spacing', ['gap'], ['Order 1003', 'Order 1004']],
  ['spacing-card-inset.html', 'spacing', ['inset-x'], ['div.card']],
  ['size-toolbar.html', 'size-consistency', ['height'], ['button.tall']],
  ['size-grid.html', 'size-consistency', ['width'], ['Card 6'], [1280]],
  ['overflow-clip.html', 'overflow', ['clipped'], ['Enterprise annual']],
  ['overflow-hscroll.html', 'overflow', ['hscroll'], ['div.banner'], [375]],
  ['overflow-overlap.html', 'overflow', ['overlap'], ['Pending review', 'Approved']],
  ['overflow-spill.html', 'overflow', ['spill'], ['button.cta']],
  ['contrast-low.html', 'contrast', ['ratio'], ['Updated 3 days ago']],
  ['contrast-placeholder.html', 'contrast', ['placeholder'], ['input.search']],
];

describe(`defect fixtures (${driver})`, () => {
  for (const [file, rule, checks, targets, viewports] of BAD) {
    it(`${file} → ${rule}/${checks.join('|')}`, async () => {
      const { violations, exitCode, stdout } = await lint(`bad/${file}`, viewports);
      const found = violations.find((v) => v.rule === rule && checks.includes(v.check) && v.severity === 'error' &&
        targets.every((t) => hits(v, t)));
      expect(found, stdout).toBeTruthy();
      expect(exitCode).toBe(1);
    });
  }
});

describe(`clean fixtures (${driver})`, async () => {
  const owner = (await readdir(join(fixtures, 'clean/owner'))).filter((f) => f.endsWith('.html')).map((f) => `owner/${f}`);
  const files = [...(await readdir(join(fixtures, 'clean'))).filter((f) => f.endsWith('.html')), ...owner];
  for (const file of files) {
    it(`${file} has no errors`, async () => {
      const { violations, stdout } = await lint(`clean/${file}`);
      expect(violations.filter((v) => v.severity === 'error'), stdout).toEqual([]);
    });
  }
});

describe(`contrast (${driver})`, () => {
  it('warns once, for the heading over an image, on the clean contrast page', async () => {
    const { violations, stdout } = await lint('clean/clean-contrast.html', [1280]);
    expect(violations.filter((v) => v.rule === 'contrast'), stdout).toEqual([
      expect.objectContaining({ check: 'unverified', severity: 'warn', message: 'text over an image, contrast not checked' }),
    ]);
  });

  it('runs no contrast pass when the rule is off', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'uilint-fx-off-'));
    await writeFile(join(dir, 'uilint.config.json'), JSON.stringify({ rules: { contrast: 'off' } }));
    const r = await run({ urls: [`${server.url}/bad/contrast-low.html`], driver, json: true, max: 50, updateBaseline: false, cwd: dir });
    expect(r.exitCode, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).reports[0].violations).toEqual([]);
  });
});

describe('determinism', () => {
  for (const file of ['clean/clean-dashboard.html', 'bad/align-cross-parent.html']) {
    it(`${file} gives byte-identical output twice`, async () => {
      const a = await run({ urls: [`${server.url}/${file}`], driver, json: false, max: 50, updateBaseline: false, cwd });
      const b = await run({ urls: [`${server.url}/${file}`], driver, json: false, max: 50, updateBaseline: false, cwd });
      expect(b.stdout).toBe(a.stdout);
    });
  }
});
