// Compiles src/ and copies the in-page scripts verbatim: tsc would append `export {};` to it,
// which breaks evaluating it as an expression inside the page.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const i = process.argv.indexOf('--outDir');
const outDir = i === -1 ? join(root, 'dist') : resolve(process.argv[i + 1]);
execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', join(root, 'tsconfig.json'), '--outDir', outDir], { stdio: 'inherit' });
mkdirSync(join(outDir, 'browser'), { recursive: true });
for (const page of ['measure.page.js', 'contrast.page.js']) {
  copyFileSync(join(root, 'src/browser', page), join(outDir, 'browser', page));
}
