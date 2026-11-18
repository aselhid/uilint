import { createRequire } from 'node:module';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import { UilintError } from '../errors.js';
import type { CreateDriver, Driver } from '../types.js';
import { createPlaywrightDriver } from './playwright.js';

const isPath = (s: string) => s.startsWith('.') || isAbsolute(s);

async function importFactory(file: string, label: string): Promise<CreateDriver> {
  let mod: Record<string, unknown>;
  try {
    mod = await tsImport(pathToFileURL(file).href, import.meta.url);
  } catch (e) {
    throw new UilintError(`could not load driver ${label}: ${(e as Error).message.split('\n')[0]}`);
  }
  const factory = (mod.createDriver ?? (mod.default as Record<string, unknown> | undefined)?.createDriver) as CreateDriver | undefined;
  if (typeof factory !== 'function') throw new UilintError(`driver ${label} does not export createDriver(options)`);
  return factory;
}

/** Built-in name, a module path, or an installed package that exports createDriver(options). */
export async function loadDriver(spec: { name: string; options: Record<string, unknown> }, cwd: string, targets: string[]): Promise<Driver> {
  const options = { ...spec.options, targets };
  if (spec.name === 'playwright') return createPlaywrightDriver(options);
  if (spec.name === 'betterwright') {
    const { createBetterWrightDriver } = await import('./betterwright.js');
    return createBetterWrightDriver(options);
  }
  if (isPath(spec.name)) return (await importFactory(resolve(cwd, spec.name), spec.name))(options);
  let file: string;
  try {
    file = createRequire(join(cwd, 'noop.js')).resolve(spec.name);
  } catch {
    throw new UilintError(`unknown driver "${spec.name}": not playwright, betterwright, a path, or an installed package`);
  }
  return (await importFactory(file, spec.name))(options);
}
