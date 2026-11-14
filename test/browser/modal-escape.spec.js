import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const client = readFileSync(new URL('../../client/agent-feedback-pins.js', import.meta.url), 'utf8');

test.beforeEach(async ({ page }) => {
  let settings = {};
  await page.route('https://raw.githubusercontent.com/**', route => route.fulfill({ json: { version: '0.2.2' } }));
  await page.route('http://afp.test/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/api/items')) return route.fulfill({ json: [] });
    if (path.endsWith('/api/me')) return route.fulfill({ json: { author: { name: 'Test' }, file: '.agent-feedback-pins/COMMENTS.md' } });
    if (path.endsWith('/api/settings')) {
      if (route.request().method() === 'PUT') settings = route.request().postDataJSON();
      return route.fulfill({ json: settings });
    }
    if (path.endsWith('/client.js')) return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: client });
    return route.fulfill({ contentType: 'text/html; charset=utf-8', body: `
      <dialog><h1>App settings</h1><input aria-label="App input" value="Saved value"></dialog>
      <script>
        window.appEscapes = 0;
        window.appCancels = 0;
        document.addEventListener('keydown', event => {
          if (event.key === 'Escape') window.appEscapes++;
        });
        document.querySelector('dialog').addEventListener('cancel', () => window.appCancels++);
      </script>
      <script src="/__afp/client.js"></script>` });
  });
  await page.goto('http://afp.test/');
  await page.evaluate(() => document.querySelector('dialog').showModal());
  await page.getByRole('textbox', { name: 'App input' }).fill('Unsaved app edits');
});

async function appEditsRemain(page) {
  await expect(page.locator('dialog')).toHaveAttribute('open', '');
  await expect(page.getByRole('textbox', { name: 'App input' })).toHaveValue('Unsaved app edits');
  expect(await page.evaluate(() => [window.appEscapes, window.appCancels])).toEqual([0, 0]);
}

test('Escape closes only the feedback editor, then mode, before ordinary app Escape resumes', async ({ page }) => {
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await page.getByRole('button', { name: 'Whole page', exact: true }).click();
  const draft = page.getByPlaceholder('What should change here?');
  await draft.fill('Fictional feedback draft');
  await draft.press('Escape');
  await expect(draft).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Whole page', exact: true })).toBeVisible();
  await appEditsRemain(page);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Whole page', exact: true })).toHaveCount(0);
  await appEditsRemain(page);

  await page.getByRole('textbox', { name: 'App input' }).press('Escape');
  await expect(page.locator('dialog')).not.toHaveAttribute('open', '');
  expect(await page.evaluate(() => [window.appEscapes, window.appCancels])).toEqual([1, 1]);
});

test('Escape cancels shortcut recording before closing Feedback settings', async ({ page }) => {
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  await expect(page.getByText('Press keys…', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByText('Press keys…', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change', exact: true })).toBeVisible();
  await appEditsRemain(page);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Change', exact: true })).toHaveCount(0);
  await appEditsRemain(page);
});

test('Escape cancels feedback position picking without canceling the app dialog', async ({ page }) => {
  await page.getByRole('button', { name: 'Feedback', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Pick a spot', exact: true }).click();
  const hint = page.getByText('Click where the button should go · Esc to cancel', { exact: true });
  await expect(hint).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(hint).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Change', exact: true })).toBeVisible();
  await appEditsRemain(page);
});
