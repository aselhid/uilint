/** r, g, b in 0–255 (sRGB), a in 0–1. */
export type RGBA = [number, number, number, number];

/** A colour painted at a point, inside the opacity groups (ids, outermost first) of the element that paints it. */
export interface Layer { color: RGBA; groups: number[] }

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

/** WCAG 2.x relative luminance of an opaque colour. */
export function luminance(c: RGBA): number {
  return 0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2]);
}

/** WCAG 2.x contrast ratio, 1–21, of two opaque colours. */
export function contrastRatio(a: RGBA, b: RGBA): number {
  const la = luminance(a), lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Premultiplied colour. */
type Pre = [number, number, number, number];

const premultiply = (c: RGBA): Pre => [c[0] * c[3], c[1] * c[3], c[2] * c[3], c[3]];

/** src over dst, both premultiplied; dst is changed in place. */
function over(dst: Pre, src: Pre): void {
  const k = 1 - src[3];
  for (let i = 0; i < 4; i++) dst[i] = src[i] + dst[i] * k;
}

/**
 * Paints layers (bottom to top) over an opaque base the way a browser composites them:
 * the layers of an opacity group are painted onto their own transparent canvas, which is
 * then faded by the group's opacity and painted onto what lies below.
 */
export function composite(base: RGBA, layers: Layer[], opacity: Record<number, number>): RGBA {
  const root: Pre = premultiply([base[0], base[1], base[2], 1]);
  const open: { id: number; canvas: Pre }[] = [];
  const top = () => (open.length ? open[open.length - 1].canvas : root);
  const close = () => {
    const g = open.pop()!;
    const o = opacity[g.id] ?? 1;
    over(top(), g.canvas.map((v) => v * o) as Pre);
  };
  for (const layer of layers) {
    let shared = 0;
    while (shared < open.length && shared < layer.groups.length && open[shared].id === layer.groups[shared]) shared++;
    while (open.length > shared) close();
    for (const id of layer.groups.slice(shared)) open.push({ id, canvas: [0, 0, 0, 0] });
    over(top(), premultiply(layer.color));
  }
  while (open.length) close();
  return [root[0], root[1], root[2], 1];
}

export function toHex(c: RGBA): string {
  return '#' + c.slice(0, 3).map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

/** Cuts to 2 decimals, so a failing ratio never prints as the minimum it missed. */
export function truncate2(n: number): number {
  return Math.floor(n * 100 + 1e-9) / 100;
}

/** WCAG large text: 18pt (24px), or 14pt (18.66px) bold. */
export function isLarge(fontSizePx: number, weight: number): boolean {
  return fontSizePx >= 24 || (fontSizePx >= 18.66 && weight >= 700);
}

export function minimumFor(level: 'AA' | 'AAA', large: boolean): number {
  if (level === 'AAA') return large ? 4.5 : 7;
  return large ? 3 : 4.5;
}
