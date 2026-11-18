# uilint demo video

Builds `out/uilint-demo.mp4` from real uilint runs:

1. `build.mjs` bundles a small React dashboard twice: `app/src` (as an agent first wrote it, with four layout mistakes) and `app/src-fixed` (after the agent's edits). Both are React development builds, so uilint can name components and source lines.
2. `record.mjs` serves both versions at `http://localhost:5173/`, runs `npx uilint` (text and `--json`) on each, and diffs the two source folders.
3. The stage page (`stage/`) draws the video from that data as a function of time: the terminal shows uilint's real output, the browser highlights the elements uilint named, and the edits panel shows the real diff. Each frame is a screenshot; ffmpeg encodes them.

```sh
cd demo
npm install
npx playwright install chromium   # once, if the parent repo hasn't
node record.mjs                   # full video, about 5 minutes
node record.mjs --stills 12,30    # single frames, for checking the layout
```

Run `npm run build` in the parent folder first: the demo uses this repo's `dist/` through `npx uilint`.

## Licenses

The demo is MIT, like the rest of the repo. It uses React (MIT) and [ffmpeg-static](https://github.com/eugeneware/ffmpeg-static), whose npm package and FFmpeg binary are GPL-3.0-or-later. The binary is downloaded by `npm install`, is not part of this repository, and runs as a separate program to encode the video. Text in the video is rendered with whatever system fonts the machine has.
