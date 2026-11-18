import { expect, it } from 'vitest';
import { loadDriver } from '../../src/drivers/load.js';
import { UilintError } from '../../src/errors.js';

const cwd = process.cwd();

it('loads the built-in playwright driver by name', async () => {
  const d = await loadDriver({ name: 'playwright', options: {} }, cwd, []);
  expect(d.name).toBe('playwright');
  await d.close();
});

it('loads a custom adapter from a path', async () => {
  const d = await loadDriver({ name: './tests/drivers/fixtures/wrapped-playwright.ts', options: {} }, cwd, ['http://x/']);
  expect(d.name).toBe('wrapped');
  await d.close();
});

it('explains a missing export', async () => {
  const p = loadDriver({ name: './tests/drivers/fixtures/no-export.ts', options: {} }, cwd, []);
  await expect(p).rejects.toThrow(/does not export createDriver/);
  await expect(p).rejects.toBeInstanceOf(UilintError);
});

it('explains a missing module', async () =>
  await expect(loadDriver({ name: './nope.ts', options: {} }, cwd, [])).rejects.toThrow(/could not load driver .*nope\.ts/));

it('rejects an unknown driver name', async () =>
  await expect(loadDriver({ name: 'selenium', options: {} }, cwd, [])).rejects.toThrow(/unknown driver "selenium"/));
