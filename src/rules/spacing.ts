import { chains, rowPairs, stackedPairs, type Pair } from '../geometry/relations.js';
import { dominant, fmtPx, isNearMiss, round2 } from '../near-miss.js';
import type { Box, Finding, Rule } from '../types.js';

export interface SpacingOptions {
  min: number;
  max: number;
  maxRatio: number;
  maxGap: number;
  maxInset: number;
  minTextGap?: number;
  scale?: number;
}

const isHeading = (b: Box) => /^h[1-6]$/.test(b.tag) || b.role === 'heading';

const offScale = (v: number, scale: number) => {
  const r = v % scale;
  return Math.min(r, scale - r) > 0.5;
};

export const spacing: Rule<SpacingOptions> = {
  name: 'spacing',
  defaults: { min: 0.5, max: 4, maxRatio: 0.25, maxGap: 96, maxInset: 64 },
  check(snapshot, o, severity) {
    const findings: Finding[] = [];
    const window = { min: o.min, max: o.max, maxRatio: o.maxRatio };
    const push = (f: Omit<Finding, 'rule' | 'severity'>) => findings.push({ rule: 'spacing', severity, ...f });

    const stacked = stackedPairs(snapshot.boxes, o);
    const row = rowPairs(snapshot.boxes, o);
    const gapOf = new Map<string, number>();
    for (const p of [...stacked, ...row]) gapOf.set(`${p.a.id}>${p.b.id}`, p.gap);

    for (const chain of [...chains(stacked), ...chains(row)]) {
      if (chain.length < 2) continue;
      const links: Pair[] = [];
      for (let i = 0; i + 1 < chain.length; i++) {
        links.push({ a: chain[i], b: chain[i + 1], gap: gapOf.get(`${chain[i].id}>${chain[i + 1].id}`)! });
      }
      const peersOf = (p: Pair) => chain.filter((c) => c !== p.a && c !== p.b).map((c) => c.id);
      // The space above and below a heading is its own token, set apart on purpose from the rhythm between paragraphs,
      // so heading gaps are compared only with other heading gaps.
      const byRole = new Map<string, Pair[]>();
      for (const l of links) {
        const role = isHeading(l.b) ? 'above-heading' : isHeading(l.a) ? 'below-heading' : 'body';
        const list = byRole.get(role);
        if (list) list.push(l);
        else byRole.set(role, [l]);
      }
      for (const group of byRole.values()) {
        if (group.length < 2) continue;
        const dom = dominant(group.map((l) => l.gap));
        if (!dom) continue;
        const members = new Set(group.flatMap((l) => [l.a, l.b]));
        for (const l of group) {
          if (!isNearMiss(l.gap, dom.value, window)) continue;
          push({
            check: 'gap', message: `gap ${fmtPx(l.gap)}, siblings use ${fmtPx(dom.value)}`,
            measured: l.gap, expected: dom.value, boxIds: [l.a.id, l.b.id],
            peerIds: chain.filter((c) => members.has(c) && c !== l.a && c !== l.b).map((c) => c.id),
          });
        }
      }
      if (o.scale) {
        for (const l of links) {
          if (!offScale(l.gap, o.scale)) continue;
          push({
            check: 'scale', message: `gap ${fmtPx(l.gap)} is not a multiple of ${fmtPx(o.scale)}`,
            measured: l.gap, expected: Math.round(l.gap / o.scale) * o.scale, boxIds: [l.a.id, l.b.id], peerIds: peersOf(l),
          });
        }
      }
    }

    if (o.minTextGap !== undefined) {
      for (const p of stacked) {
        if (p.a.kind !== 'text' || p.b.kind !== 'text' || p.gap >= o.minTextGap) continue;
        push({
          check: 'min-gap', message: `gap ${fmtPx(p.gap)} between text blocks, minimum is ${fmtPx(o.minTextGap)}`,
          measured: p.gap, expected: o.minTextGap, boxIds: [p.a.id, p.b.id], peerIds: [],
        });
      }
    }

    const children = new Map<number, Box[]>();
    for (const b of snapshot.boxes) {
      if (b.containerId === null) continue;
      const list = children.get(b.containerId);
      if (list) list.push(b);
      else children.set(b.containerId, [b]);
    }
    for (const c of snapshot.boxes) {
      if (c.kind !== 'surface') continue;
      const kids = children.get(c.id);
      if (!kids) continue;
      // Measure padding from inside the borders: a bottom divider is not extra padding.
      const r = c.innerRect;
      const sides: { axis: 'x' | 'y'; first: string; second: string; v1: number; v2: number }[] = [];
      // Ragged text makes left/right insets meaningless, so only solid children count horizontally.
      const solid = kids.filter((k) => k.kind !== 'text');
      if (solid.length) {
        sides.push({
          axis: 'x', first: 'left', second: 'right',
          v1: round2(Math.min(...solid.map((k) => k.layoutRect.x)) - r.x),
          v2: round2(r.x + r.width - Math.max(...solid.map((k) => k.layoutRect.x + k.layoutRect.width))),
        });
      }
      sides.push({
        axis: 'y', first: 'top', second: 'bottom',
        v1: round2(Math.min(...kids.map((k) => k.layoutRect.y)) - r.y),
        v2: round2(r.y + r.height - Math.max(...kids.map((k) => k.layoutRect.y + k.layoutRect.height))),
      });
      for (const { axis, first, second, v1, v2 } of sides) {
        if (v1 < 0 || v2 < 0 || v1 > o.maxInset || v2 > o.maxInset) continue;
        const [small, large] = v1 <= v2 ? [v1, v2] : [v2, v1];
        const label = `${first} inset ${fmtPx(v1)}, ${second} inset ${fmtPx(v2)}`;
        if (isNearMiss(small, large, window)) {
          push({ check: `inset-${axis}`, message: label, measured: small, expected: large, boxIds: [c.id], peerIds: [] });
        }
        if (o.scale) {
          for (const v of [v1, v2]) {
            if (!offScale(v, o.scale)) continue;
            push({
              check: 'scale', message: `inset ${fmtPx(v)} is not a multiple of ${fmtPx(o.scale)}`,
              measured: v, expected: Math.round(v / o.scale) * o.scale, boxIds: [c.id], peerIds: [],
            });
          }
        }
      }
    }
    return findings;
  },
};
