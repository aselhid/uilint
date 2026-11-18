import { createPlaywrightDriver } from '../../../src/drivers/playwright.js';
import type { CreateDriver } from '../../../src/types.js';

/** A custom adapter module: wraps the built-in Playwright driver under another name. */
export const createDriver: CreateDriver = async (options) => {
  const inner = await createPlaywrightDriver(options);
  return { name: 'wrapped', open: inner.open.bind(inner), close: inner.close.bind(inner) };
};
