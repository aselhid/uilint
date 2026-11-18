import { createPlaywrightDriver } from '../../../src/drivers/playwright.js';
import type { CreateDriver } from '../../../src/types.js';

/** A custom adapter whose screenshots fail, like a GPU or font timeout during capture. */
export const createDriver: CreateDriver = async (options) => {
  const inner = await createPlaywrightDriver(options);
  return {
    name: 'screenshot-throws',
    async open(url, viewport, timeoutMs) {
      const page = await inner.open(url, viewport, timeoutMs);
      return { ...page, screenshot: async () => { throw new Error('page.screenshot: Timeout 30000ms exceeded.\n    at stack'); } };
    },
    close: () => inner.close(),
  };
};
