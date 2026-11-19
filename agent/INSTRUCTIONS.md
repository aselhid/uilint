## UI checks with uilint

After you change UI, run uilint on every page you touched, with the dev server running:

```sh
npx @aselhid/uilint http://localhost:3000/<page> [more urls...] --report uilint-report.html
```

Rules:

- After changing UI, run `uilint` on the affected pages.
- Fix every error by changing the UI code, then run uilint again. You are done when it exits with code 0.
- Never edit `uilint.ignore`, `uilint.baseline.json` or `uilint.config.*`.
- If a violation looks intentional, stop and tell the human, quoting the violation. Don't work around it.
- Always pass `--report uilint-report.html`. It is a visual report for the human: don't open or read it, and never commit it. When you finish, tell the human it's there: `visual report: uilint-report.html`.

Exit code 1 means there are errors to fix. Exit code 2 means uilint itself could not run (page didn't load, setup script failed, layout kept moving); read the message and fix the cause, or report it.

How to read a violation:

```
error  spacing  gap 14px, siblings use 16px  @375,1280  (×3)
  li.order-row "Order 1003"  <OrderRow>  src/orders/OrderRow.tsx:8
  li.order-row "Order 1004"  <OrderRow>  src/orders/OrderRow.tsx:8
  compared with: li.order-row "Order 1001"  <OrderRow>  src/orders/OrderRow.tsx:8  (+2 more)
```

- First line: severity, rule, what was measured and what was expected, the viewport widths where it happens, and `(×N)` when the same problem repeats on N similar elements.
- Indented lines: the elements to fix, each as a CSS selector, a snippet of its text, its React component and source file. A spacing problem names the boxes on both sides of the gap.
- `aligned with:` or `compared with:` names the elements it was measured against. Those set the expected value, so change the reported element to match them, not the other way round.

A `contrast` error names the colours it measured, for example `(#aaaaaa on #ffffff)`. Fix it by darkening or lightening the text or its background, using a colour from the project's palette or design tokens. A `contrast` `unverified` warning means the text sits on something uilint can't measure, such as an image. Don't change anything for it; mention it in your summary so the human can check it in the visual report.

Warnings (`warn`) don't fail the run. Fix them when the fix is obvious, otherwise mention them.

For a modal, menu or other state behind a click, write a small setup script and pass it with `--setup` (see the uilint README).
