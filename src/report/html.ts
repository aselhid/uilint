import type { Rect, Snapshot } from '../types.js';
import { violationBlock, type UrlReport } from './format.js';
import { hitsOf } from './merge.js';
import { buildViews, type PageGeom, type Shape, type View } from './overlay.js';
import { pngSize } from './png.js';

/** What uilint saw at one (url, viewport): the measured snapshot and, if the adapter could take one, a screenshot. */
export interface Capture { url: string; viewport: number; snapshot: Snapshot; png: Buffer | null }

export interface ReportInput { version: string; reports: UrlReport[]; notes: string[]; captures: Capture[] }

const OFFENDER = '#e5484d';
const PEER = '#3e63dd';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (v: number) => String(Math.round(v * 100) / 100);
const plural = (k: number, word: string) => `${k} ${word}${k === 1 ? '' : 's'}`;

interface Prepared { id: number; capture: Capture; geom: PageGeom }

function prepare(c: Capture, id: number): Prepared {
  const width = Math.max(c.snapshot.page.scrollWidth, c.snapshot.page.clientWidth);
  const boxBottom = Math.max(0, ...c.snapshot.boxes.map((b) => b.rect.y + b.rect.height)) + 16;
  const clientWidth = c.snapshot.page.clientWidth;
  if (!c.png) return { id, capture: c, geom: { width, height: boxBottom, captured: 0, clientWidth } };
  const size = pngSize(c.png);
  const captured = size.height * (width / size.width);
  return { id, capture: c, geom: { width, height: Math.max(captured, boxBottom), captured, clientWidth } };
}

function defsFor(p: Prepared): string {
  const { id, capture, geom } = p;
  const wire = capture.snapshot.boxes
    .map((b) => `<rect class="wire${b.kind === 'text' ? ' text' : ''}" x="${n(b.rect.x)}" y="${n(b.rect.y)}" width="${n(b.rect.width)}" height="${n(b.rect.height)}"/>`)
    .join('');
  const shot = capture.png
    ? `<image id="shot-${id}" href="data:image/png;base64,${capture.png.toString('base64')}" x="0" y="0" width="${n(geom.width)}" height="${n(geom.captured)}" preserveAspectRatio="none"/>`
    : '';
  return `${shot}<g id="wire-${id}"><rect class="wire-bg" x="0" y="0" width="${n(geom.width)}" height="${n(geom.height)}"/>${wire}</g>`;
}

const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/**
 * Puts a label beside what it measures: inside the crop, clear of every outline and earlier label where it can be.
 * Returns null when the measured thing is outside the crop (a repeat drawn elsewhere on the page).
 */
function label(text: string, anchor: Rect, crop: Rect, taken: Rect[]): string | null {
  const grown = { x: anchor.x - 1, y: anchor.y - 1, width: anchor.width + 2, height: anchor.height + 2 };
  if (!overlaps(grown, crop)) return null;
  const w = text.length * 6.6 + 12, h = 18;
  const inCrop = (r: Rect) => r.x >= crop.x && r.y >= crop.y && r.x + r.width <= crop.x + crop.width && r.y + r.height <= crop.y + crop.height;
  const clampX = (x: number) => Math.min(Math.max(x, crop.x + 2), crop.x + crop.width - w - 2);
  const midY = anchor.y + anchor.height / 2 - h / 2;
  const beside: [number, number][] = [
    [anchor.x + anchor.width + 6, midY],
    [anchor.x - 6 - w, midY],
    [anchor.x, anchor.y - h - 4],
    [anchor.x, anchor.y + anchor.height + 4],
  ];
  const candidates = [...beside, ...beside.map(([x, y]) => [clampX(x), y] as [number, number]), [anchor.x + 4, anchor.y + 4] as [number, number]]
    .map(([x, y]) => ({ x, y, width: w, height: h }));
  const r = candidates.find((c) => inCrop(c) && !taken.some((t) => overlaps(c, t)))
    ?? candidates.find(inCrop)
    ?? { x: clampX(anchor.x), y: crop.y + 2, width: w, height: h };
  taken.push(r);
  return `<g class="label"><rect x="${n(r.x)}" y="${n(r.y)}" width="${n(w)}" height="${h}" rx="3"/><text x="${n(r.x + 6)}" y="${n(r.y + 13)}">${esc(text)}</text></g>`;
}

