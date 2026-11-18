# Visual Report Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `uilint <url> --report <file.html>` writes a self-contained HTML file showing every finding on a screenshot of the page as uilint measured it.

**Architecture:** Adapters get an optional `DriverPage.screenshot()`. `run.ts` calls it right after `stableSnapshot` when `--report` is set and keeps `{ snapshot, png }` per (url, viewport). `merge.ts` records which per-viewport findings and boxes produced each violation (a `WeakMap`, so `Violation`, the JSON output and the baseline are untouched). A pure overlay model (`src/report/overlay.ts`) turns those into crops and shapes, and a renderer (`src/report/html.ts`) turns the model into one HTML string with each screenshot embedded once.

**Tech Stack:** TypeScript, Node ≥ 20, Playwright, vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-19-visual-report-design.md`

## Global Constraints

- No new runtime dependencies. Embed PNG bytes as they are, with no image processing beyond reading the PNG header for its size.
- When `--report` is absent, stdout, stderr, JSON and exit codes are byte-for-byte what they are today.
- The report contains no timestamps or random ids.
- The report makes no network requests: inline CSS and JS only, and images as `data:image/png;base64`.
- Offenders are outlined in red and peers in blue. Overlays are SVG in CSS-px coordinates over the image.
- Screenshots capture at most 10,000 CSS px of height.
- The report is not capped by `--max`. Baselined and ignored violations are excluded.

## Review Focus

1. **A Chrome with devicePixelRatio 2** (`--cdp`/`--profile` attach to the user's browser) produces a 2× PNG. Overlays must still line up: the renderer sizes the image by CSS width, not by PNG pixels. *(Task 4 test.)*
2. **Element text or selectors containing `<`, `&` or quotes** must appear as text, never as markup. *(Task 4 test.)*
3. **A page that scrolls sideways** gives a screenshot wider than the viewport. The `hscroll` strip must be visible in the crop, not clamped away. *(Task 3 and Task 5 tests.)*
4. **More findings than `--max`**: all of them appear in the report, while the text stays capped. *(Task 5 test.)*
5. **A report path that can't be written** (its parent is a file) gives exit 2 with `uilint: could not write report …`, not a stack trace. *(Task 5 test.)*

---

### Task 1: Optional screenshot on DriverPage

**Files:**
- Modify: `src/types.ts` (`DriverPage`)
- Modify: `src/drivers/playwright.ts` (`wrapPage`)
- Modify: `src/drivers/betterwright.ts` (page object returned by `open`)
- Modify: `src/conformance.ts`
- Create: `src/report/png.ts`
- Test: `tests/unit/png.test.ts`, `tests/drivers/playwright.test.ts` (via conformance)

**Interfaces:**
- Produces:
  - `DriverPage.screenshot?(opts: { maxHeight: number }): Promise<Buffer>`: a full-page PNG at CSS scale, from document (0,0), as wide as the document (`scrollWidth`) and at most `maxHeight` tall.
  - `pngSize(png: Buffer): { width: number; height: number }`: reads the IHDR chunk and throws `UilintError('not a PNG')` otherwise.
  - `MAX_SCREENSHOT_HEIGHT = 10000`, exported from `src/report/png.ts`.

- [ ] **Step 1: Write the failing tests**
  - `tests/unit/png.test.ts`:
    - "reads width and height from a PNG header": build a minimal PNG header in the test (signature + IHDR with width 375 and height 1200) and expect `{ width: 375, height: 1200 }`.
    - "rejects non-PNG bytes": `Buffer.from('hello')` throws `/not a PNG/`.
  - In `runDriverConformance`, add the case "takes a full-page screenshot when it offers one". If `p.screenshot` is undefined, return early (the method is optional). Otherwise open `/tall` (add to `PAGES`: a 2000px-tall body, `<div style="height:2000px"></div>`) at width 375. Then:
    - `screenshot({ maxHeight: 10000 })` → `pngSize` gives width 375 and height 2000.
    - `screenshot({ maxHeight: 500 })` gives height 500.

- [ ] **Step 2: Run them and watch them fail**
  Run: `npx vitest run tests/unit/png.test.ts tests/drivers/playwright.test.ts`
  Expected: the png tests fail because the module is missing. The Playwright conformance screenshot case fails or passes vacuously; it must fail. Assert `expect(typeof p.screenshot).toBe('function')` inside `tests/drivers/playwright.test.ts`'s own describe, so the Playwright adapter is required to have it.

- [ ] **Step 3: Implement**
  - `pngSize`: big-endian uint32 at bytes 16 and 20, after checking the 8-byte signature.
  - Playwright `wrapPage.screenshot`:
    - Read `[document.documentElement.scrollWidth, document.documentElement.scrollHeight]` via `page.evaluate`.
    - Call `page.screenshot({ fullPage: true, scale: 'css', clip: { x: 0, y: 0, width: sw, height: Math.min(sh, maxHeight) } })`.
  - BetterWright: the same Playwright code inside `exec`, returning `(await page.screenshot(...)).toString('base64')`. Decode with `Buffer.from(s, 'base64')`.

- [ ] **Step 4: Run them and watch them pass**
  Run: `npx vitest run tests/unit/png.test.ts tests/drivers/`
  Expected: PASS. BetterWright tests stay skipped without Bun, the same as today.

- [ ] **Step 5: Commit** `feat: optional full-page screenshot on driver pages`

---

### Task 2: Trace each violation back to its per-viewport findings

**Files:**
- Modify: `src/report/merge.ts`
- Modify: `src/rules/alignment.ts` (export `EDGE_VALUE` and `type Edge`)
- Test: `tests/unit/merge.test.ts`

**Interfaces:**
- Consumes: `Snapshot`, `Finding`, `Box` from `src/types.ts`.
- Produces:
  - `interface Hit { viewport: number; finding: Finding; offenders: Box[]; peers: Box[] }`, exported from `src/report/merge.ts`.
    - `offenders` is the boxes for `finding.boxIds`, in order.
    - `peers` is all of `finding.peerIds`, not capped at 3.
  - `hitsOf(v: Violation): Hit[]`. It returns `[]` for a violation not produced by `mergeViewports` or `collapseRepeats`.
  - `mergeViewports` records one `Hit` per (finding, viewport) for each violation it returns.
  - `collapseRepeats` gives the merged violation the concatenated hits of its whole group. The first instance's hits come first, in the same order as the anchor sort.

- [ ] **Step 1: Write the failing tests** in `tests/unit/merge.test.ts`. Reuse the existing helpers that build snapshots and findings.
  - "records a hit per viewport": the same finding at 375 and 1280 gives one violation. `hitsOf(v).map(h => h.viewport)` equals `[375, 1280]`, and `hitsOf(v)[0].offenders[0].id` is the finding's `boxIds[0]`.
  - "keeps every peer, not just the three named": a finding with 5 `peerIds` gives `v.peers.length === 3` and `hitsOf(v)[0].peers.length === 5`.
  - "a collapsed group carries all its instances' hits": 3 rows collapse to `count: 3`, and `hitsOf(collapsed).length === 3`.
  - "JSON output is unchanged": `JSON.stringify(v)` has no `hits` key.

- [ ] **Step 2: Run** `npx vitest run tests/unit/merge.test.ts`. Expected: FAIL, `hitsOf` is not exported.

- [ ] **Step 3: Implement.** Use a module-level `const HITS = new WeakMap<Violation, Hit[]>()`. `applyIgnores`, `applyBaseline` and `sortViolations` keep object identity (they filter or copy arrays), so the hits survive them.

- [ ] **Step 4: Run** `npx vitest run tests/unit/` → PASS.

- [ ] **Step 5: Commit** `feat: trace violations to the boxes that produced them`

---

### Task 3: Overlay model

**Files:**
- Create: `src/report/overlay.ts`
- Test: `tests/unit/overlay.test.ts`

**Interfaces:**
- Consumes: `Hit` (Task 2), `EDGE_VALUE`/`Edge` (Task 2), `Rect`.
- Produces:
  ```ts
  export interface PageGeom { width: number; height: number; captured: number } // CSS px; captured = screenshot height (0 when none)
  export type Shape =
    | { kind: 'outline'; role: 'offender' | 'peer'; rect: Rect }
    | { kind: 'shade'; rect: Rect; label: string }
    | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; label: string };
  export interface View { viewport: number; crop: Rect; shapes: Shape[]; belowCapture: boolean }
  export function buildViews(hits: Hit[], pages: Map<number, PageGeom>): View[]; // one View per viewport, ascending
  ```

Rules the tests pin:
- **Crop:** the union of all hits' offender and peer rects at that viewport, padded by 48, then grown around its centre to at least 240×120, then clamped to `[0, page.width] × [0, page.height]`.
- **`belowCapture`:** true when the first offender's top is at or below `captured`.
- **Outlines:** one per offender box (role `offender`) and one per peer box (role `peer`), using `box.rect`.
- **Measurement shapes by `finding.check`:**
  - `gap` / `min-gap`: one `shade` covering the space between `offenders[0]` and `offenders[1]`. If `b.rect.y >= a.rect.y + a.rect.height`, the gap is vertical: it spans the union of their x ranges, from a's bottom to b's top. Otherwise it is horizontal: from a's right to b's left, spanning the union of their y ranges. The label is `13px` for `gap` (`expected` 16 → label `13px · siblings 16px`); `min-gap` uses `13px · min 16px`.
  - Alignment edges (`left`, `right`, `top`, `bottom`, `center-x`, `center-y`, `baseline`): one dashed `line` at the peers' edge value (`EDGE_VALUE[edge](peers[0])`). It is vertical for x edges and horizontal for the rest, and spans the union of the offender and peer rects on the other axis. Label `${measured}px off`.
  - `height`, `width` and other size-consistency checks: one `shade` equal to the offender rect, label `${measured}px · others ${expected}px`.
  - `inset-x` / `inset-y` / `scale`: one `shade` equal to the offender rect, with `finding.message` as the label.
  - `hscroll`: one `shade` with `x = page viewport width` (the `View.viewport`), `width = page.width - viewport`, spanning the crop height, label `+${measured}px`. The crop for `hscroll` always includes that strip.
  - `clipped` / `spill` / `ellipsis`: `shade` = offender rect, label = message.
  - `overlap`: `shade` = the intersection of the two offender rects, label `overlap`.
  - Any other check: outlines only, with no measurement shape.

- [ ] **Step 1: Write the failing tests**, one per bullet above, using `tests/helpers/boxes.ts` to build boxes. Include:
  - The vertical gap: boxes at y 0–40 and 53–93 give a shade `{y: 40, height: 13}` with label `13px · siblings 16px`.
  - The left edge: offender x 23 and peers x 20 give a vertical line at x 20 with label `3px off`.
  - `hscroll` at viewport 375 with page width 433 gives a shade from x 375, width 58.
  - Clamping: an offender at x 0 gives `crop.x === 0`.
  - The minimum size: a 4×4 box gives a crop at least 240×120.
  - `belowCapture`: an offender at y 12000 with `captured: 10000`.

- [ ] **Step 2: Run** `npx vitest run tests/unit/overlay.test.ts`. Expected: FAIL, the module is missing.

- [ ] **Step 3: Implement** `buildViews` in `src/report/overlay.ts`.

- [ ] **Step 4: Run** it again. Expected: PASS.

- [ ] **Step 5: Commit** `feat: overlay model for the visual report`

---

### Task 4: HTML renderer

**Files:**
- Create: `src/report/html.ts`
- Modify: `src/report/format.ts` (export `violationBlock`, unchanged behaviour)
- Test: `tests/unit/html.test.ts`

**Interfaces:**
- Consumes: `UrlReport` and `violationBlock` (format.ts), `hitsOf` (Task 2), `buildViews`/`PageGeom` (Task 3), `pngSize` (Task 1).
- Produces:
  ```ts
  export interface Capture { url: string; viewport: number; snapshot: Snapshot; png: Buffer | null }
  export function renderReport(input: { version: string; reports: UrlReport[]; notes: string[]; captures: Capture[] }): string;
  ```

Behaviour the tests pin:
- **The images:** there is exactly one `data:image/png;base64,` per capture that has a png. Each is defined once (an SVG `<symbol>`/`<image>` with an id, or a CSS variable), and every crop references it by id.
- **The image's display size** is `width = PageGeom.width` CSS px and `height = pngHeight × PageGeom.width / pngWidth`. This keeps a 2× PNG aligned (Review Focus 1). `PageGeom.width = max(snapshot.page.scrollWidth, snapshot.page.clientWidth)`, and `captured` is that display height.
- **Without a png,** the view draws a wireframe of `snapshot.boxes`: grey outlines, text boxes filled lightly. `PageGeom.height` is the largest box bottom, and the page shows the line "screenshots unavailable for this adapter; showing measured boxes". Draw the same wireframe crop when `belowCapture` is set, with the line "below the captured area".
- **Cards:** one `<section class="finding">` per violation in report order, containing `violationBlock(v)` in a `<pre>`, HTML-escaped (Review Focus 2). Each View is an `<svg viewBox="crop">` holding the image reference and the shapes. Offender outlines use `#e5484d` and peer outlines `#3e63dd`. Clicking a crop opens a full-page view of that viewport with the same shapes (a `<dialog>` with an SVG whose viewBox is the whole page, scrolled to the crop).
- **Header:** the URLs, the viewports, error and warning counts, and `uilint ${version}`. A page with no violations shows "no problems found".
- **Output:** no `<script src`, `<link`, `http` image or `@import`. The page uses `color-scheme: light dark`.

