# uilint design

uilint is a deterministic linter for rendered web UI. It loads a page in a real
browser, measures where everything landed, and reports small visual mistakes
as text violations that a coding agent must fix.

## Why

Our agent already builds UI that is good overall. It misses the small details
a person only catches by looking:

1. spacing that is slightly too tight or too wide
2. things that should line up but are a few pixels off, often elements in
   different branches of the HTML tree, so nothing in the code shows they are
   related

It also misses near-identical elements with slightly different sizes, clipped
or overflowing content, and layouts that only break at narrow widths.

Asking the agent to inspect screenshots is unreliable and costs a lot of
tokens. A linter gives the same verdict on the same page every time, in cheap
text. The agent runs it, fixes every error, and runs it again.

There is no Figma file or token system to compare against. The reference is
the owner's eye, so every threshold must be tunable.

## The core idea: flag near misses only

uilint only flags things that are almost right.

- Two edges 3px apart are almost certainly a mistake. Two edges 40px apart are
  almost certainly intentional.
- A 14px gap in a run of 16px gaps is a bug. A 64px gap above a hero is a choice.

Every rule looks for a value that is close to a peer value but not equal to
it, inside a configurable near-miss window (for example, more than 0.5px and at
most 4px off). uilint treats anything clearly different as intentional and
ignores it. This keeps false alarms low without anyone annotating anything.

Precision matters more than recall. A missed bug costs one detail. A false
alarm costs more, because the agent will "fix" it and make the UI worse. When a
rule is unsure, it stays quiet or reports a warning instead of an error.

## Goals

- Catch these problems deterministically from the rendered page, at several
  viewport widths:
  - spacing near misses
  - alignment near misses, across DOM ancestors
  - size near misses in sets of similar elements
  - overflow, clipping, unwanted horizontal scroll, and overlapping text
- Text-only output, small in tokens, that an agent can act on without seeing
  the page.
- Every threshold and rule tunable by the owner.
- A non-zero exit code when there are errors, so the agent can't call the work
  done.
- Usable on an existing app on day one, through a baseline.

## Non-goals

- Color, contrast, typography choices, and accessibility (axe already covers
  accessibility).
- Pixel diffing or visual regression against a previous screenshot.
- Comparing against Figma or a design-token file.
- Sending screenshots or images to the agent.
- Auto-fixing code.
- Hover, focus, and animation states. uilint lints only the settled state after
  setup.
- Replacing the agent's existing Playwright verification. uilint is a separate
  tool with its own command.

## Anti-goals

Any of these makes uilint a failure even if every rule works as specified.

- Noise. If clean, well-built screens produce errors, the agent will degrade
  good UI to satisfy the tool, and the owner is worse off than with no tool.
- An opt-out the agent can use. If the agent can make a violation go away
  without fixing the UI, it will. uilint must not read any opt-out from the
  page's code: no `data-uilint-ignore` attribute and no magic class names.
  Exceptions live only in files the owner controls.
- Flaky results. The same page must give the same result on every run.
- Bloated output. A bug repeated across 30 list items must not print 30
  near-identical blocks.

## How it is used

### Command line

```
uilint <url> [<url> ...]
  --config <path>        default: ./uilint.config.ts (or .json)
  --viewport <w>[,<w>]   override configured widths
  --driver <name|path>   browser adapter: playwright (default), betterwright, or a module path
  --profile <dir>        playwright: launch with an existing user-data dir (reuse login)
  --cdp <port|url>       playwright: attach to an already-running Chrome instead of launching
  --setup <file.ts>      script run before measuring (open modal, fill form, ...)
  --json                 machine-readable output instead of text
  --max <n>              cap number of reported violations (default 50)
  --update-baseline      write current violations to the baseline file and exit 0
```

Exit codes: `0` means no errors (warnings allowed), `1` means one or more
errors, and `2` means the tool itself failed (the page didn't load, setup
threw, or the config is invalid).

### Getting the page into the right state

uilint supports the same routes the agent already uses for verification:

- For a mocked dev server, pass the URL.
- For a real logged-in session, `--profile` points at a Chrome profile the
  owner logged into manually, and `--cdp` attaches to a Chrome that is already
  running with that session.
- For states behind interaction, `--setup` takes a TS/JS module exporting
  `async (page: Page) => void`, which runs after navigation and before
  measuring. The agent may write these.

