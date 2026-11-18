import { readFile } from 'node:fs/promises';
import { composite, contrastRatio, isLarge, toHex, type Layer, type RGBA } from '../contrast/color.js';
import { UilintError } from '../errors.js';
import type { ContrastInfo, ContrastSample, DriverPage, Snapshot, Unverified } from '../types.js';

/** One colour painted below the text, or a gradient given by its stops. */
export type RawLayer = { color: RGBA; groups: number[] } | { stops: RGBA[]; groups: number[] };

/** What the page saw at one sample point, before compositing. Layers run bottom to top. */
export interface RawSample {
  what: ContrastSample['what'];
  font: { size: number; weight: number };
  fg: RGBA;
  fgGroups: number[];
  base: RGBA;
  layers: RawLayer[];
}

interface RawResult {
  /** The measure pass left nothing to work on (not run with keep, or run in another JS world). */
  missing?: boolean;
  boxes: { id: number; samples: RawSample[]; unverified: Unverified | null }[];
  /** Opacity of each group id used in the layers. */
  opacity: Record<number, number>;
}

let source: string | undefined;

async function contrastSource(): Promise<string> {
  source ??= (await readFile(new URL('./contrast.page.js', import.meta.url), 'utf8')).trim().replace(/;$/, '');
  return source;
}

/** Composites one sample. A gradient layer is tried stop by stop, and the worst stop counts. */
export function measureSample(s: RawSample, opacity: Record<number, number>): ContrastSample {
  const gradient = s.layers.find((l): l is { stops: RGBA[]; groups: number[] } => 'stops' in l);
  const variants = gradient ? gradient.stops : [null];
  let worst: { ratio: number; fg: RGBA; bg: RGBA } | null = null;
  for (const stop of variants) {
    const layers: Layer[] = s.layers.map((l) => ('stops' in l ? { color: stop!, groups: l.groups } : l));
    const bg = composite(s.base, layers, opacity);
    const fg = composite(s.base, [...layers, { color: s.fg, groups: s.fgGroups }], opacity);
    const ratio = contrastRatio(fg, bg);
    if (!worst || ratio < worst.ratio) worst = { ratio, fg, bg };
  }
  return {
    what: s.what,
    ratio: worst!.ratio,
    large: isLarge(s.font.size, s.font.weight),
    fg: toHex(worst!.fg),
    bg: toHex(worst!.bg),
    gradient: !!gradient,
  };
}

/**
 * Measures text contrast on the page measured last with captureSnapshot(…, keep = true),
 * and sets `contrast` on those boxes. Scrolls the page while it works and restores it.
 */
export async function captureContrast(page: DriverPage, snapshot: Snapshot): Promise<void> {
  const raw = await page.evaluate<RawResult>(`(${await contrastSource()})()`);
  if (raw.missing) throw new UilintError('the measure pass left no boxes to check (it must run with keep in the same JS world)');
  const byId = new Map(snapshot.boxes.map((b) => [b.id, b]));
  for (const r of raw.boxes) {
    const box = byId.get(r.id);
    if (!box) continue;
    const info: ContrastInfo = { samples: r.samples.map((s) => measureSample(s, raw.opacity)), unverified: r.unverified };
    box.contrast = info;
  }
}
