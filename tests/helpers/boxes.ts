import type { Box, PageInfo, Snapshot } from '../../src/types.js';

let nextId = 0;

export function resetBoxIds(): void {
  nextId = 0;
}

export function box(o: { x: number; y: number; w: number; h: number } & Partial<Omit<Box, 'rect'>>): Box {
  const { x, y, w, h, ...rest } = o;
  const id = rest.id ?? nextId++;
  const rect = { x, y, width: w, height: h };
  return {
    id,
    kind: 'surface',
    layoutRect: rect,
    lines: [],
    baseline: null,
    textAlign: null,
    containerId: null,
    layer: 0,
    tag: 'div',
    role: null,
    clipped: null,
    ellipsis: false,
    locator: { selector: `#b${id}`, text: null, components: [], source: null },
    ...rest,
    rect,
  };
}

export function snap(boxes: Box[], page?: Partial<PageInfo>): Snapshot {
  return {
    page: {
      url: 'http://test/',
      finalUrl: 'http://test/',
      status: 200,
      viewport: 1280,
      scrollWidth: 1280,
      clientWidth: 1280,
      ...page,
    },
    boxes,
  };
}