function shapeSvg(s: Shape, crop: Rect, taken: Rect[]): string {
  if (s.kind === 'outline') {
    const r = s.rect;
    return `<rect class="${s.role}" x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="${n(r.height)}"/>`;
  }
  if (s.kind === 'shade') {
    const r = s.rect;
    return `<rect class="shade" x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="${n(r.height)}"/>${label(s.label, r, crop, taken) ?? ''}`;
  }
  return `<line class="edge" x1="${n(s.x1)}" y1="${n(s.y1)}" x2="${n(s.x2)}" y2="${n(s.y2)}"/>${label(s.label, s.labelNear, crop, taken) ?? ''}`;
}

function viewSvg(v: View, p: Prepared): string {
  const { crop } = v;
  const wire = !p.capture.png || v.belowCapture;
  // Outlines first, measurements (and their labels) on top.
  const shapes = [...v.shapes.filter((s) => s.kind === 'outline'), ...v.shapes.filter((s) => s.kind !== 'outline')];
  // Labels keep clear of every outlined box and of each other.
  const taken = v.shapes.flatMap((s) => (s.kind === 'outline' ? [s.rect] : []));
  const svg = `<svg viewBox="${n(crop.x)} ${n(crop.y)} ${n(crop.width)} ${n(crop.height)}" width="${n(crop.width)}" height="${n(crop.height)}"`
    + ` data-page="${n(p.geom.width)} ${n(p.geom.height)}" data-crop="${n(crop.x)} ${n(crop.y)}">`
    + `<use href="#${wire ? 'wire' : 'shot'}-${p.id}"/>${shapes.map((s) => shapeSvg(s, crop, taken)).join('')}</svg>`;
  const note = !p.capture.png ? '' : v.belowCapture ? ' · below the captured area' : '';
  return `<figure class="view"><button type="button" class="crop" aria-label="Open the full page at ${v.viewport}px">${svg}</button>`
    + `<figcaption>${v.viewport}px${note}</figcaption></figure>`;
}

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f7f9;--card:#fff;--line:#e3e6ea;--text:#1c2024;--muted:#60646c;--offender:${OFFENDER};--peer:${PEER};--warn:#ad5700;--canvas:#fff;--wire:#b9bbc6}
@media (prefers-color-scheme:dark){:root{--bg:#111316;--card:#191b1f;--line:#2b2e33;--text:#eceef0;--muted:#a0a4ab;--warn:#ffa057;--canvas:#22252a;--wire:#5a5e66}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
header,main,footer{max-width:1200px;margin:0 auto;padding:0 16px}
header{padding-top:32px;padding-bottom:8px}
h1{font-size:20px;line-height:1.3;margin:0 0 4px}
h2{font-size:16px;margin:0;word-break:break-all}
.meta,.page-meta,figcaption,footer{color:var(--muted)}
.meta{margin:0}
.legend{display:flex;gap:16px;flex-wrap:wrap;margin:12px 0 0;color:var(--muted)}
.key{display:inline-block;width:12px;height:12px;border:2px solid;border-radius:2px;vertical-align:-1px;margin-right:6px}
.key.offender{border-color:var(--offender)}.key.peer{border-color:var(--peer)}
.page{margin-top:32px}
.page-meta{margin:2px 0 12px}
.clean{padding:16px;background:var(--card);border:1px solid var(--line);border-radius:6px;margin:0}
.finding{background:var(--card);border:1px solid var(--line);border-left:3px solid var(--offender);border-radius:6px;padding:16px;margin-bottom:16px}
.finding.warn{border-left-color:var(--warn)}
pre{margin:0 0 12px;font:12.5px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:pre-wrap;overflow-wrap:anywhere}
.views{display:flex;flex-wrap:wrap;gap:16px;align-items:flex-start}
.view{margin:0;max-width:100%}
.crop{display:block;padding:0;border:1px solid var(--line);border-radius:4px;background:var(--canvas);cursor:zoom-in;max-width:100%;overflow:hidden}
.crop:focus-visible{outline:2px solid var(--peer);outline-offset:2px}
.crop svg{display:block;max-width:100%;height:auto}
figcaption{font-size:12px;margin-top:4px}
svg .offender,svg .peer{fill:none;stroke-width:2;vector-effect:non-scaling-stroke}
svg .offender{stroke:var(--offender)}
svg .peer{stroke:var(--peer)}
svg .shade{fill:var(--offender);fill-opacity:.28;stroke:var(--offender);stroke-width:1;vector-effect:non-scaling-stroke}
svg .edge{stroke:var(--peer);stroke-width:2;stroke-dasharray:5 3;vector-effect:non-scaling-stroke}
svg .label rect{fill:var(--offender)}
svg .label text{fill:#fff;font:600 11px ui-monospace,SFMono-Regular,Menlo,monospace}
svg .wire-bg{fill:var(--canvas)}
svg .wire{fill:none;stroke:var(--wire);stroke-width:1;vector-effect:non-scaling-stroke}
svg .wire.text{fill:var(--wire);fill-opacity:.25}
footer{padding-top:16px;padding-bottom:48px;font-size:12px}
footer p{margin:0}
dialog{padding:0;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--text);width:min(96vw,1400px);height:92vh}
dialog::backdrop{background:rgb(0 0 0 / .5)}
.full-head{display:flex;justify-content:space-between;align-items:center;padding:8px 12px;border-bottom:1px solid var(--line)}
.full-head button{font:inherit;padding:4px 12px;border:1px solid var(--line);border-radius:4px;background:var(--bg);color:var(--text);cursor:pointer}
.full-body{overflow:auto;height:calc(92vh - 50px);background:var(--canvas)}
.full-body svg{display:block}
`;

const SCRIPT = `
const dlg = document.getElementById('full'), body = dlg.querySelector('.full-body'), title = dlg.querySelector('.full-title');
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.crop');
  if (btn) {
    const svg = btn.querySelector('svg').cloneNode(true);
    const [w, h] = svg.dataset.page.split(' ').map(Number), [cx, cy] = svg.dataset.crop.split(' ').map(Number);
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    body.replaceChildren(svg);
    title.textContent = btn.getAttribute('aria-label').replace('Open the full page at ', 'Full page at ');
    dlg.showModal();
    body.scrollTo(Math.max(0, cx - 40), Math.max(0, cy - 40));
  }
  if (e.target.closest('.full-close')) dlg.close();
});
`;

/** One self-contained HTML page: every reported finding drawn on the page as uilint measured it. */
export function renderReport(input: ReportInput): string {
  const prepared = new Map<string, Prepared>();
  input.captures.forEach((c, i) => prepared.set(`${c.url}\n${c.viewport}`, prepare(c, i)));
  const all = input.reports.flatMap((r) => r.violations);
  const errors = all.filter((v) => v.severity === 'error').length;
  const viewports = [...new Set(input.captures.map((c) => c.viewport))].sort((a, b) => a - b);
  const anyWire = input.captures.some((c) => !c.png);

  const pages = input.reports.map((r) => {
    const e = r.violations.filter((v) => v.severity === 'error').length;
    let meta = `${plural(e, 'error')}, ${plural(r.violations.length - e, 'warning')}`;
    if (r.baselined) meta += `, ${r.baselined} baselined`;
    const cards = r.violations.map((v) => {
      const geoms = new Map<number, PageGeom>();
      for (const vp of v.viewports) {
        const p = prepared.get(`${r.url}\n${vp}`);
        if (p) geoms.set(vp, p.geom);
      }
      const views = buildViews(hitsOf(v), geoms)
        .map((view) => { const p = prepared.get(`${r.url}\n${view.viewport}`); return p ? viewSvg(view, p) : ''; })
        .join('');
      return `<section class="finding ${v.severity}"><pre>${esc(violationBlock(v))}</pre><div class="views">${views}</div></section>`;
    }).join('\n');
    const body = r.violations.length ? cards : '<p class="clean">no problems found</p>';
    return `<section class="page"><h2>${esc(r.url)}</h2><p class="page-meta">${meta}</p>\n${body}</section>`;
  }).join('\n');

  const notes = [...(anyWire ? ['screenshots unavailable for this adapter; showing measured boxes'] : []), ...input.notes];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>uilint report</title>
<style>${STYLE}</style>
</head>
<body>
<header>
<h1>uilint report</h1>
<p class="meta">uilint ${esc(input.version)} · ${viewports.map((v) => `${v}px`).join(', ')} · ${plural(errors, 'error')}, ${plural(all.length - errors, 'warning')}</p>
<p class="legend"><span><span class="key offender"></span>element to fix</span><span><span class="key peer"></span>what it was compared with</span><span>click a picture for the full page</span></p>
</header>
<main>
${pages}
</main>
<footer>${notes.map((t) => `<p>note: ${esc(t)}</p>`).join('')}</footer>
<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>${[...prepared.values()].map(defsFor).join('')}</defs></svg>
<dialog id="full"><div class="full-head"><span class="full-title"></span><button type="button" class="full-close">Close</button></div><div class="full-body"></div></dialog>
<script>${SCRIPT}</script>
</body>
</html>
`;
}
