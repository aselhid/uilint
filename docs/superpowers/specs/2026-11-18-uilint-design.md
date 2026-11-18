# uilint — design

A deterministic linter for rendered web UI. It loads a page in a real browser,
measures where everything actually landed, and reports small visual mistakes
as text violations that a coding agent must fix.

## Why

Our agent already builds UI that is good overall. What it misses are the small
details a person only catches by looking:

1. spacing that is slightly too tight or too wide
2. things that should line up but are a few pixels off — often elements that
   sit in different branches of the HTML tree, so nothing in the code shows
   they are related

Plus the same family of misses: near-identical elements with slightly
different sizes, clipped or overflowing content, and layouts that only break
at narrow widths.

Asking the agent to inspect screenshots is unreliable and expensive in tokens.
A linter gives a hard, repeatable verdict in cheap text: same page, same
result, every time. The agent runs it, fixes every error, and runs it again.

There is no Figma file or token system to compare against. The reference is
the owner's eye, so everything must be tunable.

## The core idea: flag near misses only

The thing that makes this usable is that **it only flags things that are almost
right**.

- Two edges 3px apart are almost certainly a mistake. Two edges 40px apart are
  almost certainly intentional.
- A 14px gap in a run of 16px gaps is a bug. A 64px gap above a hero is a choice.

Every rule looks for a value that is *close to* a peer value but not equal to
it, inside a configurable "near-miss window" (e.g. more than 0.5px and at most
4px off). Anything clearly different is treated as intentional and ignored.
This keeps false alarms low without anyone annotating anything.

**Precision beats recall.** A missed bug costs one detail. A false alarm costs
more: the agent will dutifully "fix" it and make the UI worse. When in doubt, a
rule stays quiet or reports a warning, not an error.

## Goals

- Catch, deterministically, from the rendered page:
  - **spacing** near-misses
  - **alignment** near-misses, across DOM ancestors
  - **size consistency** near-misses in sets of similar elements
  - **overflow / clipping / unwanted horizontal scroll / overlapping text**
  - all of the above at several viewport widths
- Text-only output that an agent can act on without seeing the page, and that
  is small in tokens.
- Every threshold and rule tunable by the owner.
- A hard gate: non-zero exit code when there are errors.
- Works on an existing app on day one via a baseline.

## Non-goals

- Color, contrast, typography choices, accessibility (axe already exists).
- Pixel diffing / visual regression against a previous screenshot.
- Comparing against Figma or a design-token file.
- Sending screenshots or images to the agent.
- Auto-fixing code.
- Hover/focus/animation states (only the settled state after setup is linted).
- Replacing the agent's existing Playwright verification. uilint is a separate
  tool with its own command.

## Anti-goals (failure even if it "works")

- **Noisy.** If clean, well-built screens produce errors, the agent will degrade
  good UI to satisfy the tool. That is worse than no tool.
- **Silenceable by the agent.** If the agent can make a violation go away
  without fixing the UI, it will. There must be no in-code opt-out (no
  `data-uilint-ignore` attribute, no magic class names). Exceptions live only in
  owner-controlled files.
- **Flaky.** The same page must give the same result on every run.
- **Token-heavy.** A page with a repeated bug across 30 list items must not
  print 30 near-identical blocks.

## How it is used

### Command line

```
uilint <url> [<url> ...]
  --config <path>        default: ./uilint.config.ts (or .json)
  --viewport <w>[,<w>]   override configured widths
  --profile <dir>        launch Chrome with an existing user-data dir (reuse login)
  --cdp <port|url>       attach to an already-running Chrome instead of launching
  --setup <file.ts>      script run before measuring (open modal, fill form, ...)
  --json                 machine-readable output instead of text
  --max <n>              cap number of reported violations (default 50)
  --update-baseline      write current violations to the baseline file and exit 0
```