- [ ] **Step 1: Write the failing tests** in `tests/unit/html.test.ts`, using a tiny real PNG fixture built in the test (a 1×1 PNG base64 literal is fine; `pngSize` only reads the header):
  - "embeds each screenshot once": 2 violations at the same (url, 375) capture gives a count of 1 for `data:image/png;base64,`.
  - "one card per violation, in order, with the CLI text".
  - "escapes element text": a locator with text `<b>&"x"` gives `&lt;b&gt;&amp;&quot;x&quot;` and no `<b>`.
  - "sizes a 2× screenshot by CSS width": a PNG header of 750×2000 for a page with scrollWidth 375 gives an `<image … width="375" height="1000"`.
  - "draws a wireframe when there's no screenshot": `png: null` gives no `data:image/png`, a `<rect` per box, and the line "screenshots unavailable".
  - "makes no network requests": a regex over the output for `src="http`, `<link`, `@import` and `url(http` finds nothing.
  - "says no problems found for a clean page".

- [ ] **Step 2: Run** `npx vitest run tests/unit/html.test.ts`. Expected: FAIL, the module is missing.

- [ ] **Step 3: Implement** `renderReport`. Exporting `violationBlock` from `format.ts` must not change `formatText` output; the existing `tests/unit/format.test.ts` guards that.