The config can also list pages, each with its own URL and optional setup.
Running `uilint` with no arguments lints that set.

`--profile`, `--cdp` and the setup module format above belong to the
Playwright adapter. Other adapters have their own session and setup formats
(see Browser adapters).

### Browser adapters

uilint talks to the browser through a small adapter, so teams can use the
browser tooling they already have. An adapter can open a URL at a given
viewport size, report the final URL and HTTP status of the main document, run
a script in the page and return JSON, inject a style tag, wait for the network
to go quiet, run a setup file, and close. Everything after measurement (rules,
report, ignore file, baseline) is the same for every adapter.

- `playwright` is built in and the default.
- `betterwright` is built in and loads the optional `betterwright` package only
  when selected. BetterWright doesn't expose its page object, so the adapter
  sends each step as a snippet through `bw.run()`, and a setup file is a
  snippet file in BetterWright's format. Its own persistent profile replaces
  `--profile`. If its network policy blocks the dev server's host, the adapter
  takes an option to allow it. When its `stealthRuntimeFix` mode is on, page
  scripts can't read React's fields on DOM nodes, so violations come without
  component names or source files, and the report says so.
- Any other tool plugs in as a module path that exports
  `createDriver(options)`. The repo ships a conformance test suite an adapter
  author can run, and the README documents the contract.

The near-miss fixtures run against every built-in adapter.

### Making measurements stable

At each viewport, before measuring, uilint:

- waits for load, network idle, and `document.fonts.ready`
- injects CSS that disables animations, transitions, and caret blink
- waits until layout is stable (measurements equal across consecutive frames)
- measures at device scale factor 1 and a fixed viewport height, covering the
  full scrollable page and not just the first screen (the builder decides how;
  in v1, nested scroll containers can be limited to their visible part)

If layout doesn't settle within a timeout, uilint exits with `2` instead of
reporting violations that may be wrong.

## What gets measured: visual boxes

Rules run on visual boxes, not DOM elements. A plain wrapper `<div>` with no
background, border, or shadow is invisible, so its edges don't matter and
uilint skips it. Because uilint compares only what a person sees, alignment
works across DOM ancestors.

A visual box is one of:

- a run of text, measured from the text's own rects (via `Range`) instead of
  the element's box, so padding on the parent doesn't distort it; multi-line
  text keeps one rect per line
- an image, svg, video, canvas, or iframe
- a form control or button
- an element with a visible background, border, outline, or box-shadow, such as
  a card, chip, divider, or panel

uilint skips zero-size elements, `display:none`, `visibility:hidden`,
`opacity:0`, anything fully off-screen or fully clipped, and anything matched
by the config's `exclude` selectors (for example, third-party widgets).

Each box records its rect, its nearest visual container (the closest ancestor
that is itself a visual box), and locator info (see Output).

## Rules (first version)

Each rule has a severity of `off`, `warn`, or `error`, plus options. The builder
sets the defaults by tuning against the fixtures described under Success. The
numbers below are starting points.

### `alignment`

Boxes that are visually related and nearly share an edge should share it
exactly.

- Two boxes are related when they are stacked in the same column (overlapping
  or close horizontally, within some vertical distance, with nothing visible
  between them) or sit in the same row. DOM ancestry doesn't matter.
- For stacked boxes, compare left, right, and center-x. For boxes in a row,
  compare top, bottom, center-y, and text baseline.
- Flag a difference inside the near-miss window (suggested: more than 0.5px
  and at most 4px).
- When several boxes share an edge and one is off, report the odd one against
  the group instead of reporting every pair.

### `spacing`

Gaps that play the same role should be equal when they are nearly equal.

- Collect gaps between adjacent visual boxes along each axis, and the insets of
  content inside a visual container (a card's left padding against its right,
  top against bottom).
- Group gaps that play the same role: consecutive gaps in a stack or row, gaps
  between repeated items, and the same inset on opposite sides.
- Flag a gap that is within the near-miss window of its group's most common
  value but not equal to it (suggested window: 4px or 25%, whichever is
  smaller).
- Two optional limits, off by default: a minimum gap between separate text
  blocks, and a spacing scale (such as multiples of 4) for owners who want one.

### `size-consistency`

