import { expect, test } from '@playwright/test';

const screens = [
  ['dashboard', '/today'],
  ['inbox', '/inbox'],
  ['history', '/history?lens=month'],
  ['capture-and-multi-cpt', '/log'],
  ['cpt-picker', '/codes'],
  ['recent-batches', '/history/legacy'],
  ['settings-and-controls', '/settings'],
] as const;

for (const [name, path] of screens) {
  test(`${name} is theme-correct`, async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-07-14T15:00:00-05:00'));
    const separator = path.includes('?') ? '&' : '?';
    await page.goto(`${path}${separator}visual-test=1`);
    await page.getByLabel('Loading application').waitFor({ state: 'detached' });
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.dev-modal').evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
    await page.addStyleTag({ content: '.sticky { position: static !important; }' });
    await expect(page).toHaveScreenshot(`${name}.png`, { fullPage: true });
  });
}

test('mini window uses the same semantic theme', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-07-14T15:00:00-05:00'));
  await page.goto('/mini-pace?visual-test=1');
  await page.evaluate(() => document.fonts.ready);
  await page.locator('.dev-modal').evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  await page.addStyleTag({ content: '.sticky { position: static !important; }' });
  await expect(page).toHaveScreenshot('mini-window.png', { fullPage: true });
});

test('modal and duplicate-review surfaces remain readable', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-07-14T15:00:00-05:00'));
  await page.goto('/log?visual-test=1');
  await page.getByLabel('Loading application').waitFor({ state: 'detached' });
  await page.locator('.dev-modal').evaluateAll((nodes) => nodes.forEach((node) => node.remove()));
  await page.addStyleTag({ content: '.sticky { position: static !important; }' });
  const trigger = page.getByRole('button', { name: /paste|upload|capture/i }).first();
  if (await trigger.isVisible().catch(() => false)) await trigger.focus();
  await expect(page).toHaveScreenshot('modal-and-duplicate-flow.png', { fullPage: true });
});
