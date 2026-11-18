import { isWithin } from '../geometry/relations.js';
import { fmtPx, round2 } from '../near-miss.js';
import type { ActiveSeverity, Box, Finding, Rule, Severity } from '../types.js';

export interface OverflowOptions {
  tolerance: number;
  clipped: Severity;
  ellipsis: Severity;
  spill: Severity;
  spillDecorative: Severity;
  hscroll: Severity;
  overlap: Severity;
}

function cap(sub: Severity, rule: ActiveSeverity): ActiveSeverity | null {
  if (sub === 'off') return null;
  return rule === 'warn' ? 'warn' : sub;
}

export const overflow: Rule<OverflowOptions> = {
  name: 'overflow',
  defaults: { tolerance: 1, clipped: 'error', ellipsis: 'warn', spill: 'error', spillDecorative: 'warn', hscroll: 'error', overlap: 'error' },
  check(snapshot, o, ruleSeverity) {
    const findings: Finding[] = [];
    const add = (sub: Severity, f: Omit<Finding, 'rule' | 'severity'>) => {
      const severity = cap(sub, ruleSeverity);
      if (severity) findings.push({ rule: 'overflow', severity, ...f });
    };
    const byId = new Map(snapshot.boxes.map((b) => [b.id, b]));

    for (const b of snapshot.boxes) {
      if (b.kind === 'text' && b.clipped) {
        const horizontal = b.clipped.x >= b.clipped.y;
        const amount = horizontal ? b.clipped.x : b.clipped.y;
        if (amount > o.tolerance) {
          add(o.clipped, {
            check: 'clipped', message: `text clipped ${horizontal ? 'horizontally' : 'vertically'} by ${fmtPx(amount)}`,
            measured: amount, expected: 0, boxIds: [b.id], peerIds: [],
          });
        }
      }
      if (b.kind === 'text' && b.ellipsis) {
        add(o.ellipsis, { check: 'ellipsis', message: 'text truncated with ellipsis', measured: 0, expected: null, boxIds: [b.id], peerIds: [] });
      }
      // Clipped or truncated text already got its own finding; its full text rect always pokes out.
      if (b.containerId !== null && !b.clipped && !b.ellipsis) {
        const c = byId.get(b.containerId);
        if (c) {
          const r = b.rect, cr = c.rect;
          const out = round2(Math.max(cr.x - r.x, r.x + r.width - (cr.x + cr.width), cr.y - r.y, r.y + r.height - (cr.y + cr.height)));
          if (out > o.tolerance) {
            const decorative = b.kind === 'media' || b.kind === 'surface';
            add(decorative ? o.spillDecorative : o.spill, {
              check: 'spill', message: `extends ${fmtPx(out)} outside its container`,
              measured: out, expected: 0, boxIds: [b.id], peerIds: [c.id],
            });
          }
        }
      }
    }

    const { scrollWidth, clientWidth } = snapshot.page;
    const scroll = round2(scrollWidth - clientWidth);
    if (scroll > o.tolerance) {
      const culprits = snapshot.boxes
        .filter((b) => b.layer === 0 && b.rect.x + b.rect.width > clientWidth + o.tolerance)
        .sort((p, q) => q.rect.x + q.rect.width - (p.rect.x + p.rect.width) || p.id - q.id)
        .slice(0, 3);
      add(o.hscroll, {
        check: 'hscroll', message: `page scrolls horizontally by ${fmtPx(scroll)}`,
        measured: scroll, expected: 0, boxIds: culprits.map((b) => b.id), peerIds: [],
      });
    }

    const solid = snapshot.boxes
      .filter((b) => b.kind === 'text' || b.kind === 'control')
      .sort((p, q) => p.rect.x - q.rect.x || p.id - q.id);
    const pairs: [Box, Box, number, number][] = [];
    for (let i = 0; i < solid.length; i++) {
      const a = solid[i];
      for (let j = i + 1; j < solid.length; j++) {
        const b = solid[j];
        if (b.rect.x >= a.rect.x + a.rect.width) break;
        if (a.layer !== b.layer || isWithin(a, b.id, byId) || isWithin(b, a.id, byId)) continue;
        const w = round2(Math.min(a.rect.x + a.rect.width, b.rect.x + b.rect.width) - Math.max(a.rect.x, b.rect.x));
        const h = round2(Math.min(a.rect.y + a.rect.height, b.rect.y + b.rect.height) - Math.max(a.rect.y, b.rect.y));
        if (w > o.tolerance && h > o.tolerance) pairs.push(a.id < b.id ? [a, b, w, h] : [b, a, w, h]);
      }
    }
    pairs.sort((p, q) => p[0].id - q[0].id || p[1].id - q[1].id);
    for (const [a, b, w, h] of pairs) {
      add(o.overlap, {
        check: 'overlap', message: `text overlaps another element by ${round2(w)}×${round2(h)}px`,
        measured: round2(w * h), expected: 0, boxIds: [a.id, b.id], peerIds: [],
      });
    }
    return findings;
  },
};
