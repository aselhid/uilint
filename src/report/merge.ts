import { createHash } from 'node:crypto';
import { RULES } from '../rules/index.js';
import type { Finding, Locator, Snapshot, Violation } from '../types.js';

const RULE_ORDER = new Map(RULES.map((r, i) => [r.name, i]));

const locKey = (l: Locator) => `${l.selector}::${l.text ?? ''}`;

/** Stable id for the baseline: never includes pixel values, viewports, counts or the query string. */
export function fingerprint(url: string, v: Pick<Violation, 'rule' | 'check' | 'elements'>): string {
  let path: string;
  try { path = new URL(url).pathname; } catch { path = url; }
  const els = v.elements.map((l) => `${l.components.join('>')}::${l.text ?? l.selector}`).join('|');
  return createHash('sha1').update(`${path}|${v.rule}|${v.check}|${els}`).digest('hex').slice(0, 12);
}

/** Turns per-viewport findings into violations, merging the same problem seen at several widths. */
export function mergeViewports(url: string, runs: { snapshot: Snapshot; findings: Finding[] }[]): Violation[] {
  const byKey = new Map<string, Violation>();
  for (const { snapshot, findings } of runs) {
    const byId = new Map(snapshot.boxes.map((b) => [b.id, b]));
    for (const f of findings) {
      const elements = f.boxIds.map((id) => byId.get(id)?.locator).filter((l): l is Locator => !!l);
      const key = [f.rule, f.check, f.severity, f.measured, f.expected, elements.map(locKey).join('|')].join('#');
      const existing = byKey.get(key);
      if (existing) {
        if (!existing.viewports.includes(snapshot.page.viewport)) existing.viewports.push(snapshot.page.viewport);
        continue;
      }
      const offender = byId.get(f.boxIds[0]);
      const v: Violation = {
        url,
        rule: f.rule,
        check: f.check,
        severity: f.severity,
        message: f.message,
        measured: f.measured,
        expected: f.expected,
        elements,
        peers: f.peerIds.slice(0, 3).map((id) => byId.get(id)?.locator).filter((l): l is Locator => !!l),
        peerCount: f.peerIds.length,
        viewports: [snapshot.page.viewport],
        count: 1,
        fingerprint: '',
        anchor: offender ? { y: offender.rect.y, x: offender.rect.x } : { y: 0, x: 0 },
      };
      v.fingerprint = fingerprint(url, v);
      byKey.set(key, v);
    }
  }
  const out = [...byKey.values()];
  for (const v of out) v.viewports.sort((a, b) => a - b);
  return out;
}

const stripNth = (s: string) => s.replace(/:nth-(of-type|child)\(\d+\)/g, '');

/** Collapses the same problem on repeated items (list rows, cards) into one entry with a count. */
export function collapseRepeats(vs: Violation[]): Violation[] {
  const groups = new Map<string, Violation[]>();
  for (const v of vs) {
    const key = [v.url, v.rule, v.check, v.severity, v.measured, v.expected, v.viewports.join(','),
      v.elements.map((l) => `${stripNth(l.selector)}::${l.components.join('>')}`).join('|')].join('#');
    const g = groups.get(key);
    if (g) g.push(v);
    else groups.set(key, [v]);
  }
  return [...groups.values()].map((g) => {
    const first = [...g].sort((a, b) => a.anchor.y - b.anchor.y || a.anchor.x - b.anchor.x)[0];
    return { ...first, count: g.reduce((n, v) => n + v.count, 0) };
  });
}

export function sortViolations(vs: Violation[], urlOrder: string[]): Violation[] {
  const urlIndex = (u: string) => { const i = urlOrder.indexOf(u); return i === -1 ? urlOrder.length : i; };
  return [...vs].sort((a, b) =>
    (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1) ||
    urlIndex(a.url) - urlIndex(b.url) ||
    RULE_ORDER.get(a.rule)! - RULE_ORDER.get(b.rule)! ||
    a.anchor.y - b.anchor.y ||
    a.anchor.x - b.anchor.x ||
    (a.check < b.check ? -1 : a.check > b.check ? 1 : 0) ||
    (a.message < b.message ? -1 : a.message > b.message ? 1 : 0));
}
