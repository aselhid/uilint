import type { ActiveSeverity, Severity } from '../types.js';

/** A sub-check's own severity, never above the rule's: a rule set to 'warn' never produces an error. */
export function capSeverity(sub: Severity, rule: ActiveSeverity): ActiveSeverity | null {
  if (sub === 'off') return null;
  return rule === 'warn' ? 'warn' : sub;
}