- [ ] **Step 4: Run** `npx vitest run tests/unit/` → PASS.

- [ ] **Step 5: Commit** `feat: render the visual report as one HTML file`

---

### Task 5: `--report` in the CLI and run

**Files:**
- Modify: `src/cli.ts` (option), `src/run.ts`
- Create: `tests/e2e/pages/hscroll.html` (a 433px-wide fixed block in a page; it must produce an `hscroll` error at 375)
- Test: `tests/e2e/cli.test.ts`

**Interfaces:**
- Consumes: `screenshot`/`MAX_SCREENSHOT_HEIGHT` (Task 1), `renderReport`/`Capture` (Task 4).
- Produces:
  - `RunOptions.report?: string`, the path as given.
  - CLI `--report <file>`, described as "also write a visual HTML report to <file>".

Behaviour:
- **Capture:** when `opts.report` is set, after `stableSnapshot` returns, call `page.screenshot?.({ maxHeight: MAX_SCREENSHOT_HEIGHT }) ?? null` and keep a `Capture`. Captures are not kept without `--report`.
- **Writing:** after the reports are built, resolve the path against `opts.cwd`, `mkdir -p` its dirname, and write `renderReport({ version, reports, notes, captures })`. `version` is read from the package's `package.json` next to `dist/` or `src/`.
  - On a write failure, throw `UilintError(\`could not write report ${path}: ${code or message}\`)`, which gives exit 2.
  - On success, push the note `report written to ${path}` *before* formatting, so it appears in text and in JSON `notes`. The path is shown as given if it was relative, absolute otherwise.
