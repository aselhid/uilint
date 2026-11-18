// The demo video, drawn as a pure function of time. record.mjs calls setup(data) once with real uilint output,
// then render(t) for every frame. Nothing here invents results: the terminal text, the highlighted elements
// (from the selectors uilint printed) and the numbers in the captions all come from `data`.

const $ = (id) => document.getElementById(id);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const span = (t, a, b) => clamp((t - a) / (b - a));
const fade = (t, a, b, d = 0.35) => Math.min(span(t, a, a + d), 1 - span(t, b - d, b));
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n) => String(Math.round(n * 100) / 100);

let D, CW, CH;
const frames = {};
const T = {};
let views = [];      // one per violation: frame, rects, caption, timing
let camKeys = [];
let captions = [];
let termEntries = [];
let outBlocks = [];

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

window.setup = async (data) => {
  D = data;
  CW = $('viewport').clientWidth;
  CH = $('viewport').clientHeight;
  for (const [id, variant, width] of [['b1280', 'before', 1280], ['b375', 'before', 375], ['a1280', 'after', 1280], ['a375', 'after', 375]]) {
    const f = document.createElement('iframe');
    f.style.width = width + 'px';
    f.style.height = '900px';
    $('world').appendChild(f);
    await new Promise((r) => { f.onload = r; f.src = `/?v=${variant}`; });
    await f.contentDocument.fonts.ready;
    await wait(50);
    const height = f.contentDocument.documentElement.scrollHeight;
    f.style.height = height + 'px';
    frames[id] = { id, el: f, width, height, doc: f.contentDocument, win: f.contentWindow };
  }
  build();
  return { views: views.length, total: T.total };
};

// Text is outlined tight around its glyphs (as uilint measures it); boxes with a surface by their border box.
function rectsFor(frame, selector) {
  return [...frame.doc.querySelectorAll(selector)].map((el) => {
    const cs = frame.win.getComputedStyle(el);
    const surface = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(cs.borderTopWidth) > 0 || el.tagName === 'BUTTON';
    let r = el.getBoundingClientRect();
    if (!surface && el.textContent.trim()) {
      const range = frame.doc.createRange();
      range.selectNodeContents(el);
      r = range.getBoundingClientRect();
    }
    return { x: r.left + frame.win.scrollX, y: r.top + frame.win.scrollY, w: r.width, h: r.height };
  });
}

function union(rects) {
  const x = Math.min(...rects.map((r) => r.x)), y = Math.min(...rects.map((r) => r.y));
  const x2 = Math.max(...rects.map((r) => r.x + r.w)), y2 = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: x2 - x, h: y2 - y };
}

// Keeps the camera on the page: no empty space past an edge unless the page is smaller than the view.
function clampCam(cam) {
  const f = frames[cam.frame];
  const vw = CW / cam.s, vh = CH / cam.s;
  const x = f.width <= vw ? f.width / 2 : clamp(cam.x, vw / 2, f.width - vw / 2);
  const y = f.height <= vh ? f.height / 2 : clamp(cam.y, vh / 2, f.height - vh / 2);
  return { ...cam, x, y };
}

const overview = (frame) => {
  const f = frames[frame];
  const s = Math.min(1, CW / f.width);
  return clampCam({ frame, s, x: f.width / 2, y: 0 });
};

function focus(frame, rects, maxScale = 2.2) {
  const u = union(rects);
  const pad = 56;
  const s = clamp(Math.min(CW / (u.w + 2 * pad), CH / (u.h + 2 * pad)), 0.45, maxScale);
  return clampCam({ frame, s, x: u.x + u.w / 2, y: u.y + u.h / 2 });
}

function captionFor(v) {
  const m = fmt(v.measured), e = fmt(v.expected);
  switch (`${v.rule}:${v.check}`) {
    case 'alignment:left':
      return `Each label sits ${m}px to the right of the numbers under it, on all ${v.count} tiles.`;
    case 'spacing:gap':
      return `On a ${v.viewports[0]}px phone, one gap is ${m}px. The gaps around it are ${e}px.`;
    case 'size-consistency:height':
      return `"${v.elements[0].text}" is ${m}px tall. The buttons beside it are ${e}px.`;
    case 'overflow:hscroll':
      return `On a ${v.viewports[0]}px phone, the page scrolls ${m}px sideways.`;
    default:
      return v.message;
  }
}

