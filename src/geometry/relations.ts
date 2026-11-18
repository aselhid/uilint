import { round2 } from '../near-miss.js';
import type { Box, Rect } from '../types.js';

/** `a` is above (stacked) or left of (row) `b`; `gap` is measured between layoutRects. */
export interface Pair { a: Box; b: Box; gap: number }

/** Boxes are only compared within one scope: same layer and same visual container. */
export function scopeKey(b: Box): string {
  return `${b.layer}:${b.containerId ?? 'root'}`;
}

export function contains(outer: Rect, inner: Rect, tol = 0.5): boolean {
  return (
    inner.x >= outer.x - tol &&
    inner.y >= outer.y - tol &&
    inner.x + inner.width <= outer.x + outer.width + tol &&
    inner.y + inner.height <= outer.y + outer.height + tol
  );
}

/** True when `box` sits (transitively) inside the box with id `ancestorId`. */
export function isWithin(box: Box, ancestorId: number, byId: Map<number, Box>): boolean {
  let cur = box.containerId;
  const seen = new Set<number>();
  while (cur !== null && !seen.has(cur)) {
    if (cur === ancestorId) return true;
    seen.add(cur);
    cur = byId.get(cur)?.containerId ?? null;
  }
  return false;
}

interface Axis {
  start(r: Rect): number;
  end(r: Rect): number;
  crossStart(r: Rect): number;
  crossEnd(r: Rect): number;
}

const VERTICAL: Axis = {
  start: (r) => r.y,
  end: (r) => r.y + r.height,
  crossStart: (r) => r.x,
  crossEnd: (r) => r.x + r.width,
};

const HORIZONTAL: Axis = {
  start: (r) => r.x,
  end: (r) => r.x + r.width,
  crossStart: (r) => r.y,
  crossEnd: (r) => r.y + r.height,
};

function groupByScope(boxes: Box[]): Box[][] {
  const groups = new Map<string, Box[]>();
  for (const b of boxes) {
    const k = scopeKey(b);
    const g = groups.get(k);
    if (g) g.push(b);
    else groups.set(k, [b]);
  }
  return [...groups.values()];
}

/** First index in `sorted` (by axis start) whose start is >= value. */
function lowerBound(sorted: Box[], value: number, axis: Axis): number {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (axis.start(sorted[mid].layoutRect) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function nearestPairs(boxes: Box[], maxGap: number, axis: Axis): Pair[] {
  const pairs: Pair[] = [];
  for (const scope of groupByScope(boxes)) {
    const sorted = [...scope].sort((p, q) => axis.start(p.layoutRect) - axis.start(q.layoutRect) || p.id - q.id);
    for (const a of scope) {
      const aEnd = axis.end(a.layoutRect);
      let best: Pair | null = null;
      for (let i = lowerBound(sorted, aEnd - 0.005, axis); i < sorted.length; i++) {
        const b = sorted[i];
        const gap = round2(axis.start(b.layoutRect) - aEnd);
        if (gap > maxGap) break;
        if (b === a || gap < 0) continue;
        const overlap = Math.min(axis.crossEnd(a.layoutRect), axis.crossEnd(b.layoutRect)) -
          Math.max(axis.crossStart(a.layoutRect), axis.crossStart(b.layoutRect));
        if (overlap <= 0) continue;
        if (contains(a.rect, b.rect) || contains(b.rect, a.rect)) continue;
        if (!best || gap < best.gap || (gap === best.gap && b.id < best.b.id)) best = { a, b, gap };
      }
      if (best) pairs.push(best);
    }
  }
  return pairs.sort((p, q) => p.a.id - q.a.id || p.b.id - q.b.id);
}

/** Each box paired with its nearest box below in the same scope, overlapping horizontally. */
export function stackedPairs(boxes: Box[], opts: { maxGap: number }): Pair[] {
  return nearestPairs(boxes, opts.maxGap, VERTICAL);
}

/** Each box paired with its nearest box to the right in the same scope, overlapping vertically. */
export function rowPairs(boxes: Box[], opts: { maxGap: number }): Pair[] {
  return nearestPairs(boxes, opts.maxGap, HORIZONTAL);
}

/** Follows a → b links into maximal sequences. A box with two or more incoming links starts a new chain. */
export function chains(pairs: Pair[]): Box[][] {
  const next = new Map<number, Box>();
  const incoming = new Map<number, number>();
  const nodes = new Map<number, Box>();
  for (const { a, b } of pairs) {
    next.set(a.id, b);
    incoming.set(b.id, (incoming.get(b.id) ?? 0) + 1);
    nodes.set(a.id, a);
    nodes.set(b.id, b);
  }
  const result: Box[][] = [];
  const starts = [...nodes.values()].filter((n) => (incoming.get(n.id) ?? 0) !== 1).sort((p, q) => p.id - q.id);
  for (const start of starts) {
    const chain = [start];
    let cur = next.get(start.id);
    while (cur && incoming.get(cur.id) === 1) {
      chain.push(cur);
      cur = next.get(cur.id);
    }
    result.push(chain);
  }
  return result.sort((p, q) => p[0].id - q[0].id);
}
