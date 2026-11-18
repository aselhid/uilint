export interface NearMissWindow { min: number; max: number; maxRatio?: number }

/** True when `measured` is close to `expected` but not equal: inside the near-miss window. */
export function isNearMiss(measured: number, expected: number, w: NearMissWindow): boolean {
  const d = round2(Math.abs(measured - expected));
  if (d <= w.min || d > w.max) return false;
  if (w.maxRatio !== undefined && d > w.maxRatio * Math.abs(expected)) return false;
  return true;
}

/**
 * Groups values that sit within `tolerance` of each other and returns the largest
 * group's lowest value. Null when no group has 2+ members or the largest group ties.
 */
export function dominant(values: number[], tolerance = 0.5): { value: number; count: number } | null {
  if (values.length < 2) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const groups: { value: number; count: number }[] = [];
  for (const v of sorted) {
    const last = groups[groups.length - 1];
    if (last && v - last.value <= tolerance) last.count++;
    else groups.push({ value: v, count: 1 });
  }
  let best = groups[0];
  let tie = false;
  for (const g of groups.slice(1)) {
    if (g.count > best.count) { best = g; tie = false; }
    else if (g.count === best.count) tie = true;
  }
  if (best.count < 2 || tie) return null;
  return best;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function fmtPx(n: number): string {
  return `${round2(n)}px`;
}
