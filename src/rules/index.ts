import { ruleSetting, type UilintConfig } from '../config.js';
import type { Finding, Rule, RuleName, Severity, Snapshot } from '../types.js';
import { alignment } from './alignment.js';
import { overflow } from './overflow.js';
import { sizeConsistency } from './size-consistency.js';
import { spacing } from './spacing.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const RULES: Rule<any>[] = [alignment, spacing, sizeConsistency, overflow];

export const DEFAULT_SEVERITY: Record<RuleName, Severity> = {
  alignment: 'error',
  spacing: 'error',
  'size-consistency': 'error',
  overflow: 'error',
};

const ORDER = new Map(RULES.map((r, i) => [r.name, i]));

export function runRules(snapshot: Snapshot, config: UilintConfig): Finding[] {
  const findings: Finding[] = [];
  for (const rule of RULES) {
    const { severity, options } = ruleSetting(config, rule, DEFAULT_SEVERITY[rule.name]);
    if (severity === 'off') continue;
    findings.push(...rule.check(snapshot, options, severity));
  }
  return findings.sort((p, q) =>
    ORDER.get(p.rule)! - ORDER.get(q.rule)! ||
    (p.boxIds[0] ?? -1) - (q.boxIds[0] ?? -1) ||
    (p.check < q.check ? -1 : p.check > q.check ? 1 : 0));
}
