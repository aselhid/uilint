import type { Page } from 'playwright';

export default async (page: Page) => {
  await page.evaluate(() => { document.title = 'setup-ran'; });
};
