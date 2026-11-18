import { readFile } from 'node:fs/promises';
import { RULE_NAMES } from '../config.js';
import { UilintError } from '../errors.js';
import { withViewports } from '../report/merge.js';
import type { Locator, RuleName, Violation } from '../types.js';

export interface IgnoreEntry {
  line: number;
  /** A rule name, a check name (e.g. 'spill', 'ellipsis'), or '*'. */
  rule: RuleName | string;
  matcher: { type: 'component' | 'text' | 'selector'; value: string };
  viewport: number | '*';
  reason: string;
}

const CHECKS = new Set([
  'left', 'right', 'center-x', 'top', 'bottom', 'center-y', 'baseline',
  'gap', 'inset-x', 'inset-y', 'min-gap', 'scale',
  'height', 'width',
  'clipped', 'ellipsis', 'spill', 'hscroll', 'overlap',
  'ratio', 'placeholder', 'unverified',
]);

/** Format: `rule | matcher | viewport | reason`, one per line; `#` comments and blank lines allowed. */
export function parseIgnore(text: string, file: string): IgnoreEntry[] {
  const entries: IgnoreEntry[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = i + 1;
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const fail = (why: string): never => { throw new UilintError(`${file}:${line}: ${why}`); };
    const fields = trimmed.split('|').map((f) => f.trim());
    if (fields.length < 4) fail('expected 4 fields: rule | matcher | viewport | reason');
    const [rule, matcherRaw, viewportRaw, ...reasonParts] = fields;
    const reason = reasonParts.join(' | ').trim();
    if (rule !== '*' && !RULE_NAMES.includes(rule as RuleName) && !CHECKS.has(rule)) fail(`unknown rule or check "${rule}"`);
    const m = matcherRaw.match(/^(component|text|selector):(.+)$/);
    if (!m) fail(`matcher must be component:Name, text:substring or selector:css, got "${matcherRaw}"`);
    let viewport: number | '*' = '*';
    if (viewportRaw !== '*') {
      if (!/^\d+$/.test(viewportRaw)) fail(`viewport must be a width or *, got "${viewportRaw}"`);
      viewport = Number(viewportRaw);
    }
    if (!reason) fail('a reason is required');
    entries.push({ line, rule, matcher: { type: m![1] as IgnoreEntry['matcher']['type'], value: m![2].trim() }, viewport, reason });
  });
  return entries;
}

export async function loadIgnore(path: string): Promise<IgnoreEntry[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw new UilintError(`could not read ${path}: ${(e as Error).message}`);
  }
  return parseIgnore(text, path);
}

function matches(l: Locator, m: IgnoreEntry['matcher']): boolean {
  if (m.type === 'component') return l.components.includes(m.value);
  if (m.type === 'text') return (l.text ?? '').includes(m.value);
  return l.selector === m.value;
}

export function applyIgnores(vs: Violation[], entries: IgnoreEntry[]): { kept: Violation[]; used: Set<number> } {
  const used = new Set<number>();
  const kept: Violation[] = [];
  for (const v of vs) {
    let viewports = [...v.viewports];
    for (const e of entries) {
      if (e.rule !== '*' && e.rule !== v.rule && e.rule !== v.check) continue;
      if (!v.elements.some((l) => matches(l, e.matcher))) continue;
      const before = viewports.length;
      viewports = e.viewport === '*' ? [] : viewports.filter((w) => w !== e.viewport);
      if (viewports.length < before) used.add(e.line);
    }
    if (viewports.length) kept.push(viewports.length === v.viewports.length ? v : withViewports(v, viewports));
  }
  return { kept, used };
}
