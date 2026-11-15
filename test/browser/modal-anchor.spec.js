import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const client = readFileSync(new URL('../../client/agent-feedback-pins.js', import.meta.url), 'utf8');

test('a docked Feedback button keeps its toolbar position through modal dialogs', async ({ page }) => {
  const captures = [];
  await page.route('https://raw.githubusercontent.com/**', route => route.fulfill({ json: { version: '0.2.2' } }));
  await page.route('http://afp.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/api/items')) {
      if (route.request().method() === 'POST') {
        const item = { ...route.request().postDataJSON(), id: '1', number: 1, status: 'open' };
        captures.push(item);
        return route.fulfill({ json: item });
      }
      return route.fulfill({ json: captures });
    }
    if (path.endsWith('/api/me')) return route.fulfill({ json: { author: { name: 'Fictional Tester' } } });
    if (path.endsWith('/api/settings')) return route.fulfill({ json: {} });
    if (path.endsWith('/client.js')) return route.fulfill({ contentType: 'text/javascript', body: client });
    return route.fulfill({ contentType: 'text/html', body: `
      <style>
        body { margin: 0; zoom: 1.625; }
        header { display: flex; justify-content: end; gap: 8px; padding: 12px; transform: translateX(-10px); overflow: hidden; }
        dialog { width: 400px; max-height: 250px; overflow: auto; }
      </style>
      <header><button id="dock">Account</button></header>
      <dialog id="settings"><h1>Domain settings</h1><input aria-label="Domain name" value="Example"></dialog>
      <dialog id="nested"><h1>Nested confirmation</h1><input aria-label="Confirmation"></dialog>
      <script src="/__afp/client.js" data-mount-before="#dock"></script>` });
  });
  await page.goto('http://afp.test/');
  const feedback = page.getByRole('button', { name: 'Feedback', exact: true });
  await expect(feedback).toBeVisible();
  await expect.poll(async () => {
    const host = await page.locator('agent-feedback-pins-button').boundingBox();
    const button = await feedback.boundingBox();
    return Math.max(Math.abs(button.x - host.x), Math.abs(button.y - host.y));
  }).toBeLessThan(1);
  const before = await feedback.boundingBox();
  const accountBefore = await page.locator('#dock').boundingBox();
  const assertPosition = async () => {
    await expect.poll(async () => {
      const button = await feedback.boundingBox();
      const account = await page.locator('#dock').boundingBox();
      return Math.max(Math.abs(button.x + button.width - account.x - (before.x + before.width - accountBefore.x)), Math.abs(button.y - before.y));
    }).toBeLessThan(1);
  };

  await page.evaluate(() => document.querySelector('#settings').showModal());
  await page.getByRole('textbox', { name: 'Domain name' }).fill('Unsaved domain edits');
  await assertPosition();
  // This is an ordinary click, not force: the modal must not make Feedback inert.
  await feedback.click();
  await page.getByRole('button', { name: 'Whole page', exact: true }).click();
  await page.getByPlaceholder('What should change here?').fill('Fictional modal feedback');
  await page.getByRole('button', { name: /^Save/ }).click();
  await expect.poll(() => captures.length).toBe(1);
  await expect(page.getByPlaceholder('What should change here?')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#settings')).toHaveAttribute('open', '');
  await expect(page.getByRole('textbox', { name: 'Domain name' })).toHaveValue('Unsaved domain edits');
  await assertPosition();

  await page.evaluate(() => document.querySelector('#nested').showModal());
  await assertPosition();
  await feedback.click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#nested')).toHaveAttribute('open', '');
  await page.setViewportSize({ width: 1280, height: 900 });
  await assertPosition();
  await page.evaluate(() => document.querySelector('#nested').close());
  await assertPosition();
  await page.evaluate(() => document.querySelector('#settings').close());
  await assertPosition();
  await expect(page.locator('agent-feedback-pins-anchor')).toHaveCount(0);
  await feedback.click();
  await expect(page.getByRole('button', { name: 'Whole page', exact: true })).toBeVisible();
});
