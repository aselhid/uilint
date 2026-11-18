import type { Locator, Violation } from '../types.js';

export interface UrlReport { url: string; finalUrl: string; violations: Violation[]; baselined: number }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function samePage(a: string, b: string): boolean {
  try {
    const x = new URL(a), y = new URL(b);
    return x.origin === y.origin && x.pathname === y.pathname;
  } catch {
    return a === b;
  }
}

function locatorLine(l: Locator): string {
  const parts = [l.text ? `${l.selector} "${l.text}"` : l.selector];
  if (l.components[0]) parts.push(`<${l.components[0]}>`);
  if (l.source) parts.push(l.source);
  return parts.join('  ');
}

export function violationBlock(v: Violation): string {
  const head = [v.severity.padEnd(5), v.rule, v.message, `@${v.viewports.join(',')}`];
  if (v.count > 1) head.push(`(×${v.count})`);
  const lines = [head.join('  ')];
  for (const el of v.elements) lines.push(`  ${locatorLine(el)}`);
  if (v.peers.length) {
    const label = v.rule === 'alignment' ? 'aligned with' : 'compared with';
    const more = v.peerCount > 1 ? `  (+${v.peerCount - 1} more)` : '';
    lines.push(`  ${label}: ${locatorLine(v.peers[0])}${more}`);
  }
  return lines.join('\n');
}

export function formatText(reports: UrlReport[], notes: string[], max: number): string {
  const blocks: string[] = [];
  let shown = 0, hidden = 0;
  for (const r of reports) {
    const errors = r.violations.filter((v) => v.severity === 'error').length;
    const warnings = r.violations.length - errors;
    let header = `uilint  ${r.url}   ${plural(errors, 'error')}, ${plural(warnings, 'warning')}`;
    if (r.baselined > 0) header += `, ${r.baselined} baselined`;
    if (!samePage(r.url, r.finalUrl)) header += `\n  note  landed on ${r.finalUrl}`;
    if (r.violations.length === 0) {
      blocks.push(`${header}\n  no problems found`);
      continue;
    }
    const parts = [header];
    for (const v of r.violations) {
      if (shown >= max) { hidden++; continue; }
      shown++;
      parts.push(violationBlock(v));
    }
    blocks.push(parts.join('\n\n'));
  }
  if (hidden > 0) blocks.push(`… ${hidden} more not shown (use --max)`);
  if (notes.length) blocks.push(notes.map((n) => `note  ${n}`).join('\n'));
  return blocks.join('\n\n') + '\n';
}

export function formatJson(reports: UrlReport[], notes: string[]): string {
  return JSON.stringify({ version: 1, reports, notes }, null, 2) + '\n';
}
