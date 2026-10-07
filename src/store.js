import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Statuses a comment moves through. */
export const STATUSES = ["open", "planned", "done", "dismissed"];

/** Choices the settings modal offers; anything else is dropped (and the client default used). */
export const SETTINGS = {
  modes: ["light", "dark", "auto"],
  icons: ["chat", "pin", "pencil", "flag", "megaphone", "eye"],
  shows: ["both", "icon", "text"],
  positions: ["default", "floating", "custom", "hidden"],
  corners: ["bottom-left", "bottom-right", "top-left", "top-right"],
  places: ["before", "after", "inside"],
};

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
    this.settingsFile = join(dir, "settings.json");
  }

  /** The overlay's settings (theme, button, shortcut, pins), saved from its settings modal. */
  getSettings() {
    try {
      return cleanSettings(JSON.parse(readFileSync(this.settingsFile, "utf8")));
    } catch {
      return {};
    }
  }

  setSettings(input) {
    const settings = cleanSettings(input);
    this.ensureDir();
    writeFileSync(this.settingsFile, JSON.stringify(settings, null, 2) + "\n");
    if (existsSync(this.jsonl)) this.render(); // FEEDBACK.md says whether notes are wanted
    return settings;
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
   * {name, email?, agent?} (or just an email). Status changes are logged in item.history,
   * with patch.note (what was done, or why not) when given.
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
      const note = str(patch.note, 2000)?.trim();
      if (patch.status !== item.status || note) {
        item.history = [...(item.history ?? []), { status: patch.status, at: new Date().toISOString(), by: cleanActor(actor), ...(note ? { note } : {}) }];
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
    writeFileSync(this.markdown, renderMarkdown(items, this.getSettings()));
  }

  /** Rewrite FEEDBACK.md from feedback.jsonl (after hand edits or upgrades). */
  render() {
    this.save(this.list());
  }
}

export function cleanSettings(s) {
  const one = (v, list) => (list.includes(v) ? v : undefined);
  const { theme = {}, button = {}, position = {} } = s && typeof s === "object" ? s : {};
  // Round-trip through JSON to drop the unset (undefined) fields.
  return JSON.parse(
    JSON.stringify({
      theme: { accent: /^#[0-9a-f]{6}$/i.test(theme.accent) ? theme.accent : undefined, mode: one(theme.mode, SETTINGS.modes) },
      button: { label: str(button.label, 40), icon: one(button.icon, SETTINGS.icons), show: one(button.show, SETTINGS.shows) },
      position: {
        mode: one(position.mode, SETTINGS.positions),
        corner: one(position.corner, SETTINGS.corners),
        selector: str(position.selector, 1000),
        place: one(position.place, SETTINGS.places),
      },
      shortcut: str(s?.shortcut, 40),
      showPins: typeof s?.showPins === "boolean" ? s.showPins : undefined,
      name: str(s?.name, 120)?.trim() || undefined,
      askForNotes: typeof s?.askForNotes === "boolean" ? s.askForNotes : undefined,
      panel: {
        corner: one(s?.panel?.corner, SETTINGS.corners),
        collapsed: typeof s?.panel?.collapsed === "boolean" ? s.panel.collapsed : undefined,
      },
    }),
  );
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

/** Whether agents should explain each resolution (on unless turned off in settings). */
export const wantsNotes = (settings) => settings?.askForNotes !== false;

export function renderMarkdown(items, settings = {}) {
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
  if (wantsNotes(settings) && open.length) {
    lines.push(
      'When you resolve a comment, say what you changed (or why you didn\'t) in a short note: `npx agent-feedback-pins done 3 --note "Made the heading 32px"`. The reviewer sees it in the app.',
      "",
    );
  }
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
        const log = i.history.map((h) => `${h.status} by ${h.by?.name ?? "Unknown"} ${day(h.at)} UTC${h.note ? ` ("${oneLine(h.note)}")` : ""}`);
        lines.push(`- History: ${log.join("; ")}`);
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}