function build() {
  const report = D.before.json.reports[0];
  const strip = (s) => s.replace(/:nth-of-type\(\d+\)/g, '');

  T.titleOut = 2.8;
  T.type1 = 6.2;
  T.out1 = 8.7;
  T.v0 = 10.6;
  T.vLen = 5.8;
  T.exit1 = T.v0 + report.violations.length * T.vLen + 0.3;
  T.diff = [T.exit1 + 2.3, T.exit1 + 8.8];
  T.type2 = T.diff[1] + 0.4;
  T.out2 = T.type2 + 2.3;
  T.exit2 = T.out2 + 0.6;
  T.zoom2 = T.out2 + 1.6;
  T.end = T.out2 + 5.4;
  T.total = T.end + 5;

  views = report.violations.map((v, i) => {
    const frame = frames[v.viewports.includes(1280) ? 'b1280' : 'b375'];
    const sel = (l) => (v.count > 1 ? strip(l.selector) : l.selector);
    const els = v.elements.flatMap((l) => rectsFor(frame, sel(l)));
    const peers = v.peers.flatMap((l) => rectsFor(frame, sel(l)));
    const start = T.v0 + i * T.vLen;
    return { v, frame: frame.id, els, peers, start, end: start + T.vLen, caption: captionFor(v) };
  });

  // After the fix: zoom into the first stat tile to show its column lined up.
  const a = frames.a1280;
  const tile = rectsFor(a, '.stats .card')[0];
  const fixed = { label: rectsFor(a, '.stats .card .stat-label')[0], value: rectsFor(a, '.stats .card .stat-value')[0] };
  T.after = { tile, fixed };

  camKeys = [
    { t: 0, cam: overview('b1280') },
    ...views.map((w) => ({ t: w.start, cam: camFor(w) })),
    { t: T.exit1, cam: overview('b1280') },
    { t: T.diff[1] - 0.2, cam: overview('a1280') },
    { t: T.zoom2, cam: focus('a1280', [tile], 1.9) },
  ];

  captions = [
    { a: 3.0, b: T.type1, text: 'An agent built this dashboard. At a glance, it looks done.' },
    { a: T.type1, b: T.out1, text: 'Its instructions say: after changing UI, run uilint.' },
    { a: T.out1, b: T.v0, text: `uilint measured the page at 375, 768 and 1280px and found ${report.violations.length} errors.` },
    ...views.map((w) => ({ a: w.start, b: w.end, text: w.caption })),
    { a: T.exit1, b: T.diff[0], text: `Exit code ${D.before.code}, so the agent is not done yet.` },
    { a: T.diff[0], b: T.diff[1], text: 'The agent fixes each one in the file and line uilint named.' },
    { a: T.type2, b: T.out2, text: 'Then it runs uilint again.' },
    { a: T.out2, b: T.end, text: `No problems found, exit code ${D.after.code}. Now the agent is done.` },
  ];

  outBlocks = D.before.text.replace(/\n+$/, '').split('\n\n');
  termEntries = [
    { cmd: D.cmd, at: T.type1, cps: 26 },
    { out: 'before', at: T.out1 },
    { cmd: 'echo $?', at: T.exit1, cps: 16 },
    { out: String(D.before.code), at: T.exit1 + 0.75 },
    { cmd: D.cmd, at: T.type2, cps: 30 },
    { out: D.after.text.replace(/\n+$/, ''), at: T.out2 },
    { cmd: 'echo $?', at: T.exit2, cps: 16 },
    { out: String(D.after.code), at: T.exit2 + 0.75 },
  ];

  $('diff').innerHTML = `<h3>The agent's edits</h3>` + D.diff.map((f, i) => `<div class="group" data-i="${i}">` +
    `<div class="file">${esc(f.file)}:${f.line}</div>` +
    f.lines.map((l) => `<div class="${l.t === '-' ? 'del' : 'add'}">${esc(l.t + ' ' + l.s.trim())}</div>`).join('') + '</div>').join('');
}

// Repeated problems (x3) zoom into the first instance; the others stay outlined.
function camFor(w) {
  if (w.v.check === 'hscroll') return focus(w.frame, w.els, 1.1);
  if (w.v.rule === 'alignment' && w.v.count > 1) {
    const e = w.els[0];
    const near = w.peers.filter((p) => Math.abs(p.x - e.x) < 20 && p.y > e.y && p.y - e.y < 160);
    return focus(w.frame, [e, ...near], 2.6);
  }
  return focus(w.frame, [...w.els, ...w.peers]);
}

