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
  const scrolls = (v) => v === 'auto' || v === 'scroll';

  // With a modal dialog open, everything outside it is inert and can't be seen or used: measure only the modal.
  // Several open modals stack in the top layer; the one hit at its own center is on top.
  let modal = null;
  try {
    const open = [...document.querySelectorAll(':modal')];
    const onTop = open.filter((m) => {
      const r = m.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!hit && m.contains(hit);
    });
    modal = onTop[onTop.length - 1] || open[open.length - 1] || null;
  } catch (e) { /* engines without :modal */ }

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
      if (el.hasAttribute('inert')) continue;
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
      // An inline box inside a block that has text of its own (inline code, a highlighted link) sits in running text.
      const flowOwner = cs.display === 'inline' ? ctx.owner : null;
      if (isBox) {
        entries.push({ type: 'el', el, kind, rect, container: ctx.container, layer: next.layer, clip: ctx.clip, flowOwner });
        next.container = el;
      }
      const tag = el.tagName.toUpperCase();
      if (tag === 'SVG' || (kind === 'media')) continue;
      const ownsText = !contents && (isBox || cs.display !== 'inline');
      if (ownsText) {
        const slot = { type: 'text', owner: el, nodes: [], container: isBox ? el : ctx.container, layer: next.layer, clipEl: null, flowOwner };
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
  walk(modal ? { childNodes: [modal] } : document.body || document.documentElement,
    { container: null, layer: 0, owner: null, clip: null, clipEl: null, layers: { count: 0 } });
  const inText = (e) => !!e.flowOwner && !!textSlot.get(e.flowOwner) && textSlot.get(e.flowOwner).nodes.length > 0;

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
    // The source is the nearest JSX line that created this element, starting with the element itself
    // (a component fiber's own source is where the component is used, one level too far up).
    for (let f = el[key]; f && components.length < 3; f = f.return) {
      if (source === null) source = sourceOf(f);
      const name = componentName(f.type);
      if (name) components.push(name);
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

  // One rect per run of text: a line, split where something the box doesn't own (inline code, an icon) interrupts it.
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
      const overlap = last ? Math.min(last.rect.y + last.rect.height, r.y + r.height) - Math.max(last.rect.y, r.y) : 0;
      if (last && overlap > Math.min(last.rect.height, r.height) / 2) { last.rect = union([last.rect, r]); last.parts.push(r); }
      else lines.push({ rect: r, parts: [r] });
    }
    const runs = [];
    for (const line of lines) {
      line.parts.sort((a, b) => a.x - b.x);
      let run = null;
      for (const r of line.parts) {
        if (run && r.x <= run.x + run.width + 1) run = union([run, r]);
        else { if (run) runs.push(run); run = r; }
      }
      runs.push(run);
    }
    return runs;
  };

  // ---------- build boxes ----------
  const built = [];
  for (const e of entries) {
    if (e.type === 'el') {
      const ecs = style(e.el);
      // In a border-collapse table, a cell's box holds only half of each shared border.
      const share = ecs.display === 'table-cell' && ecs.borderCollapse === 'collapse' ? 0.5 : 1;
      const bw = (side) => (parseFloat(ecs['border' + side + 'Width']) || 0) * share;
      const inner = {
        x: e.rect.x + bw('Left'), y: e.rect.y + bw('Top'),
        width: Math.max(0, e.rect.width - bw('Left') - bw('Right')),
        height: Math.max(0, e.rect.height - bw('Top') - bw('Bottom')),
      };
      built.push({ e, rect: e.rect, layoutRect: e.rect, innerRect: inner, lines: [], baseline: null, textAlign: null, clipped: null, ellipsis: false,
        clipRect: e.clip, inText: inText(e),
        tag: e.el.tagName.toLowerCase(), text: snippet(e.el.innerText || e.el.getAttribute('aria-label') || e.el.getAttribute('alt') || e.el.getAttribute('placeholder') || e.el.value) });
      continue;
    }
    if (e.nodes.length === 0) continue;
    let lines = lineRects(e.nodes);
    if (lines.length === 0) continue;
    const cs = style(e.owner);
    let rect = union(lines);
    const clipBox = e.clipEl ? paddingBox(e.clipEl) : null;
    // Skip text that is entirely hidden by its clipping ancestor.
    if (clipBox && !intersects(rect, clipBox)) continue;
    const glyph = lines[0].height;
    const baseline = lines[0].y + ascentOf(cs);
    const ellipsis = cs.textOverflow === 'ellipsis' && e.owner.scrollWidth > e.owner.clientWidth;
    let clipped = null;
    if (clipBox) {
      const hx = Math.max(0, rect.x + rect.width - (clipBox.x + clipBox.width)) + Math.max(0, clipBox.x - rect.x);
      const hy = Math.max(0, rect.y + rect.height - (clipBox.y + clipBox.height)) + Math.max(0, clipBox.y - rect.y);
      // A scroll container (overflow: auto / scroll) lets the reader scroll to what it cuts off on that axis.
      const ccs = style(e.clipEl);
      const lostX = scrolls(ccs.overflowX) ? 0 : hx;
      const lostY = scrolls(ccs.overflowY) ? 0 : hy;
      if (!ellipsis && (lostX > 0.5 || lostY > 0.5)) clipped = { x: r2(lostX), y: r2(lostY) };
      // Measure only what is visible, so hidden text can't overlap or misalign with its neighbours.
      if (hx > 0 || hy > 0) {
        const cut = (r) => {
          const x1 = Math.max(r.x, clipBox.x), y1 = Math.max(r.y, clipBox.y);
          const x2 = Math.min(r.x + r.width, clipBox.x + clipBox.width), y2 = Math.min(r.y + r.height, clipBox.y + clipBox.height);
          return x2 > x1 && y2 > y1 ? { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } : null;
        };
        lines = lines.map(cut).filter(Boolean);
        if (lines.length === 0) continue;
        rect = union(lines);
      }
    }
    // Chrome puts floor(leading / 2) above the glyphs and the rest below.
    const lh = parseFloat(cs.lineHeight);
    const leading = Number.isFinite(lh) ? lh - glyph : 0;
    const above = Math.floor(leading / 2);
    const layoutRect = { x: rect.x, y: rect.y - above, width: rect.width, height: rect.height + leading };
    built.push({
      e, rect, layoutRect, innerRect: rect, lines, baseline, textAlign: resolveAlign(cs), clipped, ellipsis, clipRect: clipBox, inText: inText(e),
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
      innerRect: round(b.innerRect),
      lines: b.lines.map(round),
      baseline: b.baseline === null ? null : r2(b.baseline),
      textAlign: b.textAlign,
      containerId: container === undefined ? null : container,
      layer: b.e.layer,
      tag: b.tag,
      role: el.getAttribute('role'),
      clipped: b.clipped,
      ellipsis: b.ellipsis,
      clipRect: b.clipRect ? round(b.clipRect) : null,
      inText: b.inText,
      locator: { selector: selectorFor(el), text: b.text, components: react.components, source: react.source },
    };
  });

  // For the contrast pass, which runs later in its own evaluate and addresses boxes by id.
  if (options.keep) {
    window.__uilintBoxes = built.map((b) => b.e.type === 'el'
      ? { el: b.e.el, nodes: null, clip: null }
      : { el: b.e.owner, nodes: b.e.nodes, clip: b.e.clipEl ? paddingBox(b.e.clipEl) : null });
  }

  // Behind a modal the page is inert; its sideways scroll is the page's own finding, reported without the modal.
  return { boxes, scrollWidth: modal ? docEl.clientWidth : docEl.scrollWidth, clientWidth: docEl.clientWidth };
}
