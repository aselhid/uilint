// Runs inside the page, right after measure.page.js ran with { keep: true }.
// Must stay a single self-contained function expression: no imports, no outer references, plain JS.
// Returns, for each sample point, the colours painted below the text there; Node does the compositing.
() => {
  const stash = window.__uilintBoxes;
  delete window.__uilintBoxes;
  if (!Array.isArray(stash)) return { boxes: [], opacity: {} };

  const MAX_SAMPLES = 32;
  const sx = window.scrollX, sy = window.scrollY;

  const styleCache = new Map();
  const style = (el) => {
    let cs = styleCache.get(el);
    if (!cs) { cs = getComputedStyle(el); styleCache.set(el, cs); }
    return cs;
  };

  // ---------- colours ----------
  const colorCache = new Map();
  let ctx = null;
  const parseColor = (s) => {
    if (colorCache.has(s)) return colorCache.get(s);
    let c;
    const m = s.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/);
    if (m) {
      const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
      c = [+m[1], +m[2], +m[3], a];
    } else {
      // oklch(), lab(), color(display-p3 …) and friends: let the browser convert to sRGB.
      if (!ctx) {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        ctx = canvas.getContext('2d', { willReadFrequently: true });
      }
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = s;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      c = d[3] === 0 ? [0, 0, 0, 0] : [d[0], d[1], d[2], d[3] / 255];
    }
    colorCache.set(s, c);
    return c;
  };

  // ---------- opacity groups ----------
  // An element with opacity < 1 is painted as one group; ids are handed out as groups are met.
  const parentOf = (el) => {
    if (el.parentElement) return el.parentElement;
    const root = el.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  };
  const groupId = new Map();
  const opacity = {};
  const groupCache = new Map();
  const groupsOf = (el) => {
    let chain = groupCache.get(el);
    if (chain) return chain;
    chain = [];
    for (let e = el; e; e = parentOf(e)) {
      const o = parseFloat(style(e).opacity);
      if (o < 1) {
        let id = groupId.get(e);
        if (id === undefined) { id = groupId.size + 1; groupId.set(e, id); opacity[id] = o; }
        chain.push(id);
      }
    }
    chain.reverse();
    groupCache.set(el, chain);
    return chain;
  };

  // ---------- the page canvas ----------
  // The root's background (or the body's, when the root has none) paints the whole canvas, under everything.
  const html = document.documentElement, body = document.body;
  const blank = (el) => !el || (parseColor(style(el).backgroundColor)[3] === 0 && style(el).backgroundImage === 'none');
  const canvasEl = blank(html) && body ? body : html;
  const darkCanvas = (() => {
    let scheme = style(html).colorScheme || 'normal';
    if (scheme === 'normal') {
      const meta = document.querySelector('meta[name="color-scheme"]');
      if (meta) scheme = meta.getAttribute('content') || 'normal';
    }
    const words = scheme.split(/\s+/);
    if (!words.includes('dark')) return false;
    return !words.includes('light') || matchMedia('(prefers-color-scheme: dark)').matches;
  })();
  const base = (() => {
    const d = darkCanvas ? [18, 18, 18] : [255, 255, 255];
    const c = parseColor(style(canvasEl).backgroundColor);
    return [0, 1, 2].map((i) => c[i] * c[3] + d[i] * (1 - c[3])).concat(1);
  })();
  const paintsCanvas = (el) => el === html || el === canvasEl;

  // ---------- sample points ----------
  const points = [];
  const cut = (r, clip) => {
    if (!clip) return r;
    const x1 = Math.max(r.x, clip.x), y1 = Math.max(r.y, clip.y);
    const x2 = Math.min(r.x + r.width, clip.x + clip.width), y2 = Math.min(r.y + r.height, clip.y + clip.height);
    return x2 > x1 && y2 > y1 ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } : null;
  };
  const DISABLED = ':disabled, [aria-disabled="true"]';
  const fgOf = (cs) => parseColor(cs.webkitTextFillColor || cs.color);
  stash.forEach((entry, id) => {
    if (!entry.nodes) return;
    let count = 0;
    for (const n of entry.nodes) {
      const el = n.parentElement;
      if (!el || !n.isConnected || el.closest(DISABLED)) continue;
      if (fgOf(style(el))[3] === 0) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const raw of range.getClientRects()) {
        if (count >= MAX_SAMPLES) break;
        if (raw.width <= 0 || raw.height <= 0) continue;
        const r = cut({ x: raw.left + sx, y: raw.top + sy, width: raw.width, height: raw.height }, entry.clip);
        if (!r) continue;
        points.push({ id, order: points.length, el, what: 'text', x: r.x + r.width / 2, y: r.y + r.height / 2 });
        count++;
      }
    }
  });

  // ---------- background at a point ----------
  // In quirks mode the root's client size is the document's, so cap it with the window's.
  const viewW = () => Math.min(html.clientWidth, window.innerWidth);
  const viewH = () => Math.min(html.clientHeight, window.innerHeight);
  const layersBelow = (stack, at) => {
    const layers = [];
    for (const el of stack.slice(at)) {
      if (paintsCanvas(el)) continue;
      const color = parseColor(style(el).backgroundColor);
      const groups = groupsOf(el);
      if (color[3] > 0) layers.push({ color, groups });
      if (color[3] >= 1 && groups.length === 0) break;
    }
    return { layers: layers.reverse() };
  };

  const probe = (p) => {
    const cx = p.x - window.scrollX, cy = p.y - window.scrollY;
    if (cx < 0 || cy < 0 || cx >= viewW() || cy >= viewH()) return { unverified: 'hidden' };
    const stack = p.el.getRootNode().elementsFromPoint(cx, cy);
    const at = stack.indexOf(p.el);
    if (at === -1) return { unverified: 'hidden' };
    const below = layersBelow(stack, at);
    if (below.unverified) return below;
    const cs = style(p.el);
    return {
      sample: {
        what: p.what,
        font: { size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10) || 400 },
        fg: fgOf(cs),
        fgGroups: groupsOf(p.el),
        base,
        layers: below.layers,
      },
    };
  };

  // Hit-testing only sees the viewport, and skips pointer-events: none. Lift both, then put them back.
  const roots = new Set([document, ...points.map((p) => p.el.getRootNode())]);
  const lifts = [...roots].map((root) => {
    const s = document.createElement('style');
    s.textContent = '*,*::before,*::after{pointer-events:auto!important}';
    (root === document ? html : root).appendChild(s);
    return s;
  });
  const order = [...points].sort((a, b) => a.y - b.y || a.x - b.x || a.order - b.order);
  try {
    for (const p of order) {
      const vw = viewW(), vh = viewH();
      const inView = p.x >= window.scrollX && p.x < window.scrollX + vw && p.y >= window.scrollY && p.y < window.scrollY + vh;
      if (!inView) window.scrollTo({ left: p.x < vw ? 0 : p.x - vw / 2, top: Math.max(0, p.y - 8), behavior: 'instant' });
      p.result = probe(p);
    }
  } finally {
    for (const s of lifts) s.remove();
    window.scrollTo({ left: sx, top: sy, behavior: 'instant' });
  }

  const byBox = new Map();
  for (const p of points) {
    let b = byBox.get(p.id);
    if (!b) { b = { id: p.id, samples: [], unverified: null }; byBox.set(p.id, b); }
    if (p.result.sample) b.samples.push(p.result.sample);
    else if (!b.unverified) b.unverified = p.result.unverified;
  }
  return { boxes: [...byBox.values()], opacity };
}
