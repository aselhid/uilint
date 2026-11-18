# uilint contrast rule: design

Date: 2026-11-19. Status: draft, awaiting approval.

## Why

Agents pick colours by eye from a token list, and light grey on white or white on a mid-tone button looks fine in code but is hard to read. uilint already loads the rendered page and measures every text box, so it can measure the colour contrast of that text against what is really painted behind it, and tell the agent exactly which element and which colours to change.

## Goal

A new rule, `contrast`, that reports text whose contrast against its rendered background is below a threshold. It behaves like the other rules: measured in the real browser, deterministic, printed in the same text format (selector, text snippet, React component, JSX source line, viewports, ×N), with configurable severity and options, ignorable via `uilint.ignore`, baselinable, and drawn in the `--report` HTML.

Example output:

```
error  contrast  text contrast 2.85:1, needs 4.5:1 (#999999 on #ffffff)  @375,768,1280  (×4)
  span.meta "Updated 3 days ago"  <OrderRow>  src/orders/OrderRow.tsx:14

warn   contrast  text over a background image, contrast not checked  @375,768,1280
  h1.hero-title "Ship faster"  <Hero>  src/marketing/Hero.tsx:9
```

## Non-goals

- Contrast of non-text things (icons, borders, focus rings, WCAG 1.4.11). Possible later.
- Reading pixels from screenshots (see approaches).
- Text inside `<svg>`, `<canvas>` and iframes (uilint doesn't measure those today).
- Placeholder text and typed values inside `<input>`/`<textarea>`/`<select>` (not text nodes, so uilint has no text box for them). Deferred, see open questions.
- Changing any other rule.

## Anti-goals

- Guessing. When uilint can't know the background, it says so; it never reports a ratio it didn't measure.
- False errors on correct pages: text over a positioned hero image must never be reported as "white on white".
- Changing output, JSON or exit codes for pages that have no contrast problem.

## Approaches considered

- **A. Computed styles plus the browser's own hit-testing (chosen).** For a sample point on each run of text, `elementsFromPoint` gives every element under that point in paint order. The layers below the text are composited from their computed `background-color`, opacity and alpha, top-down until an opaque layer is found. Anything whose colour can't be known from styles (image, video, canvas, backdrop-filter, blend mode, filter) makes the result "unverified". Uses the browser's real paint order, so positioned siblings, overlays and `z-index` are handled without uilint reimplementing stacking contexts. No new dependency, deterministic, works in every adapter (it's one more `evaluate`).
- **B. Ancestor walk only.** Simpler, but wrong whenever the background is a positioned sibling (hero image, overlay `<div>`, card behind absolutely positioned text): it would report white text over a photo as white on white. Rejected; this is exactly the false alarm the anti-goals rule out.
- **C. Pixel sampling from a screenshot** (render once with text hidden, once shown, compare). Handles images and gradients, but needs `screenshot` (optional in the adapter interface), two extra full-page captures per viewport, anti-aliasing heuristics, and is only as deterministic as the GPU raster. Rejected for v1; a good later fallback for the "unverified" cases.
- **D. axe-core's `color-contrast` rule.** Battle-tested, but a ~500 KB runtime dependency injected into the page, its own result model to translate, and its "incomplete" results would still need our own reporting. The task asks for no new runtime dependencies without strong reason; A gives the same core behaviour in ~250 lines we control. Rejected.

## Contrast formula and thresholds

- WCAG 2.x contrast ratio: `(L1 + 0.05) / (L2 + 0.05)` with sRGB relative luminance (linearisation threshold 0.04045, as in WCAG 2.2). Colours are composited in sRGB space, as browsers do.
- No rounding when comparing: 4.49:1 fails a 4.5:1 minimum. Printed ratios are truncated to 2 decimals so a failing value never prints as the minimum.
- Large text: computed `font-size` ≥ 24px, or ≥ 18.66px (14pt) with `font-weight` ≥ 700.
- Option `level`: `'AA'` (default; 4.5:1 normal, 3:1 large) or `'AAA'` (7:1 normal, 4.5:1 large).

## Measuring

### When

