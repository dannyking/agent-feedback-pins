import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gitAuthor } from "./identity.js";
import { FeedbackStore } from "./store.js";

const CLIENT = join(dirname(fileURLToPath(import.meta.url)), "../client/agent-feedback-pins.js");
export const DEFAULT_DIR = ".agent-feedback-pins";
export const DEFAULT_BASE = "/__afp";

/**
 * A Connect-style middleware, (req, res, next), that serves the client and the feedback API
 * under `base`. Works with plain node:http, Connect, Express and Vite; anything else can call
 * it with raw Node request and response objects (it returns true when it handled the request).
 *
 * Options:
 *   dir     where feedback.jsonl and FEEDBACK.md live (default .agent-feedback-pins)
 *   base    URL prefix (default /__afp)
 *   author  (req) => {name, email} | undefined, for apps with their own logins.
 *           Default: the git identity of whoever runs the server.
 *   cors    true to allow cross-origin calls (the standalone server uses this)
 */
export function createHandler(options = {}) {
  const dir = resolve(options.dir ?? DEFAULT_DIR);
  const base = (options.base ?? DEFAULT_BASE).replace(/\/$/, "");
  const store = new FeedbackStore(dir);
  const shown = relative(process.cwd(), join(dir, "FEEDBACK.md")) || "FEEDBACK.md";
  const authorOf = async (req) => (options.author ? await options.author(req) : undefined) ?? gitAuthor();

  async function handle(req, res, next) {
    const url = new URL(req.url ?? "/", "http://x");
    if (url.pathname !== base && !url.pathname.startsWith(`${base}/`)) {
      if (next) next();
      return false;
    }
    const path = url.pathname.slice(base.length);
    const send = (status, body, type = "application/json; charset=utf-8") => {
      res.statusCode = status;
      res.setHeader("content-type", type);
      res.setHeader("cache-control", "no-store");
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    if (options.cors) {
      res.setHeader("access-control-allow-origin", req.headers.origin ?? "*");
      res.setHeader("access-control-allow-methods", "GET, POST, PATCH, DELETE, OPTIONS");
      res.setHeader("access-control-allow-headers", "content-type, authorization");
      if (req.method === "OPTIONS") return send(204, ""), true;
    }
    try {
      if (path === "/client.js" && req.method === "GET") {
        send(200, readFileSync(CLIENT, "utf8"), "text/javascript; charset=utf-8");
      } else if (path === "/api/me" && req.method === "GET") {
        send(200, { author: await authorOf(req), file: shown });
      } else if (path === "/api/items" && req.method === "GET") {
        send(200, store.list());
      } else if (path === "/api/items" && req.method === "POST") {
        const body = await readJson(req);
        send(200, store.add({ ...body, author: await authorOf(req) }));
      } else if (path.startsWith("/api/items/") && (req.method === "PATCH" || req.method === "DELETE")) {
        const id = decodeURIComponent(path.slice("/api/items/".length));
        const who = (await authorOf(req)).email;
        if (req.method === "PATCH") {
          const item = store.update(id, await readJson(req), who);
          item ? send(200, item) : send(404, { error: "not found" });
        } else {
          store.remove(id, who) ? send(200, { ok: true }) : send(404, { error: "not found" });
        }
      } else {
        send(404, { error: "not found" });
      }
    } catch (e) {
      send(e.status ?? 500, { error: e.message });
    }
    return true;
  }

  return Object.assign(handle, { store, base, dir });
}

async function readJson(req) {
  if (req.body !== undefined && typeof req.body === "object") return req.body; // already parsed
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 256 * 1024) throw Object.assign(new Error("body too large"), { status: 413 });
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("invalid JSON"), { status: 400 });
  }
}

const escapeAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * The <script> tag that loads the client. Options: base or src, mountBefore, mount, dockOnly, and
 * head (raw HTML to put before it, e.g. a <style> mapping --afp-* colors to the app's theme).
 */
export function scriptTag(options = {}) {
  const src = options.src ?? `${(options.base ?? DEFAULT_BASE).replace(/\/$/, "")}/client.js`;
  const attrs = [
    `src="${escapeAttr(src)}"`,
    options.mountBefore && `data-mount-before="${escapeAttr(options.mountBefore)}"`,
    options.mount && `data-mount="${escapeAttr(options.mount)}"`,
    options.dockOnly && "data-dock-only",
    "data-agent-feedback-pins",
    "defer",
  ].filter(Boolean);
  return `${options.head ?? ""}<script ${attrs.join(" ")}></script>`;
}

/** Add the client to an HTML document (before </head>, else </body>, else at the end). */
export function injectHtml(html, options = {}) {
  const tag = scriptTag(options);
  if (html.includes("data-agent-feedback-pins")) return html;
  for (const close of ["</head>", "</body>"]) {
    const i = html.lastIndexOf(close);
    if (i !== -1) return html.slice(0, i) + tag + html.slice(i);
  }
  return html + tag;
}
