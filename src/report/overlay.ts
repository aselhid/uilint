import { EDGE_VALUE, type Edge } from '../rules/alignment.js';
import type { Box, Rect } from '../types.js';
import type { Hit } from './merge.js';

/** A page as drawn in the report, in CSS px. captured: how much of its height the screenshot covers (0 without one). */
export interface PageGeom { width: number; height: number; captured: number }

export type Shape =
  | { kind: 'outline'; role: 'offender' | 'peer'; rect: Rect }
  | { kind: 'shade'; rect: Rect; label: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; label: string };

/** One finding at one viewport: the part of the page to show and what to draw on it. */
export interface View { viewport: number; crop: Rect; shapes: Shape[]; belowCapture: boolean }

const PAD = 48;
const MIN_W = 240;
const MIN_H = 120;
const X_EDGES = new Set<Edge>(['left', 'right', 'center-x']);

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

function union(rects: Rect[]): Rect {
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width)), bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** The space between two boxes, measured on their layout boxes the way the spacing rule does. */
function gapRect(a: Box, b: Box): Rect {
  const [p, q] = a.layoutRect.y <= b.layoutRect.y ? [a.layoutRect, b.layoutRect] : [b.layoutRect, a.layoutRect];
  if (q.y >= p.y + p.height) {
    const u = union([p, q]);
    return { x: u.x, y: p.y + p.height, width: u.width, height: q.y - (p.y + p.height) };
  }
  const [l, r] = a.layoutRect.x <= b.layoutRect.x ? [a.layoutRect, b.layoutRect] : [b.layoutRect, a.layoutRect];
  const u = union([l, r]);
  return { x: l.x + l.width, y: u.y, width: r.x - (l.x + l.width), height: u.height };
}

function intersection(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) };
}

/** The strip a page scrolls sideways into, as a rect spanning rows y..y+height. */
const hscrollStrip = (viewport: number, page: PageGeom, y: number, height: number): Rect =>
  ({ x: viewport, y, width: Math.max(0, page.width - viewport), height });

function cropFor(hit: Hit, page: PageGeom): Rect {
  const rects = [...hit.offenders, ...hit.peers].map((b) => b.rect);
  if (hit.finding.check === 'hscroll') rects.push(hscrollStrip(hit.viewport, page, union(rects).y, 1));
  const u = union(rects);
  let x = u.x - PAD, y = u.y - PAD, w = u.width + 2 * PAD, h = u.height + 2 * PAD;
  if (w < MIN_W) { x -= (MIN_W - w) / 2; w = MIN_W; }
  if (h < MIN_H) { y -= (MIN_H - h) / 2; h = MIN_H; }
  const x0 = Math.max(0, x), y0 = Math.max(0, y);
  return { x: x0, y: y0, width: Math.min(page.width, x + w) - x0, height: Math.min(page.height, y + h) - y0 };
}

function measurement(hit: Hit, page: PageGeom, crop: Rect): Shape | null {
  const { finding: f, offenders: [a, b], peers } = hit;
  if (!a) return null;
  switch (f.check) {
    case 'gap':
      return b ? { kind: 'shade', rect: gapRect(a, b), label: `${px(f.measured)} · siblings ${px(f.expected ?? 0)}` } : null;
    case 'min-gap':
      return b ? { kind: 'shade', rect: gapRect(a, b), label: `${px(f.measured)} · min ${px(f.expected ?? 0)}` } : null;
    case 'scale':
      return { kind: 'shade', rect: b ? gapRect(a, b) : a.rect, label: f.message };
    case 'height':
    case 'width':
      return { kind: 'shade', rect: a.rect, label: `${px(f.measured)} · others ${px(f.expected ?? 0)}` };
    case 'hscroll':
      return { kind: 'shade', rect: hscrollStrip(hit.viewport, page, crop.y, crop.height), label: `+${px(f.measured)}` };
    case 'overlap':
      return b ? { kind: 'shade', rect: intersection(a.rect, b.rect), label: 'overlap' } : null;
    case 'clipped':
    case 'ellipsis':
    case 'spill':
    case 'inset-x':
    case 'inset-y':
      return { kind: 'shade', rect: a.rect, label: f.message };
  }
  if (f.check in EDGE_VALUE && peers.length) {
    const edge = f.check as Edge;
    const at = EDGE_VALUE[edge](peers[0]);
    const u = union([...hit.offenders, ...peers].map((x) => x.rect));
    const label = `${px(f.measured)} off`;
    return X_EDGES.has(edge)
      ? { kind: 'line', x1: at, y1: u.y, x2: at, y2: u.y + u.height, label }
      : { kind: 'line', x1: u.x, y1: at, x2: u.x + u.width, y2: at, label };
  }
  return null;
}

/** One view per viewport (ascending). The crop follows the first hit there; every hit is drawn. */
export function buildViews(hits: Hit[], pages: Map<number, PageGeom>): View[] {
  const byViewport = new Map<number, Hit[]>();
  for (const h of hits) byViewport.set(h.viewport, [...(byViewport.get(h.viewport) ?? []), h]);
  return [...byViewport.entries()].sort(([a], [b]) => a - b).map(([viewport, hs]) => {
    const page = pages.get(viewport) ?? { width: viewport, height: 0, captured: 0 };
    const crop = cropFor(hs[0], page);
    const shapes: Shape[] = [];
    for (const h of hs) {
      for (const p of h.peers) shapes.push({ kind: 'outline', role: 'peer', rect: p.rect });
      for (const o of h.offenders) shapes.push({ kind: 'outline', role: 'offender', rect: o.rect });
      const m = measurement(h, page, crop);
      if (m) shapes.push(m);
    }
    const first = hs[0].offenders[0];
    return { viewport, crop, shapes, belowCapture: !!first && first.rect.y >= page.captured };
  });
}
