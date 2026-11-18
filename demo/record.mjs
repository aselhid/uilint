// Records the demo video from real uilint runs.
//   node record.mjs                 full video -> out/uilint-demo.mp4
//   node record.mjs --stills 4,12   single frames at those seconds -> out/stills/
import { execFile } from 'node:child_process';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ffmpeg from 'ffmpeg-static';
import { chromium } from 'playwright';
import { startServer } from './server.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = join(here, 'out');
const FPS = 30;
const sh = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { cwd: here, maxBuffer: 1e8 },
  (e, stdout, stderr) => resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, stdout, stderr })));

function parseDiff(text) {
  const files = [];
  let file = null, current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(4).split('\t')[0].replace(/^app\/src-fixed\//, 'src/');
    else if (line.startsWith('@@')) {
      current = { file, line: Number(line.match(/\+(\d+)/)[1]), lines: [] };
      files.push(current);
    } else if (current && /^[-+]/.test(line) && !line.startsWith('---')) current.lines.push({ t: line[0], s: line.slice(1) });
  }
  return files;
}

const stillsArg = process.argv.indexOf('--stills');
const stills = stillsArg > 0 ? process.argv[stillsArg + 1].split(',').map(Number) : null;

await mkdir(out, { recursive: true });
const built = await sh('node', ['build.mjs']);
if (built.code !== 0) throw new Error(built.stderr);
const server = await startServer(5173);
const runs = {};
try {
  for (const variant of ['before', 'after']) {
    await server.setVariant(variant);
    const text = await sh('npx', ['uilint', server.url]);
    const json = await sh('npx', ['uilint', server.url, '--json']);
    if (text.code === 2) throw new Error(`uilint failed on ${variant}: ${text.stderr}`);
    runs[variant] = { text: text.stdout, code: text.code, json: JSON.parse(json.stdout) };
    console.log(`${variant}: exit ${text.code}\n${text.stdout}`);
  }
  const diff = parseDiff((await sh('diff', ['-ru', '-U0', 'app/src', 'app/src-fixed'])).stdout);
  const data = { cmd: `npx uilint ${server.url}`, before: runs.before, after: runs.after, diff };
  await writeFile(join(out, 'data.json'), JSON.stringify(data, null, 2));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('stage error:', e.message));
  await page.goto(`${server.url}stage/index.html`);
  const info = await page.evaluate((d) => window.setup(d), data);
  console.log(`stage ready: ${info.views} violations, ${info.total.toFixed(1)}s`);

  if (stills) {
    await mkdir(join(out, 'stills'), { recursive: true });
    for (const t of stills) {
      await page.evaluate((x) => window.render(x), t);
      await page.screenshot({ path: join(out, 'stills', `t${String(t).padStart(5, '0')}.png`) });
    }
  } else {
    const dir = join(out, 'frames');
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const n = Math.ceil(info.total * FPS);
    for (let i = 0; i < n; i++) {
      await page.evaluate((x) => window.render(x), i / FPS);
      await page.screenshot({ path: join(dir, `${String(i).padStart(5, '0')}.png`) });
      if (i % 300 === 0) console.log(`frame ${i}/${n}`);
    }
    const mp4 = join(out, 'uilint-demo.mp4');
    const enc = await sh(ffmpeg, ['-y', '-framerate', String(FPS), '-i', join(dir, '%05d.png'),
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', mp4]);
    if (enc.code !== 0) throw new Error(enc.stderr.slice(-2000));
    console.log(`wrote ${mp4} (${(await readdir(dir)).length} frames)`);
  }
  await browser.close();
} finally {
  await server.close();
}