The contrast pass is a separate in-page script (`src/browser/contrast.page.js`), run once per viewport **after** `stableSnapshot` returns and after the report screenshot is taken, and only when the `contrast` rule is not `off`. Layout rules see exactly the snapshot they see today. With `contrast: 'off'` the run is byte-for-byte today's.

The measure script keeps the text-box slots of its last pass (owner element, text nodes, clip box) in a page global (`window.__uilintTextSlots`) so the contrast pass can address the same box ids. The contrast pass deletes it.

### Which text

Every `text` box uilint measures (visible, non-sr-only text nodes), except:

- text inside a disabled control: an ancestor-or-self matching `:disabled` or `[aria-disabled="true"]` (WCAG exempts inactive components);
- text whose colour has alpha 0 and no `background-clip: text` (invisible on purpose).

### Sample points

Each text box groups text nodes that may have different colours (`<p>Hi <a>link</a></p>`). For each text node (up to 32 per box, document order), take each line fragment's client rect (clipped to the box's clip ancestor, as `lines` already are) and sample its centre. The colour, font size and weight come from the text node's parent element.

`elementsFromPoint` only works inside the viewport, so the pass scrolls the window (`behavior: 'instant'`) band by band to bring sample points into view, then restores the original scroll position before returning. `pointer-events: none` elements are skipped by hit-testing, so the pass adds a temporary `*,*::before,*::after{pointer-events:auto!important}` style and removes it before returning. Shadow DOM text uses its root's `elementsFromPoint`.

### Background at a point

From the hit-test stack, find the text node's parent element; everything after it in the stack paints below the text. Walk those layers top-down:

1. A layer that is `img`, `picture`, `video`, `canvas`, `svg` (or inside one), `iframe`, `object` or `embed` → unverified (`image`, `video`, `canvas`, `embedded content`).
2. A layer with `background-image` other than `none`: a `url()` → unverified (`image`); a gradient → see gradients below.
3. A layer with `backdrop-filter`, or any layer or text ancestor with `mix-blend-mode` other than `normal` or `filter` other than `none` → unverified (`backdrop-filter`, `blend mode`, `filter`).
4. Otherwise collect the layer's `background-color`. Stop at the first layer whose colour is opaque and which sits under no opacity < 1.
5. If nothing opaque is found, the bottom is the page canvas: white, or `#121212` when the root's used `color-scheme` is dark.

Composite the collected layers bottom-up with exact group opacity: an element with `opacity` < 1 is a stacking context, so its descendants are contiguous in paint order; render each group onto transparent, then composite it with its opacity onto the layer below. The text colour (its alpha, inside its own opacity groups) is composited the same way over that background. That gives the two colours the eye sees: glyph and background.

