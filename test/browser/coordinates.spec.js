import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const client = readFileSync(new URL('../../client/agent-feedback-pins.js', import.meta.url), 'utf8');
const near = (actual, expected) => expect(Math.abs(actual - expected)).toBeLessThan(1);

for (const zoom of [1, 1.075, 1.625]) {
  for (const scope of ['html', 'body', 'nested']) {
    test(`${scope} zoom ${zoom}: highlight, saved pins, and editor`, async ({ page }) => {
      let items = [];
      await page.route('https://raw.githubusercontent.com/**', route => route.fulfill({ json: { version: '0.2.2' } }));
      await page.route('http://afp.test/**', async route => {
        const path = new URL(route.request().url()).pathname;
        if (path.endsWith('/api/items')) {
          if (route.request().method() === 'POST') {
            items.push({ ...route.request().postDataJSON(), id: '1', number: 1, status: 'open', author: { name: 'Test', email: 'test@example.com' } });
          }
          return route.fulfill({ json: route.request().method() === 'POST' ? items[0] : items });
        }
        if (path.endsWith('/api/me')) return route.fulfill({ json: { author: { name: 'Test', email: 'test@example.com' }, file: '.agent-feedback-pins/COMMENTS.md' } });
        if (path.endsWith('/api/settings')) return route.fulfill({ json: {} });
        if (path.endsWith('/client.js')) return route.fulfill({ contentType: 'text/javascript', body: client });
        return route.fulfill({ contentType: 'text/html', body: `
          <style>
            html { zoom: ${scope === 'html' ? zoom : scope === 'nested' ? 1.25 : 1}; }
            body { zoom: ${scope === 'body' ? zoom : scope === 'nested' ? zoom / 1.25 : 1}; margin: 24px; position: relative; min-height: 2500px; }
            #target { position: absolute; left: 180px; top: 240px; width: 220px; height: 100px; background: lightblue; }
          </style>
          <button id="target">Target</button>
          <script src="/__afp/client.js"></script>` });
      });
      await page.goto('http://afp.test/');
      await page.getByRole('button', { name: 'Feedback', exact: true }).click();
      const target = page.locator('#target');
      const highlight = page.locator('agent-feedback-pins .hl');
      const editor = page.locator('agent-feedback-pins .editor');
      const pin = page.locator('agent-feedback-pins .pin');
      const checkHighlight = async () => {
        await target.hover();
        await expect(highlight).toBeVisible();
        await expect.poll(async () => {
          const r = await target.boundingBox();
          const h = await highlight.boundingBox();
          return Math.max(Math.abs(h.x - (r.x - 2 * zoom)), Math.abs(h.y - (r.y - 2 * zoom)), Math.abs(h.width - (r.width + 4 * zoom)), Math.abs(h.height - (r.height + 4 * zoom)));
        }).toBeLessThan(1);
      };
      const checkPin = async () => {
        await expect(pin).toBeVisible();
        const r = await target.boundingBox();
        await expect.poll(async () => {
          const p = await pin.boundingBox();
          if (!p) return Infinity;
          return Math.max(Math.abs(p.x - (r.x + r.width - 12 * zoom)), Math.abs(p.y - (r.y - 10 * zoom)));
        }).toBeLessThan(1);
      };
      await checkHighlight();
      const r = await target.boundingBox();
      const at = { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      await page.mouse.click(at.x, at.y);
      await expect(editor).toBeVisible();
      const e = await editor.boundingBox();
      near(e.x, at.x + 12 * zoom);
      near(e.y, at.y + 12 * zoom);
      await editor.locator('textarea').fill('Coordinate regression');
      await editor.getByRole('button', { name: 'Save' }).click();
      await checkPin();
      // Reload to verify persisted coordinates and selector resolution.
      await page.reload();
      await page.getByRole('button', { name: 'Feedback', exact: true }).click();
      await checkPin();
      await page.evaluate(() => scrollTo(0, 180));
      await checkPin();
      await checkHighlight();
      await pin.click();
      await expect(editor).toBeVisible();
      const p = await pin.boundingBox();
      const edited = await editor.boundingBox();
      near(edited.x, p.x + p.width / 2 + 12 * zoom);
      near(edited.y, p.y + p.height / 2 + 12 * zoom);
      await page.keyboard.press('Escape');
      // A missing selector uses the stored document position in viewport space.
      await target.evaluate(el => el.remove());
      await page.evaluate(() => dispatchEvent(new Event('resize')));
      const fallback = await pin.boundingBox();
      near(fallback.x, items[0].element.rect.x + items[0].element.rect.width - 12 * zoom);
      near(fallback.y, items[0].element.rect.y - 180 - 10 * zoom);
      // Near the viewport edge, the editor remains inside the viewport.
      await page.locator('agent-feedback-pins .panel').evaluate(el => el.style.display = 'none');
      await page.mouse.click(1550, 900);
      await expect(editor).toBeVisible();
      const edge = await editor.boundingBox();
      expect(edge.x + edge.width).toBeLessThanOrEqual(1600);
      expect(edge.y).toBeLessThan(900);
    });
  }
}
