import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Statuses a comment moves through. */
export const STATUSES = ["open", "planned", "done", "dismissed"];

const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : undefined);

function cleanElement(e) {
  if (!e || typeof e !== "object") return null;
  const r = e.rect ?? {};
  return {
    selector: str(e.selector, 1000) ?? "",
    tag: str(e.tag, 40) ?? "",
    text: str(e.text, 300),
    label: str(e.label, 300),
    section: str(e.section, 300),
    rect: { x: +r.x || 0, y: +r.y || 0, width: +r.width || 0, height: +r.height || 0 },
  };
}

function cleanAuthor(a) {
  const name = str(a?.name, 120)?.trim();
  const email = str(a?.email, 200)?.trim().toLowerCase();
  if (!name && !email) return { name: "Unknown", email: "" };
  return { name: name || email, email: email || "" };
}

/**
 * The feedback store: feedback.jsonl (one JSON comment per line, the source of truth) plus
 * FEEDBACK.md, a readable rendering regenerated on every change for people and agents.
 */
export class FeedbackStore {
  constructor(dir) {
    this.dir = dir;
    this.jsonl = join(dir, "feedback.jsonl");
    this.markdown = join(dir, "FEEDBACK.md");
  }

  ensureDir() {
    mkdirSync(this.dir, { recursive: true });
  }

  list() {
    try {
      return readFileSync(this.jsonl, "utf8")
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  }

  add(input) {
    const comment = str(input?.comment, 4000)?.trim();
    if (!comment) throw httpError(400, "comment is required");
    const all = this.list();
    const now = new Date().toISOString();
    const item = {
      id: randomUUID(),
      number: Math.max(0, ...all.map((f) => f.number || 0)) + 1,
      comment,
      route: str(input.route, 500) ?? "/",
      url: str(input.url, 2000),
      pageTitle: str(input.pageTitle, 300),
      element: cleanElement(input.element),
      viewport: input.viewport ? { width: +input.viewport.width || 0, height: +input.viewport.height || 0 } : undefined,
      author: cleanAuthor(input.author),
      status: "open",
      createdAt: now,
      updatedAt: now,
    };
    this.save([...all, item]);
    return item;
  }

  /**
   * Change status (anyone) or wording (author only, matched by email). `by` is who is acting:
   * {name, email?, agent?} (or just an email). Status changes are logged in item.history.
   */
  update(idOrNumber, patch, by) {
    const actor = typeof by === "string" ? { name: by, email: by } : by;
    const all = this.list();
    const item = all.find((f) => f.id === idOrNumber || String(f.number) === String(idOrNumber));
    if (!item) return undefined;
    if (patch.comment !== undefined) {
      if (!sameAuthor(item, actor?.email)) throw httpError(403, "only the author can edit this comment");
      const c = str(patch.comment, 4000)?.trim();
      if (!c) throw httpError(400, "comment is required");
      item.comment = c;
    }
    if (patch.status !== undefined) {
      if (!STATUSES.includes(patch.status)) throw httpError(400, `status must be one of ${STATUSES.join(", ")}`);
      if (patch.status !== item.status) {
        item.history = [...(item.history ?? []), { status: patch.status, at: new Date().toISOString(), by: cleanActor(actor) }];
      }
      item.status = patch.status;
    }
    item.updatedAt = new Date().toISOString();
    this.save(all);
    return item;
  }

  remove(idOrNumber, byEmail) {
    const all = this.list();
    const item = all.find((f) => f.id === idOrNumber || String(f.number) === String(idOrNumber));
    if (!item) return false;
    if (!sameAuthor(item, byEmail)) throw httpError(403, "only the author can delete this comment");
    this.save(all.filter((f) => f !== item));
    return true;
  }

  save(items) {
    this.ensureDir();
    const tmp = `${this.jsonl}.tmp`;
    writeFileSync(tmp, items.map((i) => JSON.stringify(i)).join("\n") + (items.length ? "\n" : ""));
    renameSync(tmp, this.jsonl);
    writeFileSync(this.markdown, renderMarkdown(items));
  }

  /** Rewrite FEEDBACK.md from feedback.jsonl (after hand edits or upgrades). */
  render() {
    this.save(this.list());
  }
}

function cleanActor(a) {
  const name = str(a?.name, 120)?.trim();
  const email = str(a?.email, 200)?.trim().toLowerCase();
  return { name: name || email || "Unknown", ...(email ? { email } : {}), ...(a?.agent ? { agent: true } : {}) };
}

/** The last time this comment was marked done or dismissed, if it was. */
export function lastResolution(item) {
  return (item.history ?? []).findLast((h) => h.status === "done" || h.status === "dismissed");
}

const day = (iso) => String(iso).slice(0, 16).replace("T", " ");

function sameAuthor(item, byEmail) {
  const a = (item.author?.email || "").toLowerCase();
  return !a || a === String(byEmail || "").toLowerCase();
}

export function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

const oneLine = (s) => s.replace(/\s+/g, " ").trim();

export function renderMarkdown(items) {
  const open = items.filter((i) => i.status === "open" || i.status === "planned");
  const byRoute = new Map();
  for (const i of open) byRoute.set(i.route, [...(byRoute.get(i.route) ?? []), i]);
  const authors = [...new Set(open.map((i) => i.author?.name).filter(Boolean))];
  const count = (s) => items.filter((i) => i.status === s).length;
  const lines = [
    "# UI feedback",
    "",
    `Generated ${new Date().toISOString()} from feedback.jsonl (the source of truth) by agent-feedback-pins.`,
    `${open.length} open, ${count("done")} done, ${count("dismissed")} dismissed.${authors.length ? ` From: ${authors.join(", ")}.` : ""}`,
    "",
  ];
  for (const [route, list] of byRoute) {
    lines.push(`## ${route}${list[0]?.pageTitle ? ` (${list[0].pageTitle})` : ""}`, "");
    for (const i of list) {
      const first = i.comment.split("\n")[0];
      const resolved = lastResolution(i);
      const tag = i.status === "planned" ? " (planned)" : resolved ? " (reopened)" : "";
      lines.push(`### #${i.number}${tag} (${i.author?.name ?? "Unknown"}): ${first}`);
      if (i.comment.includes("\n")) lines.push("", i.comment);
      lines.push("");
      const e = i.element;
      if (e) {
        if (e.section) lines.push(`- Section: ${e.section}`);
        if (e.label || e.text) lines.push(`- Element: <${e.tag}> "${oneLine(e.label || e.text || "").slice(0, 160)}"`);
        lines.push(`- Selector: \`${e.selector}\``);
        lines.push(
          `- Position: ${Math.round(e.rect.x)},${Math.round(e.rect.y)} size ${Math.round(e.rect.width)}x${Math.round(e.rect.height)}${i.viewport ? ` in a ${i.viewport.width}x${i.viewport.height} viewport` : ""}`,
        );
      } else {
        lines.push("- Whole page");
      }
      const who = i.author?.email ? `${i.author.name} <${i.author.email}>` : (i.author?.name ?? "Unknown");
      lines.push(`- Left ${day(i.createdAt)} UTC by ${who}`);
      if (resolved) {
        // A reopened comment: the earlier fix didn't satisfy the reviewer.
        const log = i.history.map((h) => `${h.status} by ${h.by?.name ?? "Unknown"} ${day(h.at)} UTC`);
        lines.push(`- History: ${log.join("; ")}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}