Exit codes: `0` no errors (warnings allowed), `1` one or more errors, `2` the
tool itself failed (page didn't load, setup threw, bad config).

### Getting the page into the right state

Matches how the agent already verifies:

- **Mocked dev server** — just pass the URL.
- **Real logged-in session** — `--profile` points at a Chrome profile the owner
  logged into manually; `--cdp` attaches to a Chrome already running with that
  session.
- **States behind interaction** — `--setup` is a TS/JS module exporting
  `async (page: Page) => void`, run after navigation and before measuring. The
  agent may write these.

Config may also list pages, each with its own url and optional setup, so
`uilint` with no args lints the configured set.

### Making measurements stable

Before measuring, at each viewport:

- wait for load + network idle, and `document.fonts.ready`
- inject CSS that disables animations, transitions and caret blink
- wait until layout is stable (measurements equal across consecutive frames)
- measure in a fixed device scale factor (1) and a fixed viewport height,
  covering the full scrollable page, not just the first screen (builder's call
  on how; nested scroll containers can be limited to their visible part in v1)

If stability isn't reached within a timeout, exit `2` rather than report
possibly-wrong violations.

## What gets measured: visual boxes

Rules run on **visual boxes**, not DOM elements. A plain wrapper `<div>` with no
background, border or shadow is invisible, so its edges don't matter and
it is skipped. This is what lets alignment work across DOM ancestors: the
linter compares what you actually see.

A visual box is one of:

- a run of text — measured from the text's own rects (via `Range`), not the
  element, so padding on the parent doesn't distort it; per-line rects are
  kept for multi-line text
- an image, svg, video, canvas, iframe
- a form control or button
- an element with a visible background, border, outline or box-shadow
  (cards, chips, dividers, panels)

Skipped: zero-size, `display:none`, `visibility:hidden`, `opacity:0`, fully
off-screen or fully clipped elements, and anything matched by the config's
`exclude` selectors (for third-party widgets etc.).

Each box records its rect, its nearest visual container (closest ancestor that
is itself a visual box), and locator info (below).

## Rules (first version)

Each rule has `off | warn | error` severity and options. Defaults are the
builder's call, tuned against the fixtures (see Success); suggested starting
points are given.

### `alignment`
Boxes that are visually related should share edges exactly when they nearly
share them.

- Related means: stacked in the same column (overlapping or near each other
  horizontally, within some vertical distance, nothing visual between them),
  or sitting in the same row. DOM ancestry is irrelevant.
- Compare left / right / center-x for stacked boxes; top / bottom / center-y
  and text baseline for boxes in a row.
- Flag when the difference is inside the near-miss window
  (suggested: > 0.5px and ≤ 4px).
- When several boxes share an edge and one is off, report the odd one out
  against the group, not every pair.

### `spacing`
Gaps that should match, but nearly don't.

- Collect gaps between adjacent visual boxes along each axis, and the insets of
  content inside a visual container (card padding: left vs right, top vs
  bottom).
- Group gaps that play the same role: consecutive gaps in a stack or row,
  gaps between repeated items, the same inset on opposite sides.
- Flag a gap that is within the near-miss window of its group's dominant value
  (suggested: ≤ 4px or ≤ 25%, whichever is smaller) but not equal.
- Optional limits, off by default: minimum gap between distinct text blocks,
  and a spacing scale (e.g. multiples of 4) for owners who want one.

### `size-consistency`
Sets of similar elements should match exactly when they nearly match.

- Sets: boxes in the same row or column that look alike (same tag/role, or
  same React component, and close in size) — buttons in a toolbar, cards in a
  grid, inputs in a form.
- Flag height differences within a row, and width differences within a column
  or grid, inside the near-miss window.

### `overflow`
- text clipped by an ancestor with `overflow: hidden` (error)
- active `text-overflow: ellipsis` truncation (warn by default; may be intended)
- a box spilling outside its visual container (error)
- document-level horizontal scroll (error)
- text boxes overlapping other text or controls (error)

### Viewports
All rules run at each configured width (default `375, 768, 1280`). Violations
say which widths they occur at; the same violation at several widths is
reported once with all widths listed.

## Output

Text by default — short, grouped, actionable without seeing the page:

```
uilint  http://localhost:3000/dashboard   3 errors, 1 warning

error  alignment  left edge 3px off from 4 stacked items  @375,768,1280
  .stat-label "Revenue"         <StatTile>   src/components/StatTile.tsx
  aligned group: .card-title "Monthly revenue" <CardHeader> (+3 more)

error  spacing  gap 14px, siblings use 16px  @1280  (×12 list items)
  between .order-row and .order-row   <OrderRow>  src/orders/OrderRow.tsx

error  overflow  text clipped horizontally by 22px  @375
  .plan-name "Enterprise annual"  <PlanCard>  src/billing/PlanCard.tsx

warn   overflow  text truncated with ellipsis  @375
  .customer-email "jane.long-name@..."  <CustomerCell>
```

Each violation names: severity, rule, the measured vs expected values, the
viewports, and a locator for each element involved.

**Locators**, best available first:
- short visible text snippet (truncated)
- a short unique CSS selector
- React component name chain, read from React's dev-mode fiber on the DOM node
- source file (and line when available) of the owning component

Component and file info are best-effort and require a development build;
production builds still get text + selector.

**Dedupe:** violations with the same rule, same component(s), same delta are
collapsed into one with a count (`×12`). Output is capped by `--max`, errors
first.

`--json` emits the same data as structured objects (including raw rects and
deltas) for tools.

## Exceptions and the baseline (owner-controlled)

Two files, next to the config, which **the agent must not edit**:

- **`uilint.ignore`** — the owner's list of accepted deviations. Each entry:
  rule, a matcher (selector, text, or component name), optional viewport, and
  a required reason. Example intent: "the badge in CardHeader is offset on
  purpose". Unused ignore entries are reported as warnings so the list doesn't
  rot.
- **`uilint.baseline.json`** — written by `--update-baseline`. Existing
  violations recorded here don't fail the run; only new ones do. Fingerprints
  must be stable across unrelated code changes (rule + locators + viewport, not
  raw pixel values).

There is no technical lock on these files; protection is by instruction (see
Agent integration) and by the owner's review / CODEOWNERS. uilint never reads
opt-outs from the page's own markup.

## Configuration

`uilint.config.ts` (or `.json`):

- `viewports` — widths
- `pages` — optional list of `{ url, setup? }`
- `rules` — per rule: severity and options (near-miss window, groupings,
  optional limits)
- `exclude` — selectors whose subtrees are skipped entirely
- `ignoreFile`, `baselineFile` — paths
- `browser` — profile / cdp / headless defaults

A missing config means sensible defaults with all four rules on.

## Agent integration

The repo ships a short instruction block (and optionally a Claude Code skill)
to drop into the agent's instructions:

- after changing UI, run `uilint` on the affected pages
- fix every error by changing the UI code; re-run until exit 0
- never edit `uilint.ignore`, `uilint.baseline.json`, or the config
- if a violation looks intentional, stop and tell the human, quoting it

## Stack

- TypeScript, Node 20+, Playwright (Chromium), published as an npm CLI
  (`npx uilint`). Measurement runs as a script injected into the page;
  rule logic runs in Node on the extracted boxes so it is unit-testable
  without a browser.
- Works on any web page; React-specific info is a bonus layer.

## Success

- **Fixture suite** in the repo: small pages each seeded with one known defect
  per rule (3px misaligned label across different parents, one 14px gap among
  16px gaps, a 1px-taller button, clipped text at 375px, etc.) — each must be
  caught, with the right locator.
- **Clean suite**: well-built pages (including a few screens from the owner's
  app they consider correct) — must produce **zero errors**. This is the
  primary bar; tune the defaults against it.
- Deterministic: running twice on the same page gives byte-identical output.
- On a real screen the agent built, the owner agrees the errors reported are
  real problems.

## Left to the builder

- exact default numbers for every window and grouping threshold (tune on
  fixtures; precision first)
- the algorithms for "related", "same role" and "look alike" groupings
- the ignore file's exact syntax
- how fingerprints are computed
- how React component/source info is extracted across React 18 and 19
- internal architecture and test setup
