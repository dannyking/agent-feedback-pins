import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createHandler, FeedbackStore, injectHtml } from "../src/index.js";

const tmp = () => mkdtempSync(join(tmpdir(), "afp-"));
const jo = { name: "Jo Doe", email: "jo@example.com" };

test("store adds, renders, edits and enforces authorship", () => {
  const s = new FeedbackStore(tmp());
  const a = s.add({
    comment: "Make this bigger\nand bolder",
    route: "/settings",
    pageTitle: "Settings",
    element: { selector: "main > h1", tag: "h1", text: "Settings", section: "Settings", rect: { x: 1, y: 2, width: 30, height: 40 } },
    viewport: { width: 1280, height: 800 },
    author: jo,
  });
  const b = s.add({ comment: "Whole page note", route: "/", element: null, author: { name: "Sam", email: "sam@example.com" } });
  assert.equal(a.number, 1);
  assert.equal(b.number, 2);
  const md = readFileSync(s.markdown, "utf8");
  assert.match(md, /### #1 \(Jo Doe\): Make this bigger/);
  assert.match(md, /- Element: <h1> "Settings"/);
  assert.match(md, /- Position: 1,2 size 30x40 in a 1280x800 viewport/);
  assert.match(md, /by Jo Doe <jo@example.com>/);
  assert.match(md, /- Whole page/);
  assert.throws(() => s.update(a.id, { comment: "x" }, "sam@example.com"), /only the author/);
  assert.equal(s.update(a.id, { comment: "Bigger" }, "JO@example.com").comment, "Bigger");
  assert.equal(s.update("2", { status: "done" }).status, "done");
  assert.throws(() => s.remove(a.id, "sam@example.com"), /only the author/);
  assert.ok(s.remove(a.id, "jo@example.com"));
  assert.match(readFileSync(s.markdown, "utf8"), /0 open, 1 done, 0 dismissed/);
});

test("handler serves the client and the API", async () => {
  const handler = createHandler({ dir: tmp(), author: (req) => (req.headers["x-user"] === "jo" ? jo : undefined) });
  const server = createServer((req, res) => handler(req, res, () => res.end("app")));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    assert.equal(await (await fetch(`${base}/other`)).text(), "app");
    const js = await fetch(`${base}/__afp/client.js`);
    assert.match(js.headers.get("content-type"), /javascript/);
    const me = await (await fetch(`${base}/__afp/api/me`, { headers: { "x-user": "jo" } })).json();
    assert.deepEqual(me.author, jo);
    const post = (body) =>
      fetch(`${base}/__afp/api/items`, { method: "POST", headers: { "content-type": "application/json", "x-user": "jo" }, body: JSON.stringify(body) });
    assert.equal((await post({ comment: "" })).status, 400);
    const item = await (await post({ comment: "Hi", route: "/" })).json();
    assert.deepEqual(item.author, jo);
    const anon = await fetch(`${base}/__afp/api/items/${item.id}`, { method: "DELETE" });
    assert.equal(anon.status, 403); // falls back to the git identity, not Jo
    const del = await fetch(`${base}/__afp/api/items/${item.id}`, { method: "DELETE", headers: { "x-user": "jo" } });
    assert.equal(del.status, 200);
    assert.deepEqual(await (await fetch(`${base}/__afp/api/items`)).json(), []);
  } finally {
    server.close();
  }
});

test("injectHtml adds the script once", () => {
  const html = "<html><head></head><body></body></html>";
  const once = injectHtml(html, { mountBefore: "#menu" });
  assert.match(once, /<script src="\/__afp\/client.js" data-mount-before="#menu" data-agent-feedback-pins defer><\/script><\/head>/);
  assert.equal(injectHtml(once), once);
});
