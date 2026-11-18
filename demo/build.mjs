// Bundles the demo app twice: as the agent first wrote it (src) and after the agent's fixes (src-fixed).
// jsxDev keeps React's source locations, so uilint can name components and files the way it would in a dev server.
import { build } from 'esbuild';

for (const [variant, dir] of [['before', 'src'], ['after', 'src-fixed']]) {
  await build({
    entryPoints: [`${dir}/main.tsx`],
    absWorkingDir: new URL('./app/', import.meta.url).pathname,
    bundle: true,
    outfile: `dist/${variant}.js`,
    jsx: 'automatic',
    jsxDev: true,
    define: { 'process.env.NODE_ENV': '"development"' },
    logLevel: 'warning',
  });
}