- `--report` with `--update-baseline` throws `UilintError('--report cannot be combined with --update-baseline')` before any browser starts.

- [ ] **Step 1: Write the failing e2e tests** in `tests/e2e/cli.test.ts`:
  - "writes a report with one card per violation": run `misaligned.html --report out/r.html` in `tmp`. Expect exit 1, a stdout line `note  report written to out/r.html`, and the file to exist with `finding` sections equal in number to the error/warning count in the header, plus `data:image/png;base64,` 3 times (3 viewports).
  - "stdout is unchanged without --report": the stdout of a `misaligned.html` run has no `report written` line. Compare it to the run with `--report` minus that note line; they are equal.
  - "the report ignores --max": `misaligned.html --max 1 --report r.html`. The text shows `more not shown`, and the report has every finding.
  - "shows the sideways-scroll strip": `hscroll.html --viewport 375 --report h.html` produces a report containing `+58px` (or the fixture's exact overflow) inside an SVG.
  - "exit 2 when the report can't be written": write a file `blocker` in `tmp`, then run with `--report blocker/r.html`. Expect exit 2 and stderr matching `/could not write report/`.
  - "rejects --report with --update-baseline": exit 2, with the message.

- [ ] **Step 2: Run** `npx vitest run tests/e2e/cli.test.ts`. Expected: the new tests fail (unknown option `--report`).

- [ ] **Step 3: Implement** in `cli.ts` and `run.ts`.

- [ ] **Step 4: Run** `npm test`. Expected: all pass. The existing CLI tests still pass, which guards Global Constraint 2.

- [ ] **Step 5: Commit** `feat: --report writes a visual HTML report`

---

### Task 6: Overlays land on the pixels

**Files:**
- Create: `tests/e2e/pages/report-align.html`: a solid `#00ff00` offender box 3px out of line with two aligned peers, plus a `position:fixed` header bar (`#0000ff`) with a child misaligned the same way.
- Test: `tests/e2e/report-alignment.test.ts`

**Interfaces:**
- Consumes: the CLI from Task 5.

- [ ] **Step 1: Write the test.**
  1. Run the CLI on `report-align.html --viewport 800 --report r.html`.
  2. Open `r.html` in Playwright (`file://`) at 1600 wide, and for the first finding's first crop, read the bounding box of the offender `<rect>` outline and the SVG's mapping.
  3. Screenshot the crop element and sample the pixel just inside the outline's top-left corner. It must be `#00ff00` (±8 per channel).
  4. Do the same for the finding on the fixed header child: the sampled pixel is the header child's colour.
  Name: "outlines sit on the elements they name, including fixed layers".

- [ ] **Step 2: Run** `npx vitest run tests/e2e/report-alignment.test.ts`. It should pass if Tasks 1–5 are right. If it fails, debug the geometry and don't loosen the test. (This is a verification task: there's no new production code unless it fails.)

