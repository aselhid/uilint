export type Severity = 'off' | 'warn' | 'error';
export type ActiveSeverity = Exclude<Severity, 'off'>;
export type RuleName = 'alignment' | 'spacing' | 'size-consistency' | 'overflow' | 'contrast';

/** Document coordinates, CSS px. */
export interface Rect { x: number; y: number; width: number; height: number }

export type BoxKind = 'text' | 'media' | 'control' | 'surface';

export interface Locator { selector: string; text: string | null; components: string[]; source: string | null }

/** Why the background behind some text couldn't be known. */
export type Unverified =
  | 'image' | 'gradient' | 'gradient text' | 'video' | 'canvas' | 'embedded content'
  | 'backdrop-filter' | 'blend mode' | 'filter' | 'hidden';

/** Text against what is painted behind it, at one sample point. */
export interface ContrastSample {
  /** text: ordinary text; value / placeholder: what a form control shows. */
  what: 'text' | 'value' | 'placeholder';
  ratio: number;
  large: boolean;
  /** #rrggbb as seen, after compositing. */
  fg: string;
  bg: string;
  /** The background is a gradient; bg is its worst stop. */
  gradient: boolean;
}

export interface ContrastInfo {
  /** Document order, at most 32. */
  samples: ContrastSample[];
  /** Why some samples couldn't be measured; null if all were. */
  unverified: Unverified | null;
}

export interface Box {
  /** Document order, 0-based. */
  id: number;
  kind: BoxKind;
  /** text: union of glyph rects; others: border box. */
  rect: Rect;
  /** text: rect grown vertically by half-leading; others: same as rect. */
  layoutRect: Rect;
  /** Inside the borders (padding box); text: same as rect. */
  innerRect: Rect;
  /**
   * text only: one rect per run of glyphs, a line split wherever something the box doesn't own (inline code, an icon)
   * interrupts it; [] otherwise.
   */
  lines: Rect[];
  /** text only: first-line baseline y. */
  baseline: number | null;
  /** text only, start/end/justify resolved. */
  textAlign: 'left' | 'center' | 'right' | null;
  /** Nearest ancestor that is itself a box. */
  containerId: number | null;
  /** 0 page; n>0 fixed / dialog / popover layer. */
  layer: number;
  tag: string;
  role: string | null;
  /** text px hidden by an overflow ancestor; a scroll container's scrolling axis doesn't count. */
  clipped: { x: number; y: number } | null;
  ellipsis: boolean;
  /** Padding box of the nearest ancestor that clips overflow; null if none. */
  clipRect: Rect | null;
  /** An inline box in running text, or the text inside one: placed by line wrapping, not by layout. */
  inText: boolean;
  locator: Locator;
  /** Text boxes and text-showing form controls, only when the contrast pass ran. */
  contrast?: ContrastInfo;
}

export interface PageInfo {
  url: string;
  finalUrl: string;
  status: number | null;
  viewport: number;
  scrollWidth: number;
  clientWidth: number;
}

export interface Snapshot { page: PageInfo; boxes: Box[] }

export interface Finding {
  rule: RuleName;
  /** e.g. 'left', 'gap', 'inset-x', 'height', 'clipped'. */
  check: string;
  severity: ActiveSeverity;
  message: string;
  measured: number;
  expected: number | null;
  /** Offender(s) first. */
  boxIds: number[];
  /** The group it was compared with; may be []. */
  peerIds: number[];
}

export interface Violation {
  url: string;
  rule: RuleName;
  check: string;
  severity: ActiveSeverity;
  message: string;
  measured: number;
  expected: number | null;
  elements: Locator[];
  /** At most 3. */
  peers: Locator[];
  /** Full size of the compared group. */
  peerCount: number;
  /** Ascending. */
  viewports: number[];
  /** >1 after collapsing repeated items. */
  count: number;
  fingerprint: string;
  /** Offender position at its first viewport, for sorting. */
  anchor: { y: number; x: number };
}

export interface Rule<O> {
  name: RuleName;
  defaults: O;
  check(snapshot: Snapshot, options: O, severity: ActiveSeverity): Finding[];
}

export interface DriverPage {
  /** HTTP status of the main document; null if unknown. */
  readonly status: number | null;
  /** false: page scripts can't see page globals (no React info). */
  readonly capabilities: { mainWorld: boolean };
  /** Current URL, after redirects and setup. */
  url(): Promise<string>;
  /** A JS expression string; result must be JSON-serializable; awaits promises. */
  evaluate<T>(expression: string): Promise<T>;
  addStyle(css: string): Promise<void>;
  /** Best effort, never throws on timeout. */
  waitForNetworkIdle(timeoutMs: number): Promise<void>;
  /** The adapter's own setup format. */
  runSetup(file: string): Promise<void>;
  /**
   * Optional, used by --report: a PNG of the whole document from (0,0) at CSS scale,
   * as wide as the document and at most maxHeight CSS px tall.
   */
  screenshot?(opts: { maxHeight: number }): Promise<Buffer>;
  /** Idempotent. */
  close(): Promise<void>;
}

export interface Driver {
  readonly name: string;
  open(url: string, viewport: { width: number; height: number }, timeoutMs: number): Promise<DriverPage>;
  /** Idempotent. */
  close(): Promise<void>;
}

export type CreateDriver = (options: Record<string, unknown>) => Promise<Driver>;
