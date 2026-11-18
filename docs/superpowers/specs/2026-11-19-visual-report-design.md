# uilint visual report: design

Date: 2026-11-19. Status: approved.

## Why

uilint's output is text, written for a coding agent. A person who wants to check a finding ("is this 13px gap real? which row is it?") has to open the page, find the element and measure it themselves. Usually that person is reviewing an agent's work after the agent has finished, from a headless run. They need to *see* each finding on the page as uilint saw it.

## Goal

`uilint <url> --report <file.html>` writes one self-contained HTML file. Opened in a browser, it shows every reported finding on a screenshot of the page, taken at the moment uilint measured it, with the offending element outlined, the elements it was compared with outlined, and the measurement drawn where it was measured.

Success: someone who has never used uilint opens the file and can confirm or reject each finding in a few seconds, without opening the app.

## Non-goals

- A live overlay in a visible browser (approach C below).
- Per-finding PNG files (approach B below). The report's model should make this easy to add later, but it is not part of this work.
- Rendering a report later from saved `--json` output.
- Filtering, search or other interactivity beyond what's needed to inspect a finding.
- Any change to the rules, the findings, the text or JSON output, or exit codes.

## Anti-goals

- Overlays that don't line up with the pixels. A misplaced outline is worse than no report, because it teaches the reviewer to distrust correct findings.
- Slowing down or changing ordinary runs. No screenshots unless `--report` is given.
- A report that hides findings the text output shows, or shows ones it hides (baselined and ignored findings stay out of both).

## Approaches considered

- **A. Self-contained HTML report (chosen).** One file, with one card per finding, cropped screenshots per viewport and overlays. It is shareable, works after headless runs, and can be kept as a CI artifact.
- **B. One annotated PNG per finding.** Easier to paste into a PR, but harder to browse, and a PNG can't show details on hover. Deferred.
- **C. Live overlay (`--show`) in a headed browser.** Doesn't work after a headless agent run, and leaves nothing behind. Rejected.

## Design

### CLI

- New option: `--report <file>`. The path is resolved against the working directory, and parent folders are created.
- The report covers the same findings as the output: after ignore and baseline filtering and after collapsing repeats, but **not** capped by `--max`. The text output stays capped for the agent's context; the human report shows everything.
- It is written whenever the run completes (exit 0 or 1), including a run with no problems ("no problems found" per page). Nothing is written when uilint itself fails (exit 2).
- On success a note is added: `note  report written to <path>`. It appears in the text output, and in `notes` in `--json`.
- `--report` together with `--update-baseline` is a usage error (exit 2). A baseline update reports nothing.

### Agent instructions

`agent/INSTRUCTIONS.md` and `agent/skills/uilint/SKILL.md` tell the agent to always pass `--report uilint-report.html`. The agent doesn't read the report; it names the file in its summary to the human ("visual report: uilint-report.html") and never commits it. The README's agent section suggests adding `uilint-report.html` to `.gitignore`. Decided by the user on 2026-11-19: the reviewer should find a report waiting after every agent run.

### Capturing what uilint saw

- Add an optional method to `DriverPage`: `screenshot?(): Promise<Buffer>`, a full-page PNG at device scale 1 in document coordinates, matching `Rect`.
- It is called only when `--report` is given, immediately after `stableSnapshot` returns, before the page closes. So the image is the exact state that was measured: frozen animations, setup script applied.
- Implement it for the Playwright and BetterWright adapters. BetterWright runs Playwright code in its session, so the image comes back base64-encoded through `exec`. The conformance suite checks it when an adapter provides it: correct PNG, width equals the viewport width, and its height covers the document.
- Adapters without `screenshot` still work: the report draws a **wireframe** from the measured boxes (every box as a thin grey outline, text boxes lightly filled), with the same overlays on top. The report says so in one line.
- Very tall pages: capture at most 10,000 CSS px of height. A finding below that gets a card that says it lies below the captured area, still with its text and a wireframe crop.

### Keeping the geometry

- Overlays need rects, which `Violation` deliberately doesn't carry, since it is the stable text, JSON and baseline shape. Don't add rects to `Violation` or to the JSON output.
- Instead, while merging viewports, keep a side record per violation per viewport. For that viewport it holds the offender rects (`boxIds`), the peer rects (all of `peerIds`, not just the 3 named), the finding's `check`, `measured` and `expected`, and the page size (`scrollWidth`, `clientWidth` and document height).
- When `collapseRepeats` merges repeated items into one entry (×N), the report keeps every instance's geometry. All instances are outlined, and the card is cropped around the first.

### What a card shows

There is one card per violation, in the same order as the text output, grouped by URL.

- The violation's text block, exactly as the CLI prints it (severity, rule, message, viewports, ×N, element lines, compared-with line), so the person and the agent read the same words.
- A crop for each viewport the violation occurs at, side by side or tabbed when they don't fit. The crop is the union of offender and peer rects, padded by 48 CSS px, clamped to the page, and with a minimum size so tiny elements keep some context.
- Outlines: offenders in red, peers in blue.
- The measurement drawn in place, by check family:
  - **Gap** (`gap`, `min-gap`): shade the measured gap and label it with the measured value; shade one peer gap and label it with the expected value.
  - **Alignment edges**: a dashed line along the peers' edge, spanning offender and peers, labelled with the offset in px.
  - **Size** (`scale`, and height or width differences): label the offender's dimension and the peers' dimension.
  - **Overflow**:
    - `hscroll`: shade the strip beyond `clientWidth` and label it `+Npx`.
    - `clipped`, `ellipsis`, `spill`: outline the element and shade the hidden or spilled extent.
    - `overlap`: shade the intersection.
- Clicking a crop opens the full screenshot for that viewport, scrolled to the finding, with this finding's overlays.

The exact visual treatment (colours beyond red and blue, label typography, layout) is left to the builder, within these rules: overlays scale with the image (SVG over the image, in CSS px coordinates), labels never cover the thing they measure, and the page reads in light and dark themes.

### The file

- Self-contained: inline CSS and JS, no network requests. Each `(url, viewport)` screenshot is embedded **once** as a base64 PNG, and crops reference that same image (SVG `<image>` with a `viewBox`), so file size grows with pages × viewports, not with findings.
- The header shows the URLs, the viewports, error and warning counts, and the uilint version.
- No timestamps or random ids inside the report body, so two runs on an unchanged page produce the same file (screenshot bytes allowing).

## Constraints

- Node 20+. No new runtime dependencies. PNG bytes come from the adapter and are embedded as they are; there's no image processing in Node.
- Measured coordinates are document coordinates. Fixed and dialog layers (`layer > 0`) are measured at scroll 0, and Playwright's full-page screenshot also renders them at scroll 0, so they line up. Verify this with a test.
- The text output, JSON output and exit codes stay unchanged when `--report` is absent. Tests guard this.

## How it's verified

- Unit: the geometry-to-overlay model (pure function): crop computation, clamping, and the overlay shapes per check family.
- E2E: the CLI with `--report` on the existing fixtures. Assert the file exists, has one card per violation, embeds one image per `(url, viewport)`, and that runs without `--report` produce identical stdout to before.
- Alignment check: render a report for a fixture, screenshot it with Playwright, and confirm the offender outline sits on the element (pixel check on a fixture with a solid-coloured offender).
- Manual look at the demo dashboard's report before calling it done.

## Left to the builder

The visual design of the page and cards, the label placement algorithm, how crops lay out when there are three viewports, the wireframe styling, and where the report-rendering code lives (`src/report/html.ts` is the obvious place).