Similar elements that nearly match in size should match exactly.

- A set is a group of boxes in the same row or column that look alike: the
  same tag or role, or the same React component, and close in size. Examples
  are buttons in a toolbar, cards in a grid, and inputs in a form.
- Flag height differences within a row, and width differences within a column
  or grid, when they fall inside the near-miss window.

### `overflow`

- text clipped by an ancestor with `overflow: hidden` (error)
- active `text-overflow: ellipsis` truncation (warning by default, since it may
  be intended)
- a box spilling outside its visual container (error)
- document-level horizontal scroll (error)
- text overlapping other text or controls (error)

### Viewports

All rules run at each configured width (default `375, 768, 1280`). Each
violation lists the widths where it occurs, and a violation that appears at
several widths is reported once.

## Output

Text by default, short and grouped, so the agent can act without seeing the
page:

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

Each violation gives its severity, rule, measured and expected values,
viewports, and a locator for each element involved.

Locators, best available first:

- a short snippet of visible text
- a short unique CSS selector
- the React component name chain, read from React's dev-mode fiber on the DOM
  node
- the source file of the owning component, with the line when available

Component and file info are best effort and need a development build.
Production builds still get text and a selector.

Violations with the same rule, components, and delta collapse into one entry
with a count (`×12`). `--max` caps the output, with errors listed first.

`--json` emits the same data as structured objects, including raw rects and
deltas, for other tools.

## Exceptions and the baseline

Two files sit next to the config. The owner controls them, and the agent must
not edit them.

- `uilint.ignore` lists deviations the owner accepts. Each entry has a rule, a
  matcher (selector, text, or component name), an optional viewport, and a
  required reason, such as "the badge in CardHeader is offset on purpose".
  uilint reports unused entries as warnings so the list stays current.
- `uilint.baseline.json` is written by `--update-baseline`. Violations recorded
  there don't fail the run; only new ones do. Fingerprints must stay stable
  across unrelated code changes, so they use the rule, locators, and viewport
  instead of raw pixel values.

Nothing technically locks these files. The agent's instructions (see Agent
integration) and the owner's review or CODEOWNERS protect them. uilint never
reads opt-outs from the page's own markup.

## Configuration

`uilint.config.ts` (or `.json`) holds:

- `viewports`: widths
- `pages`: an optional list of `{ url, setup? }`
- `rules`: severity and options per rule (near-miss window, groupings, optional
  limits)
- `exclude`: selectors whose subtrees are skipped entirely
- `ignoreFile`, `baselineFile`: paths
- `driver`: the adapter name or module path, plus its options (for Playwright:
  profile, CDP endpoint, channel, headless)

Without a config, uilint uses defaults with all four rules on.

## Agent integration

The repo ships a short instruction block to drop into the agent's
instructions, and optionally a Claude Code skill with the same content:

- after changing UI, run `uilint` on the affected pages
- fix every error by changing the UI code, and re-run until it exits with 0
- never edit `uilint.ignore`, `uilint.baseline.json`, or the config
- if a violation looks intentional, stop and tell the human, quoting it

## Stack

uilint is a TypeScript CLI for Node 20+, published to npm (`npx uilint`). It
uses Playwright with Chromium by default and other browser tools through
adapters. A script injected into the page does the
measuring. Rule logic runs in Node on the extracted boxes, so it can be unit
tested without a browser. uilint works on any web page; React component info
is an extra layer on top.

## Success

- A fixture suite in the repo: small pages, each seeded with one known defect
  (a label 3px out of line with one in a different parent, one 14px gap among
  16px gaps, a button 1px taller than its neighbors, text clipped at 375px, and
  so on). uilint must catch each one and point at the right element.
- A clean suite of well-built pages, including a few screens from the owner's
  app that the owner considers correct. These must produce zero errors. This is
  the main bar, and the defaults are tuned against it.
- Running twice on the same page gives byte-identical output.
- On a real screen the agent built, the owner agrees that the reported errors
  are real problems.

## Left to the builder

- exact default numbers for every window and grouping threshold, tuned on the
  fixtures with precision first
- the algorithms that decide when boxes are related, play the same role, or
  look alike
- the ignore file's exact syntax
- how fingerprints are computed
- how React component and source info is read across React 18 and 19
- internal architecture and test setup
