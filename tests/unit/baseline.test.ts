import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { applyBaseline, loadBaseline, writeBaseline } from '../../src/exceptions/baseline.js';
import { violation } from '../helpers/violations.js';

it('round-trips the baseline and filters known violations', async () => {
  const p = join(await mkdtemp(join(tmpdir(), 'uilint-bl-')), 'uilint.baseline.json');
  const [a, b, c] = ['f1', 'f2', 'f3'].map((fingerprint) => violation({ fingerprint }));
  await writeBaseline(p, [b, a, a]);
  const { kept, baselined } = applyBaseline([a, b, c], await loadBaseline(p));
  expect(kept).toEqual([c]);
  expect(baselined).toBe(2);
  expect(await readFile(p, 'utf8')).toBe('{\n  "version": 1,\n  "fingerprints": [\n    "f1",\n    "f2"\n  ]\n}\n');
});

it('treats a missing baseline as empty', async () =>
  expect((await loadBaseline(join(tmpdir(), 'nope-uilint.json'))).size).toBe(0));

it('rejects a corrupt baseline', async () => {
  const p = join(await mkdtemp(join(tmpdir(), 'uilint-bl-')), 'b.json');
  await writeFile(p, '{ broken');
  await expect(loadBaseline(p)).rejects.toThrow(/b\.json/);
});