function cameraAt(t) {
  let k = 0;
  while (k + 1 < camKeys.length && camKeys[k + 1].t <= t) k++;
  const cur = camKeys[k].cam, prev = (camKeys[k - 1] ?? camKeys[k]).cam;
  const since = t - camKeys[k].t;
  if (prev.frame !== cur.frame) {
    const p = clamp(since / 0.7);
    return p < 0.5 ? { ...prev, opacity: 1 - 2 * p } : { ...cur, opacity: 2 * p - 1 };
  }
  const p = ease(clamp(since / 0.9));
  const lerp = (a, b) => a + (b - a) * p;
  return { frame: cur.frame, s: lerp(prev.s, cur.s), x: lerp(prev.x, cur.x), y: lerp(prev.y, cur.y), opacity: 1 };
}

function renderTerminal(t) {
  const activeView = views.find((w) => t >= w.start && t < w.end);
  const cursor = (blink) => `<span class="cursor">${blink && Math.floor(t * 2) % 2 ? ' ' : ' '}</span>`;
  const idle = (blink) => (blink && Math.floor(t * 2) % 2 ? '<span> </span>' : cursor(false));
  let html = '';
  for (let i = 0; i < termEntries.length; i++) {
    const e = termEntries[i];
    if (t < e.at) {
      if (e.cmd) html += `<span class="prompt">$ </span>${idle(true)}`;
      break;
    }
    if (e.cmd) {
      const n = Math.floor((t - e.at) * e.cps);
      html += `<span class="prompt">$ </span>${esc(e.cmd.slice(0, n))}`;
      if (n < e.cmd.length) { html += cursor(false); break; }
      const next = termEntries[i + 1];
      if (next && t < next.at) { html += cursor(false); break; }
      html += '\n';
    } else if (e.out === 'before') {
      html += outBlocks.map((b, j) => {
        const isActive = activeView && j === views.indexOf(activeView) + 1;
        return isActive ? `<span class="active">${esc(b)}</span>` : esc(b);
      }).join('\n\n') + '\n';
    } else {
      html += esc(e.out) + '\n';
    }
    if (i === termEntries.length - 1) html += `<span class="prompt">$ </span>${idle(true)}`;
  }
  const el = $('termtext');
  el.innerHTML = html;
  const room = $('term').clientHeight - 36;
  el.style.transform = `translateY(${-Math.max(0, el.offsetHeight - room)}px)`;
}

function hscrollAt(t, w) {
  if (!w || w.v.check !== 'hscroll') return 0;
  const m = w.v.measured;
  const up = ease(span(t, w.start + 1.4, w.start + 2.4));
  const down = ease(span(t, w.end - 1.3, w.end - 0.5));
  return m * (up - down);
}

