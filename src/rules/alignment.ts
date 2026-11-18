import { rowPairs, scopeKey, stackedPairs, type Pair } from '../geometry/relations.js';
import { fmtPx, isNearMiss, round2 } from '../near-miss.js';
import type { Box, Finding, Rule } from '../types.js';

export interface AlignmentOptions {
  min: number;
  max: number;
  maxGap: number;
  /** Stacked boxes: how many others must share the edge exactly before a near miss counts. */
  minColumnPeers: number;
  /** Boxes in a row: the same, for top/bottom/center/baseline. */
  minRowPeers: number;
}

type Edge = 'left' | 'right' | 'center-x' | 'top' | 'bottom' | 'center-y' | 'baseline';

const EDGE_VALUE: Record<Edge, (b: Box) => number> = {
  left: (b) => b.rect.x,
  right: (b) => b.rect.x + b.rect.width,
  'center-x': (b) => b.rect.x + b.rect.width / 2,
  top: (b) => b.rect.y,
  bottom: (b) => b.rect.y + b.rect.height,
  'center-y': (b) => b.rect.y + b.rect.height / 2,
  baseline: (b) => b.baseline ?? b.rect.y + b.rect.height,
};

const EDGE_LABEL: Record<Edge, string> = {
  left: 'left edge',
  right: 'right edge',
  'center-x': 'horizontal center',
  top: 'top edge',
  bottom: 'bottom edge',
  'center-y': 'vertical center',
  baseline: 'baseline',
};

const ALIGN_EDGE = { left: 'left', center: 'center-x', right: 'right' } as const;

function stackedEdges(a: Box, b: Box): Edge[] {
  if (a.kind === 'text' && b.kind === 'text') {
    if (!a.textAlign || a.textAlign !== b.textAlign) return [];
    return [ALIGN_EDGE[a.textAlign]];
  }
  return ['left', 'right', 'center-x'];
}

function rowEdges(a: Box, b: Box): Edge[] {
  const edges: Edge[] = ['top', 'bottom', 'center-y'];
  if (a.kind === 'text' && b.kind === 'text') edges.push('baseline');
  return edges;
}

/**
 * True when `a` lines up with the stack of boxes beside it rather than with `b` alone: b plus anything above or below b
 * in its column that overlaps a vertically. An avatar centered on a name-over-email block is aligned with the block.
 */
function alignedWithStack(a: Box, b: Box, boxes: Box[], tolerance: number): boolean {
  const key = scopeKey(b);
  const stack = boxes.filter((c) => c === b || (c.id !== a.id && scopeKey(c) === key
    && c.rect.x < b.rect.x + b.rect.width && b.rect.x < c.rect.x + c.rect.width
    && c.rect.y < a.rect.y + a.rect.height && a.rect.y < c.rect.y + c.rect.height));
  if (stack.length < 2) return false;
  const top = Math.min(...stack.map((c) => c.rect.y));
  const bottom = Math.max(...stack.map((c) => c.rect.y + c.rect.height));
  const aTop = a.rect.y, aBottom = a.rect.y + a.rect.height;
  return Math.abs(aTop - top) <= tolerance || Math.abs(aBottom - bottom) <= tolerance
    || Math.abs((aTop + aBottom) / 2 - (top + bottom) / 2) <= tolerance;
}

/** Connected components over all pairs: boxes that sit in one column (or one row). */
function components(pairs: Pair[]): Map<number, Box[]> {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(x, r);
    return r;
  };
  const boxes = new Map<number, Box>();
  for (const { a, b } of pairs) {
    for (const x of [a, b]) if (!parent.has(x.id)) { parent.set(x.id, x.id); boxes.set(x.id, x); }
    const ra = find(a.id), rb = find(b.id);
    if (ra !== rb) parent.set(rb, ra);
  }
  const byRoot = new Map<number, Box[]>();
  for (const [id, b] of boxes) {
    const r = find(id);
    const list = byRoot.get(r);
    if (list) list.push(b);
    else byRoot.set(r, [b]);
  }
  const byBox = new Map<number, Box[]>();
  for (const list of byRoot.values()) {
    list.sort((p, q) => p.id - q.id);
    for (const b of list) byBox.set(b.id, list);
  }
  return byBox;
}

function check(pairs: Pair[], edgesFor: (a: Box, b: Box) => Edge[], o: AlignmentOptions, minPeers: number, where: (n: number) => string,
  severity: Finding['severity'], alsoAligned: (a: Box, b: Box) => boolean = () => false): Finding[] {
  const comp = components(pairs);
  const group = (x: Box, e: Edge) =>
    (comp.get(x.id) ?? [x]).filter((m) => Math.abs(EDGE_VALUE[e](m) - EDGE_VALUE[e](x)) <= o.min);
  const findings: Finding[] = [];
  const reported = new Set<string>();
  for (const { a, b } of pairs) {
    const edges = edgesFor(a, b);
    if (edges.length === 0) continue;
    const diffs = edges.map((e) => ({ e, d: round2(Math.abs(EDGE_VALUE[e](a) - EDGE_VALUE[e](b))) }));
    if (diffs.some(({ d }) => d <= o.min)) continue;
    const best = diffs.reduce((p, q) => (q.d < p.d ? q : p));
    if (!isNearMiss(best.d, 0, { min: o.min, max: o.max })) continue;
    if (alsoAligned(a, b)) continue;
    const ga = group(a, best.e), gb = group(b, best.e);
    const [offender, peers] = ga.length < gb.length ? [a, gb] : [b, ga];
    // Two unrelated boxes often land a few px apart by chance; a real guide line is shared by several.
    if (peers.length < minPeers) continue;
    const key = `${offender.id}:${best.e}`;
    if (reported.has(key)) continue;
    reported.add(key);
    findings.push({
      rule: 'alignment',
      check: best.e,
      severity,
      message: `${EDGE_LABEL[best.e]} ${fmtPx(best.d)} off from ${where(peers.length)}`,
      measured: best.d,
      expected: 0,
      boxIds: [offender.id],
      peerIds: peers.map((p) => p.id),
    });
  }
  return findings;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const alignment: Rule<AlignmentOptions> = {
  name: 'alignment',
  defaults: { min: 0.5, max: 4, maxGap: 48, minColumnPeers: 2, minRowPeers: 1 },
  check(snapshot, o, severity) {
    const stacked = check(stackedPairs(snapshot.boxes, o), stackedEdges, o, o.minColumnPeers, (n) => `${plural(n, 'stacked item')}`, severity);
    const row = check(rowPairs(snapshot.boxes, o), rowEdges, o, o.minRowPeers, (n) => `${plural(n, 'item')} in the row`, severity,
      (a, b) => alignedWithStack(a, b, snapshot.boxes, o.min) || alignedWithStack(b, a, snapshot.boxes, o.min));
    return [...stacked, ...row];
  },
};

