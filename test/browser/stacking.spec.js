import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const client = readFileSync(new URL('../../client/agent-feedback-pins.js', import.meta.url), 'utf8');

for (const docked of [false, true]) {
  test(`${docked ? 'docked' : 'floating'} feedback stays clickable above app overlays`, async ({ page }) => {
    let settings = docked ? {} : { position: { mode: 'floating', corner: 'top-right' } };
    await page.route('https://raw.githubusercontent.com/**', route => route.fulfill({ json: { version: '0.2.2' } }));
    await page.route('http://afp.test/**', route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith('/api/items')) return route.fulfill({ json: [] });
      if (path.endsWith('/api/me')) return route.fulfill({ json: { author: { name: 'Test' }, file: '.agent-feedback-pins/COMMENTS.md' } });
      if (path.endsWith('/api/settings')) return route.fulfill({ json: settings });
      if (path.endsWith('/client.js')) return route.fulfill({ contentType: 'text/javascript', body: client });
      return route.fulfill({ contentType: 'text/html', body: `
        <style>
          body { zoom: 1.625; margin: 0; min-height: 1200px; }
          header { position: relative; z-index: 1; transform: translateX(20px); overflow: hidden; height: 48px; }
          .cover { position: fixed; inset: 0; z-index: 2147483647; background: #ccc; }
          dialog { width: 400px; height: 300px; }
          #popover { position: fixed; inset: 0; width: 100%; height: 100%; margin: 0; background: #ddd; }
        </style>
        <header><span id="dock">Account</span></header>
        <div class="cover">App overlay</div>
        <dialog><h1>App settings</h1><input aria-label="App input"></dialog>
        <div id="popover" popover="manual">App popover</div>
        <script src="/__afp/client.js" ${docked ? 'data-mount-before="#dock"' : ''}></script>` });
    });
    await page.goto('http://afp.test/');
    const feedback = () => page.getByRole('button', { name: 'Feedback', exact: true });
    const exit = () => page.locator('agent-feedback-pins-button').getByRole('button', { name: 'Exit feedback mode', exact: true });
    const assertDocked = async () => {
      const host = await page.locator('agent-feedback-pins-button').boundingBox();
      const button = await feedback().boundingBox();
      expect(Math.abs(button.x - host.x)).toBeLessThan(1);
      expect(Math.abs(button.y - host.y)).toBeLessThan(1);
    };
    if (docked) await assertDocked();
    // Normal CSS overlays, even at maximum z-index, cannot cover the button.
    await feedback().click();
    await expect(exit()).toBeVisible();
    await exit().click();
    const floatingPosition = !docked && await feedback().boundingBox();
    // A native dialog also makes the background inert; the feedback UI must remain interactive.
    await page.evaluate(() => document.querySelector('dialog').showModal());
    if (!docked) await expect.poll(async () => {
      const button = await feedback().boundingBox();
      return Math.max(Math.abs(button.x - floatingPosition.x), Math.abs(button.y - floatingPosition.y));
    }).toBeLessThan(1);
    await feedback().click();
    await page.getByRole('button', { name: 'Whole page', exact: true }).click();
    await page.getByPlaceholder('What should change here?').fill('Feedback on a modal');
    await exit().click();
    await page.getByRole('textbox', { name: 'App input' }).fill('Still interactive');
    await expect(page.locator('dialog')).toHaveAttribute('open', '');
    await page.evaluate(() => document.querySelector('dialog').close());
    if (docked) await assertDocked();
    // An app popover opened after feedback mode must not cover either control or panel.
    await feedback().click();
    await page.evaluate(() => document.querySelector('#popover').showPopover());
    await page.getByRole('button', { name: 'Whole page', exact: true }).click();
    await page.getByPlaceholder('What should change here?').fill('Feedback above a popover');
    await exit().click();
    await expect(page.locator('#popover')).toBeVisible();
    await page.evaluate(() => document.querySelector('#popover').hidePopover());
    // Opening a dialog during a draft preserves the editor and keeps it interactive.
    await feedback().click();
    await page.getByRole('button', { name: 'Whole page', exact: true }).click();
    await page.getByPlaceholder('What should change here?').fill('Draft before dialog');
    await page.evaluate(() => document.querySelector('dialog').showModal());
    await expect(page.getByPlaceholder('What should change here?')).toHaveValue('Draft before dialog');
    await page.getByPlaceholder('What should change here?').fill('Draft after dialog');
    await exit().click();
    await expect(page.locator('dialog')).toHaveAttribute('open', '');
    // Hiding the toggle must still allow feedback through its keyboard shortcut.
    settings = { position: { mode: 'hidden' } };
    await page.reload();
    await expect(page.locator('agent-feedback-pins-button')).toHaveCount(0);
    await page.keyboard.press('Alt+Shift+C');
    await page.getByRole('button', { name: 'Whole page', exact: true }).click();
    await page.getByPlaceholder('What should change here?').fill('Shortcut feedback');
  });
}
