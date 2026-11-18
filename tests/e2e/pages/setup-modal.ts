import type { Page } from 'playwright';

export default async (page: Page) => {
  await page.click('#open');
  await page.waitForSelector('dialog[open]');
};