function renderOverlay(t, cam) {
  const w = views.find((x) => t >= x.start && t < x.end);
  let svg = '', tags = '';
  const toStage = (r, sx = 0) => ({
    x: (r.x - sx - cam.x) * cam.s + CW / 2, y: (r.y - cam.y) * cam.s + CH / 2, w: r.w * cam.s, h: r.h * cam.s,
  });
  const box = (r, color, dashed) =>
    `<rect x="${r.x - 3}" y="${r.y - 3}" width="${r.w + 6}" height="${r.h + 6}" rx="5" fill="${dashed ? 'none' : 'rgba(255,107,107,.10)'}" stroke="${color}" stroke-width="${dashed ? 2 : 3}" ${dashed ? 'stroke-dasharray="7 5"' : ''}/>`;
  const tag = (x, y, text, color) => `<div class="tag" style="left:${x}px;top:${y}px;background:${color}">${esc(text)}</div>`;
  const RED = '#ff6b6b', BLUE = '#6cb6ff', GREEN = '#56d364';
  let alpha = 0;

  if (w && w.frame === cam.frame) {
    alpha = span(t, w.start + 0.8, w.start + 1.1) * (1 - span(t, w.end - 0.3, w.end));
    const sx = hscrollAt(t, w);
    const els = w.els.map((r) => toStage(r, sx)), peers = w.peers.map((r) => toStage(r, sx));
    if (w.v.rule !== 'alignment') for (const p of peers) svg += box(p, BLUE, true);
    for (const e of els) svg += box(e, RED, false);
    const v = w.v;
    if (v.rule === 'alignment' && v.check === 'left') {
      for (const e of els) {
        const column = peers.filter((p) => p.y > e.y && p.y - (e.y + e.h) < 120 && Math.abs(p.x - e.x) < 20);
        if (!column.length) continue;
        const gx = column[0].x;
        const bottom = Math.max(...column.map((p) => p.y + p.h));
        svg += `<line x1="${gx}" y1="${e.y - 18}" x2="${gx}" y2="${bottom + 18}" stroke="${BLUE}" stroke-width="2" stroke-dasharray="6 4"/>`;
        tags += tag(e.x - 2, e.y - 32, `${fmt(v.measured)}px off`, RED);
      }
    } else if (v.check === 'gap') {
      const all = [...w.els.map((r) => ({ r, el: true })), ...w.peers.map((r) => ({ r, el: false }))].sort((a, b) => a.r.y - b.r.y);
      for (let i = 0; i + 1 < all.length; i++) {
        const a = all[i].r, b = all[i + 1].r;
        const gap = b.y - (a.y + a.h);
        const isFound = all[i].el && all[i + 1].el;
        if (!isFound && Math.abs(gap - v.expected) > 0.5) continue;
        const A = toStage(a), B = toStage(b);
        const x = A.x + A.w * 0.72, color = isFound ? RED : BLUE;
        svg += `<line x1="${x}" y1="${A.y + A.h}" x2="${x}" y2="${B.y}" stroke="${color}" stroke-width="3"/>` +
          `<line x1="${x - 9}" y1="${A.y + A.h}" x2="${x + 9}" y2="${A.y + A.h}" stroke="${color}" stroke-width="3"/>` +
          `<line x1="${x - 9}" y1="${B.y}" x2="${x + 9}" y2="${B.y}" stroke="${color}" stroke-width="3"/>`;
        tags += tag(x + 14, (A.y + A.h + B.y) / 2 - 12, `${fmt(isFound ? v.measured : gap)}px`, color);
      }
    } else if (v.rule === 'size-consistency') {
      for (const e of els) tags += tag(e.x + e.w / 2 - 26, e.y - 36, `${fmt(v.measured)}px`, RED);
      for (const p of peers) tags += tag(p.x + p.w / 2 - 26, p.y - 36, `${fmt(v.expected)}px`, BLUE);
    } else if (v.check === 'hscroll') {
      const edge = toStage({ x: frames[w.frame].width, y: 0, w: 0, h: 0 }, sx);
      svg += `<line x1="${edge.x}" y1="0" x2="${edge.x}" y2="${CH}" stroke="${RED}" stroke-width="3" stroke-dasharray="10 6"/>`;
      tags += tag(edge.x + 10, 24, `scrolls ${Math.round(sx)}px sideways`, RED);
    }
  }

  if (cam.frame === 'a1280' && t >= T.zoom2) {
    alpha = span(t, T.zoom2 + 0.9, T.zoom2 + 1.2) * (1 - span(t, T.end - 0.3, T.end));
    const l = toStage(T.after.fixed.label), val = toStage(T.after.fixed.value);
    svg += `<line x1="${l.x}" y1="${l.y - 14}" x2="${l.x}" y2="${val.y + val.h + 40}" stroke="${GREEN}" stroke-width="2" stroke-dasharray="6 4"/>`;
    tags += tag(l.x - 2, l.y - 32, 'lined up', GREEN);
  }

  $('overlay').innerHTML = `<svg width="${CW}" height="${CH}" style="position:absolute;inset:0">${svg}</svg>${tags}`;
  $('overlay').style.opacity = alpha;
  return w;
}

window.render = (t) => {
  $('titlecard').style.opacity = t < T.titleOut ? 1 : 1 - span(t, T.titleOut, T.titleOut + 0.45);
  $('endcard').style.opacity = span(t, T.end, T.end + 0.6);

  const c = captions.find((x) => t >= x.a && t < x.b);
  $('caption').textContent = c ? c.text : '';
  $('caption').style.opacity = c ? fade(t, c.a, c.b, 0.3) : 0;

  renderTerminal(t);

  const cam = cameraAt(t);
  for (const f of Object.values(frames)) f.el.style.visibility = f.id === cam.frame ? 'visible' : 'hidden';
  $('world').style.transform = `translate(${CW / 2 - cam.x * cam.s}px, ${CH / 2 - cam.y * cam.s}px) scale(${cam.s})`;
  $('world').style.opacity = cam.opacity;
  $('vpchip').textContent = `${frames[cam.frame].width}px`;

  const w = renderOverlay(t, cam);
  const sx = hscrollAt(t, w);
  const fw = frames[cam.frame];
  if (fw.win.scrollX !== sx) fw.win.scrollTo(sx, 0);

  $('diff').style.opacity = fade(t, T.diff[0], T.diff[1], 0.4);
  for (const g of document.querySelectorAll('#diff .group')) {
    g.style.opacity = span(t, T.diff[0] + 0.6 + Number(g.dataset.i) * 0.7, T.diff[0] + 0.9 + Number(g.dataset.i) * 0.7);
  }
};
