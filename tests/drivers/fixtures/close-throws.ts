import { createPlaywrightDriver } from '../../../src/drivers/playwright.js';
import type { CreateDriver } from '../../../src/types.js';

/** A custom adapter whose close calls fail after doing their work, like a browser connection that dropped. */
export const createDriver: CreateDriver = async (options) => {
  const inner = await createPlaywrightDriver(options);
  return {
    name: 'close-throws',
    async open(url, viewport, timeoutMs) {
      const page = await inner.open(url, viewport, timeoutMs);
      return { ...page, close: async () => { await page.close(); throw new Error('Connection closed.'); } };
    },
    close: async () => { await inner.close(); throw new Error('Connection closed.'); },
  };
};
