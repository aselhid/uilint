#!/usr/bin/env node
import { Command, CommanderError, InvalidArgumentError } from 'commander';
import { run } from './run.js';

function widths(value: string): number[] {
  const list = value.split(',').map((s) => s.trim());
  if (!list.every((s) => /^\d+$/.test(s) && Number(s) > 0)) {
    throw new InvalidArgumentError('--viewport takes positive widths separated by commas, e.g. 375,1280');
  }
  return list.map(Number);
}

function positiveInt(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1) throw new InvalidArgumentError('--max takes a positive integer');
  return Number(value);
}

const program = new Command()
  .name('uilint')
  .description('Lint a rendered web page for near-miss spacing, alignment, size and overflow problems.')
  .argument('[urls...]', 'pages to lint (default: pages in the config)')
  .option('--config <path>', 'config file (default: ./uilint.config.ts or .json)')
  .option('--viewport <widths>', 'override configured widths, comma separated', widths)
  .option('--driver <name|path>', 'browser adapter: playwright (default), betterwright, or a module path')
  .option('--profile <dir>', 'playwright: launch with an existing user-data dir (reuse login)')
  .option('--cdp <port|url>', 'playwright: attach to an already-running Chrome')
  .option('--setup <file>', 'script run before measuring (open a modal, fill a form, ...)')
  .option('--json', 'machine-readable output')
  .option('--max <n>', 'cap the number of reported violations', positiveInt, 50)
  .option('--update-baseline', 'write current violations to the baseline file and exit 0')
  .option('--report <file>', 'also write a visual HTML report to <file>')
  .exitOverride()
  .action(async (urls: string[], o) => {
    const result = await run({
      urls,
      config: o.config,
      viewports: o.viewport,
      driver: o.driver,
      profile: o.profile,
      cdp: o.cdp,
      setup: o.setup,
      json: !!o.json,
      max: o.max,
      updateBaseline: !!o.updateBaseline,
      report: o.report,
      cwd: process.cwd(),
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  });

try {
  await program.parseAsync();
} catch (e) {
  if (e instanceof CommanderError) {
    process.exitCode = e.exitCode === 0 ? 0 : 2;
  } else {
    process.stderr.write(`uilint: unexpected error: ${(e as Error).stack ?? e}\n`);
    process.exitCode = 2;
  }
}
