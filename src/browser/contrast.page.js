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

  // ---------- sample points ----------
  const points = [];
  const cut = (r, clip) => {
    if (!clip) return r;
    const x1 = Math.max(r.x, clip.x), y1 = Math.max(r.y, clip.y);
    const x2 = Math.min(r.x + r.width, clip.x + clip.width), y2 = Math.min(r.y + r.height, clip.y + clip.height);
    return x2 > x1 && y2 > y1 ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } : null;
  };
  stash.forEach((entry, id) => {
    if (!entry.nodes) return;
    let count = 0;
    for (const n of entry.nodes) {
      const el = n.parentElement;
      if (!el || !n.isConnected) continue;
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
  const probe = (p) => {
    const cx = p.x - window.scrollX, cy = p.y - window.scrollY;
    if (cx < 0 || cy < 0 || cx >= window.innerWidth || cy >= window.innerHeight) return { unverified: 'hidden' };
    const stack = p.el.getRootNode().elementsFromPoint(cx, cy);
    const at = stack.indexOf(p.el);
    if (at === -1) return { unverified: 'hidden' };
    const layers = [];
    for (const el of stack.slice(at)) {
      const color = parseColor(style(el).backgroundColor);
      if (color[3] > 0) layers.push({ color, groups: [] });
      if (color[3] >= 1) break;
    }
    layers.reverse();
    const cs = style(p.el);
    return {
      sample: {
        what: p.what,
        font: { size: parseFloat(cs.fontSize), weight: parseInt(cs.fontWeight, 10) || 400 },
        fg: parseColor(cs.webkitTextFillColor || cs.color),
        fgGroups: [],
        base: [255, 255, 255, 1],
        layers,
      },
    };
  };

  const byBox = new Map();
  for (const p of points) {
    const r = probe(p);
    let b = byBox.get(p.id);
    if (!b) { b = { id: p.id, samples: [], unverified: null }; byBox.set(p.id, b); }
    if (r.sample) b.samples.push(r.sample);
    else if (!b.unverified) b.unverified = r.unverified;
  }
  return { boxes: [...byBox.values()], opacity: {} };
}