- [ ] **Step 3: Commit** `test: report overlays align with screenshot pixels`

---

### Task 7: Docs and agent instructions

**Files:**
- Modify: `README.md` (a new "Visual report" section after "Reading the output", the flag in the flags list, and a `.gitignore` tip in the agent section)
- Modify: `agent/INSTRUCTIONS.md`, `agent/skills/uilint/SKILL.md`

Content fixed by the spec:
- The agent's command gains ` --report uilint-report.html` at the end, keeping whatever command prefix the file has. (`main`'s uncommitted publish work renames it to `npx @aselhid/uilint`; whichever lands second keeps both changes.)
- A new rule line: "Don't open or read `uilint-report.html`, and never commit it. When you finish, tell the human it's there: `visual report: uilint-report.html`."
- README: what the report shows (red is the element to fix, blue what it was compared with, the measurement drawn on), that it includes findings `--max` hides, the wireframe fallback for adapters without screenshots, and the 10,000px cap.
- Add a `screenshot` line to the README's custom-adapter section: optional, a full-page PNG at CSS scale.

- [ ] **Step 1: Edit the docs.**
- [ ] **Step 2: Verify** with `grep -n "report" README.md agent/INSTRUCTIONS.md agent/skills/uilint/SKILL.md`, which shows the new lines. Then check by hand that the README's example commands run against the demo app: `cd demo && node record.mjs` is not needed. Run `npx uilint http://localhost:5173/?v=before --report /tmp/r.html` with `node demo/server.mjs` running, and open the file.
- [ ] **Step 3: Commit** `docs: visual report`
