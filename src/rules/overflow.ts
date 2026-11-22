import { isWithin } from '../geometry/relations.js';
import { fmtPx, round2 } from '../near-miss.js';
import type { Box, Finding, Rect, Rule, Severity } from '../types.js';
import { capSeverity } from './cap.js';

export interface OverflowOptions {
  tolerance: number;
  clipped: Severity;
  ellipsis: Severity;
  spill: Severity;
  spillDecorative: Severity;
  hscroll: Severity;
  overlap: Severity;
}

function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const w = Math.min(a.x + a.width, b.x + b.width) - x, h = Math.min(a.y + a.height, b.y + b.height) - y;
  return w > 0 && h > 0 ? { x, y, width: w, height: h } : null;
}

/** What actually paints: text as its runs of glyphs, so a paragraph never "overlaps" the inline code it wraps around. */
const pieces = (b: Box): Rect[] => (b.kind === 'text' && b.lines.length ? b.lines : [b.rect]);

/** The largest overlap between any piece of `a` and any piece of `b`. */
function overlapOf(a: Box, b: Box): { w: number; h: number } | null {
  let best: { w: number; h: number } | null = null;
  for (const p of pieces(a)) {
    for (const q of pieces(b)) {
      const r = intersect(p, q);
      if (r && (!best || r.width * r.height > best.w * best.h)) best = { w: round2(r.width), h: round2(r.height) };
    }
  }
  return best;
}

export const overflow: Rule<OverflowOptions> = {
  name: 'overflow',
  defaults: { tolerance: 1, clipped: 'error', ellipsis: 'warn', spill: 'error', spillDecorative: 'warn', hscroll: 'error', overlap: 'error' },
  check(snapshot, o, ruleSeverity) {
    const findings: Finding[] = [];
    const add = (sub: Severity, f: Omit<Finding, 'rule' | 'severity'>) => {
      const severity = capSeverity(sub, ruleSeverity);
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
        const decorative = b.kind === 'media' || b.kind === 'surface';
        // An image cropped by overflow: hidden (a zoomed canvas, a cover photo) only spills as far as it is visible.
        // Controls keep their full box: a button cut off by its card is a defect either way.
        const r = decorative && b.clipRect ? intersect(b.rect, b.clipRect) : b.rect;
        if (c && r) {
          const cr = c.rect;
          const out = round2(Math.max(cr.x - r.x, r.x + r.width - (cr.x + cr.width), cr.y - r.y, r.y + r.height - (cr.y + cr.height)));
          if (out > o.tolerance) {
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
        const hit = overlapOf(a, b);
        if (hit && hit.w > o.tolerance && hit.h > o.tolerance) pairs.push(a.id < b.id ? [a, b, hit.w, hit.h] : [b, a, hit.w, hit.h]);
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
