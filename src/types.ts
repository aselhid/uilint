export type Severity = 'off' | 'warn' | 'error';
export type ActiveSeverity = Exclude<Severity, 'off'>;
export type RuleName = 'alignment' | 'spacing' | 'size-consistency' | 'overflow';

/** Document coordinates, CSS px. */
export interface Rect { x: number; y: number; width: number; height: number }

export type BoxKind = 'text' | 'media' | 'control' | 'surface';

export interface Locator { selector: string; text: string | null; components: string[]; source: string | null }

export interface Box {
  /** Document order, 0-based. */
  id: number;
  kind: BoxKind;
  /** text: union of glyph rects; others: border box. */
  rect: Rect;
  /** text: rect grown vertically by half-leading; others: same as rect. */
  layoutRect: Rect;
  /** text only, one per line; [] otherwise. */
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
  /** text px hidden by an overflow ancestor. */
  clipped: { x: number; y: number } | null;
  ellipsis: boolean;
  locator: Locator;
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
