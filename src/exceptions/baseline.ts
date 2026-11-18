import { readFile, writeFile } from 'node:fs/promises';
import { UilintError } from '../errors.js';
import type { Violation } from '../types.js';

export interface BaselineFile { version: 1; fingerprints: string[] }

export async function loadBaseline(path: string): Promise<Set<string>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw new UilintError(`could not read ${path}: ${(e as Error).message}`);
  }
  try {
    const data = JSON.parse(text) as BaselineFile;
    if (data.version !== 1 || !Array.isArray(data.fingerprints)) throw new Error('expected { version: 1, fingerprints: [...] }');
    return new Set(data.fingerprints);
  } catch (e) {
    throw new UilintError(`${path}: invalid baseline (${(e as Error).message})`);
  }
}

export async function writeBaseline(path: string, vs: Violation[]): Promise<void> {
  const data: BaselineFile = { version: 1, fingerprints: [...new Set(vs.map((v) => v.fingerprint))].sort() };
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}

export function applyBaseline(vs: Violation[], known: Set<string>): { kept: Violation[]; baselined: number } {
  const kept = vs.filter((v) => !known.has(v.fingerprint));
  return { kept, baselined: vs.length - kept.length };
}
