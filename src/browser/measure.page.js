// Runs inside the page. Must stay a single self-contained function expression:
// no imports, no outer references, plain JS (adapters evaluate it as a string).
(options) => {
  const exclude = options.exclude || [];
  const readReact = options.react !== false;
  for (const sel of exclude) {
    try { document.querySelector(sel); } catch (e) { return { error: 'invalid exclude selector: ' + sel }; }
  }

  const r2 = (n) => Math.round(n * 100) / 100;
  const sx = window.scrollX;
  const sy = window.scrollY;
  const docEl = document.documentElement;
  const docW = Math.max(docEl.scrollWidth, docEl.clientWidth);
  const docH = Math.max(docEl.scrollHeight, docEl.clientHeight);
  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK', 'TITLE']);
  const MEDIA_TAGS = new Set(['IMG', 'SVG', 'VIDEO', 'CANVAS', 'IFRAME', 'PICTURE', 'OBJECT', 'EMBED']);
  const FORM_TAGS = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
  const LAYER_ROLES = new Set(['dialog', 'alertdialog', 'menu', 'listbox', 'tooltip']);
  const REACT_INTERNALS = new Set(['Fragment', 'Suspense', 'StrictMode', 'Provider', 'Consumer', 'ForwardRef', 'Memo', 'Profiler']);

  const styleCache = new Map();
  const style = (el) => {
    let cs = styleCache.get(el);
    if (!cs) { cs = getComputedStyle(el); styleCache.set(el, cs); }
    return cs;
  };

  const alpha = (color) => {
    if (!color || color === 'transparent') return 0;
    const slash = color.match(/\/\s*([\d.]+%?)\s*\)$/);
    if (slash) return slash[1].endsWith('%') ? parseFloat(slash[1]) / 100 : parseFloat(slash[1]);
    const m = color.match(/^rgba?\(([^)]+)\)$/);
    if (m) {
      const parts = m[1].split(',').map((p) => p.trim());
      return parts.length === 4 ? parseFloat(parts[3]) : 1;
    }
    return 1;
  };

  const docRect = (r) => ({ x: r.left + sx, y: r.top + sy, width: r.width, height: r.height });
  const round = (r) => ({ x: r2(r.x), y: r2(r.y), width: r2(r.width), height: r2(r.height) });
  const intersects = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  const union = (rects) => {
    const x1 = Math.min(...rects.map((r) => r.x));
    const y1 = Math.min(...rects.map((r) => r.y));
    const x2 = Math.max(...rects.map((r) => r.x + r.width));
    const y2 = Math.max(...rects.map((r) => r.y + r.height));
    return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
  };
  const paddingBox = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + sx + el.clientLeft, y: r.top + sy + el.clientTop, width: el.clientWidth, height: el.clientHeight };
  };

  const hasVisibleSurface = (cs) => {
    if (alpha(cs.backgroundColor) > 0) return true;
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return true;
    if (cs.boxShadow && cs.boxShadow !== 'none') return true;
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 && alpha(cs.outlineColor) > 0) return true;
    for (const side of ['Top', 'Right', 'Bottom', 'Left']) {
      const st = cs['border' + side + 'Style'];
      if (st !== 'none' && st !== 'hidden' && parseFloat(cs['border' + side + 'Width']) > 0 && alpha(cs['border' + side + 'Color']) > 0) return true;
    }
    return false;
  };

  const kindOf = (el, cs) => {
    const tag = el.tagName.toUpperCase();
    if (MEDIA_TAGS.has(tag)) return 'media';
    if (FORM_TAGS.has(tag)) return 'control';
    const role = el.getAttribute('role');
    if ((tag === 'A' || role === 'button') && hasVisibleSurface(cs)) return 'control';
    if (tag === 'HTML' || tag === 'BODY') return null;
    if (hasVisibleSurface(cs)) return 'surface';
    return null;
  };

  const startsLayer = (el, cs) => {
    if (cs.position === 'fixed') return true;
    if (el.tagName === 'DIALOG' && el.open) return true;
    try { if (el.matches(':popover-open')) return true; } catch (e) { /* older engines */ }
    if (el.getAttribute('aria-modal') === 'true') return true;
    const role = el.getAttribute('role');
    return !!role && LAYER_ROLES.has(role);
  };

  const isSrOnly = (el, cs, rect) => {
    if (rect.width <= 1 && rect.height <= 1 && (cs.overflow !== 'visible' || cs.clip !== 'auto')) return true;
    if (/^inset\((50|100)%/.test(cs.clipPath || '')) return true;
    return false;
  };

  const clipsContent = (cs) => cs.overflowX !== 'visible' || cs.overflowY !== 'visible';

  // ---------- walk ----------
  const entries = [];
  const textSlot = new Map();
  const visibleText = new Map();

  const walk = (node, ctx) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!ctx.owner || !/\S/.test(child.data)) continue;
        const parent = child.parentElement;
        if (parent) {
          let vis = visibleText.get(parent);
          if (vis === undefined) { vis = style(parent).visibility === 'visible'; visibleText.set(parent, vis); }
          if (!vis) continue;
        }
        textSlot.get(ctx.owner).nodes.push(child);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child;
      if (SKIP_TAGS.has(el.tagName.toUpperCase())) continue;
      if (exclude.some((sel) => el.matches(sel))) continue;
      const cs = style(el);
      if (cs.display === 'none' || parseFloat(cs.opacity) === 0) continue;
      const contents = cs.display === 'contents';
      const raw = el.getBoundingClientRect();
      const rect = docRect(raw);
      if (!contents) {
        if (isSrOnly(el, cs, raw)) continue;
        const sized = rect.width > 0 && rect.height > 0;
        if (sized && (rect.x + rect.width <= 0 || rect.y + rect.height <= 0 || rect.x >= docW || rect.y >= docH)) continue;
        if (sized && ctx.clip && !intersects(rect, ctx.clip)) continue;
      }

      const next = { ...ctx };
      if (!contents && startsLayer(el, cs)) next.layer = ++ctx.layers.count;
      const kind = contents ? null : kindOf(el, cs);
      const isBox = !!kind && rect.width > 0 && rect.height > 0 && cs.visibility === 'visible';
      if (isBox) {
        entries.push({ type: 'el', el, kind, rect, container: ctx.container, layer: next.layer });
        next.container = el;
      }
      const tag = el.tagName.toUpperCase();
      if (tag === 'SVG' || (kind === 'media')) continue;
      const ownsText = !contents && (isBox || cs.display !== 'inline');
      if (ownsText) {
        const slot = { type: 'text', owner: el, nodes: [], container: isBox ? el : ctx.container, layer: next.layer, clipEl: null };
        entries.push(slot);
        textSlot.set(el, slot);
        next.owner = el;
      }
      if (!contents && clipsContent(cs)) {
        next.clipEl = el;
        next.clip = paddingBox(el);
      }
      if (ownsText) textSlot.get(el).clipEl = next.clipEl;
      walk(el, next);
      if (el.shadowRoot) walk(el.shadowRoot, next);
    }
  };
  walk(document.body || document.documentElement, { container: null, layer: 0, owner: null, clip: null, clipEl: null, layers: { count: 0 } });

  // ---------- locators ----------
  const goodClass = (c) => /^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(c) && !/^(css|sc|jsx|emotion|tw)-/.test(c) && !/\d/.test(c);
  const goodId = (id) => !!id && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id) && !/\d{3,}/.test(id);
  const rootOf = (el) => el.getRootNode();
  const unique = (sel, root) => { try { return root.querySelectorAll(sel).length === 1; } catch (e) { return false; } };
  const nth = (el) => {
    let n = 1;
    for (let s = el.previousElementSibling; s; s = s.previousElementSibling) if (s.tagName === el.tagName) n++;
    return n;
  };
  const part = (el) => {
    const tag = el.tagName.toLowerCase();
    const classes = [...el.classList].filter(goodClass).slice(0, 2);
    return tag + classes.map((c) => '.' + CSS.escape(c)).join('');
  };
  const selectorFor = (el) => {
    const root = rootOf(el);
    if (goodId(el.id) && unique('#' + CSS.escape(el.id), root)) return '#' + CSS.escape(el.id);
    let sel = part(el);
    if (unique(sel, root)) return sel;
    sel = sel + ':nth-of-type(' + nth(el) + ')';
    if (unique(sel, root)) return sel;
    let anc = el.parentElement;
    for (let depth = 0; anc && depth < 4; depth++, anc = anc.parentElement) {
      const ap = goodId(anc.id) ? '#' + CSS.escape(anc.id) : part(anc) + ':nth-of-type(' + nth(anc) + ')';
      sel = ap + ' > ' + sel;
      if (unique(sel, root)) return sel;
    }
    return sel;
  };
  const snippet = (s) => {
    const t = (s || '').replace(/\s+/g, ' ').trim();
    if (!t) return null;
    return t.length > 40 ? t.slice(0, 40) + '...' : t;
  };

  const componentName = (type) => {
    if (!type || typeof type === 'string') return null;
    const n = type.displayName || type.name || (type.render && (type.render.displayName || type.render.name)) ||
      (type.type && (type.type.displayName || type.type.name));
    if (!n || typeof n !== 'string' || !/^[A-Z]/.test(n) || REACT_INTERNALS.has(n)) return null;
    return n;
  };
  const sourceOf = (fiber) => {
    if (fiber._debugSource && fiber._debugSource.fileName) {
      return fiber._debugSource.fileName + (fiber._debugSource.lineNumber ? ':' + fiber._debugSource.lineNumber : '');
    }
    const stack = fiber._debugStack && fiber._debugStack.stack;
    if (typeof stack === 'string') {
      for (const line of stack.split('\n')) {
        if (!/^\s*at /.test(line) || /node_modules/.test(line)) continue;
        const m = line.match(/\(?(?:[a-z]+:\/\/[^/\s]+)?\/?([^?\s():]+)(?:\?[^:\s)]*)?:(\d+):\d+\)?\s*$/);
        if (m) return m[1] + ':' + m[2];
      }
    }
    return null;
  };
  const reactInfo = (el) => {
    if (!readReact) return { components: [], source: null };
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    if (!key) return { components: [], source: null };
    const components = [];
    let source = null;
    for (let f = el[key]; f && components.length < 3; f = f.return) {
      const name = componentName(f.type);
      if (!name) continue;
      if (components.length === 0) source = sourceOf(f);
      components.push(name);
    }
    return { components, source };
  };

  const resolveAlign = (cs) => {
    const rtl = cs.direction === 'rtl';
    const a = cs.textAlign;
    if (a === 'center' || a === '-webkit-center') return 'center';
    if (a === 'right' || a === '-webkit-right') return 'right';
    if (a === 'left' || a === '-webkit-left') return 'left';
    if (a === 'end') return rtl ? 'left' : 'right';
    return rtl ? 'right' : 'left';
  };

  const canvas = document.createElement('canvas').getContext('2d');
  const ascentOf = (cs) => {
    canvas.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const m = canvas.measureText('Hg');
    return m.fontBoundingBoxAscent || parseFloat(cs.fontSize) * 0.8;
  };

  const lineRects = (nodes) => {
    const rects = [];
    for (const n of nodes) {
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 0 && r.height > 0) rects.push(docRect(r));
    }
    rects.sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const r of rects) {
      const last = lines[lines.length - 1];
      const overlap = last ? Math.min(last.y + last.height, r.y + r.height) - Math.max(last.y, r.y) : 0;
      if (last && overlap > Math.min(last.height, r.height) / 2) lines[lines.length - 1] = union([last, r]);
      else lines.push(r);
    }
    return lines;
  };

  // ---------- build boxes ----------
  const built = [];
  for (const e of entries) {
    if (e.type === 'el') {
      built.push({ e, rect: e.rect, layoutRect: e.rect, lines: [], baseline: null, textAlign: null, clipped: null, ellipsis: false,
        tag: e.el.tagName.toLowerCase(), text: snippet(e.el.innerText || e.el.getAttribute('aria-label') || e.el.getAttribute('alt') || e.el.getAttribute('placeholder') || e.el.value) });
      continue;
    }
    if (e.nodes.length === 0) continue;
    const lines = lineRects(e.nodes);
    if (lines.length === 0) continue;
    const cs = style(e.owner);
    let rect = union(lines);
    if (e.clipEl) {
      // Skip text that is entirely hidden by its clipping ancestor.
      const c = paddingBox(e.clipEl);
      if (!intersects(rect, c)) continue;
    }
    const glyph = lines[0].height;
    const lh = parseFloat(cs.lineHeight);
    // Chrome puts floor(leading / 2) above the glyphs and the rest below.
    const leading = Number.isFinite(lh) ? lh - glyph : 0;
    const above = Math.floor(leading / 2);
    const layoutRect = { x: rect.x, y: rect.y - above, width: rect.width, height: rect.height + leading };
    const ellipsis = cs.textOverflow === 'ellipsis' && e.owner.scrollWidth > e.owner.clientWidth;
    let clipped = null;
    if (e.clipEl && !ellipsis) {
      const c = paddingBox(e.clipEl);
      const hx = Math.max(0, rect.x + rect.width - (c.x + c.width)) + Math.max(0, c.x - rect.x);
      const hy = Math.max(0, rect.y + rect.height - (c.y + c.height)) + Math.max(0, c.y - rect.y);
      if (hx > 0.5 || hy > 0.5) clipped = { x: r2(hx), y: r2(hy) };
    }
    built.push({
      e, rect, layoutRect, lines, baseline: lines[0].y + ascentOf(cs), textAlign: resolveAlign(cs), clipped, ellipsis,
      tag: e.owner.tagName.toLowerCase(), text: snippet(e.nodes.map((n) => n.data).join(' ')),
    });
  }

  const idOf = new Map();
  built.forEach((b, i) => { if (b.e.type === 'el') idOf.set(b.e.el, i); });
  const boxes = built.map((b, i) => {
    const el = b.e.type === 'el' ? b.e.el : b.e.owner;
    const container = b.e.container ? idOf.get(b.e.container) : undefined;
    const react = reactInfo(el);
    return {
      id: i,
      kind: b.e.type === 'el' ? b.e.kind : 'text',
      rect: round(b.rect),
      layoutRect: round(b.layoutRect),
      lines: b.lines.map(round),
      baseline: b.baseline === null ? null : r2(b.baseline),
      textAlign: b.textAlign,
      containerId: container === undefined ? null : container,
      layer: b.e.layer,
      tag: b.tag,
      role: el.getAttribute('role'),
      clipped: b.clipped,
      ellipsis: b.ellipsis,
      locator: { selector: selectorFor(el), text: b.text, components: react.components, source: react.source },
    };
  });

  return { boxes, scrollWidth: docEl.scrollWidth, clientWidth: docEl.clientWidth };
}
