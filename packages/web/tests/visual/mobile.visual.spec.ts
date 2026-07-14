import { expect, test } from '@playwright/test';

for (const [name, path] of [['dashboard', '/today'], ['history', '/history'], ['capture', '/log']] as const) {
  test(`mobile ${name}`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-07-14T15:00:00-05:00'));
    const separator = path.includes('?') ? '&' : '?';
    await page.goto(`${path}${separator}visual-test=1`);
    await page.getByLabel('Loading application').waitFor({ state: 'detached' });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.dev-modal').evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
    await page.addStyleTag({ content: '.sticky { position: static !important; }' });
    await expect(page).toHaveScreenshot(`mobile-${name}.png`, { fullPage: true });
  });
}