`text-shadow` and `-webkit-text-stroke` are ignored (builder's call: they rarely rescue contrast on a solid background and over an image the result is unverified anyway). Gradient text (`background-clip: text` with transparent colour) → unverified (`gradient text`).

**Gradients (pending the user's answer, see open questions):** proposed: parse the colour stops from the computed `background-image`; if every stop parses, the background is each stop in turn (composited as above) and the worst ratio counts, printed as `... (#999999 on gradient, worst stop #f5f5f5)`. A gradient that doesn't parse → unverified (`gradient`).

### Colours

Computed colours are usually `rgb()`/`rgba()`; those are parsed exactly. Anything else (`oklch()`, `lab()`, `color(display-p3 …)`, which Tailwind v4 emits) is converted through a 1×1 canvas (`fillStyle` → `getImageData`), cached per string. Output colours print as `#rrggbb` (alpha already composited away).

### What the snapshot carries

`Box` gains one optional field, set only on text boxes when the pass ran:

```ts
contrast?: {
  /** One per sample, document order, at most 32. */
  samples: { ratio: number; large: boolean; fg: string; bg: string; gradient: boolean }[];
  /** Why some samples couldn't be measured; null if all were. */
  unverified: 'image' | 'gradient' | 'gradient text' | 'video' | 'canvas' | 'embedded content' | 'backdrop-filter' | 'blend mode' | 'filter' | 'hidden' | null;
}
```

`hidden`: the text's own element wasn't in the hit-test stack at its own position (covered by something that captures hit-testing even with pointer-events forced, or moved by a sticky ancestor while scrolled).

Optional means existing `Box` fixtures and tests are untouched.

## The rule

`src/rules/contrast.ts`, registered after `overflow`. Checks:

| check | reports | default severity |
|---|---|---|
| `ratio` | the worst sample's ratio is below its minimum | `error` (rule severity) |
| `unverified` | no measured sample fails, but at least one couldn't be measured | `warn` (pending the user's answer) |

- For `ratio`, the worst sample is the one with the lowest `ratio / minimum` (ties: first). `measured` = ratio truncated to 2 decimals, `expected` = minimum. Message: `text contrast 2.85:1, needs 4.5:1 (#999999 on #ffffff)`; large text says `needs 3:1 for large text`.
- A box with a failing measured sample reports `ratio` even if other samples are unverified.
- Options, with defaults: `level: 'AA'`, `ratio: 'error'`, `unverified: 'warn'`. `ratio`/`unverified` take `'off' | 'warn' | 'error'`, capped by the rule severity exactly like `overflow`'s sub-checks.
- Config validation: `contrast` joins `RULE_NAMES`; `ratio` and `unverified` join the ignore file's check names.
- Merging, collapsing, fingerprints and baselines need no change: fingerprints use rule, check and elements, never colours, so fixing a colour keeps the fingerprint.

## Visual report

`overlay.ts` gets one new shape, `{ kind: 'tag'; label; near: Rect }`: a label placed beside a box with the existing label placement (clear of outlines and other labels), no shading, because shading the text would change the very contrast being shown. For contrast findings the offender's text rect is outlined in red and tagged:

- `ratio`: `2.85:1 · min 4.5:1`
- `unverified`: `not checked: image` (the reason)

## Docs and agent instructions

- README: rules table rows for `contrast/ratio` and `contrast/unverified`, the options table row, a short paragraph on how the background is found and what "unverified" means, and the one-line note that the page is scrolled during the pass.
- `agent/INSTRUCTIONS.md` and `agent/skills/uilint/SKILL.md`: one bullet: fix a contrast error by changing the text or background colour named in the message to a colour from the project's palette; an `unverified` warning means check it by eye and mention it.

## Testing

- Unit: luminance/ratio maths against known pairs (#777/#fff = 4.48, #000/#fff = 21), large-text classification, the rule's selection of the worst sample and severity capping, overlay shapes.
- In-browser (`tests/browser/contrast.test.ts`, real Chromium): solid parent background; semi-transparent layers over a colour; opacity on the text, on a parent with no background, and on a parent with an opaque background (group opacity); positioned sibling background (hero) behind text; image / gradient / video / canvas / backdrop-filter → unverified; disabled button skipped; `pointer-events: none` overlay below text; text below the first viewport; shadow DOM; `oklch()` colours; large-text thresholds.
- E2E: a `bad/contrast-low.html` defect fixture in the fixture table; the clean fixtures stay error-free; determinism test unchanged.

## Open questions for the user

1. **Formula:** WCAG 2.x ratio (proposed: the published standard, what designers and lawyers check against) or APCA (WCAG 3 draft, better perceptually, not yet a standard, thresholds depend on font size and weight tables)?
2. **Defaults:** AA (4.5 / 3) proposed, with `level: 'AAA'` available. Should `ratio` be an `error` by default like every other rule (proposed), or a `warn` so existing projects don't start failing on upgrade?
3. **Unknown backgrounds** (image, video, canvas, backdrop-filter, blend mode, filter): a `warn` finding per element (proposed: visible to the agent, never fails a run, can be set to `off`), a single per-page note, or silent?
4. **Gradients:** check against the worst colour stop (proposed: subtle card gradients are common and checkable; it can over-report when text sits over the light end of a strong gradient) or treat every gradient as unverified?
5. **Placeholders and disabled text:** proposed: disabled controls skipped (WCAG exempts them); placeholders and input values not checked in v1. Should placeholders be checked in v1?

## Left to the builder

Sampling cap details, the scroll band height, colour-parse cache, exact message wording within the pattern above, and test fixture contents.
