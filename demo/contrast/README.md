# Contrast demo

`index.html` is a small pricing page with low-contrast text planted in it: pale nav links, white text on the light end of a gradient, a white badge on amber, faint captions, a pale button label, a pale input placeholder and a footer. The hero text sits over a background image, so uilint reports it as unverified instead of guessing. `uilint.config.json` turns the layout rules off so only contrast findings show.

```sh
# from the repo root, after npm run build
cd demo/contrast
python3 -m http.server 8791 &
node ../../dist/cli.js http://localhost:8791/index.html --report uilint-report.html
```

uilint exits 1 with 10 errors and 2 warnings. `docs/media/uilint-contrast-report.png` is the top of the report from a run with `--viewport 1280`.
