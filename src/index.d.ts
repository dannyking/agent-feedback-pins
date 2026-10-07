import type { IncomingMessage, ServerResponse } from "node:http";

export interface Author {
  name: string;
  email: string;
}

/** Who changed a comment's status: a person, or a coding agent (agent: true). */
export interface Actor {
  name: string;
  email?: string;
  agent?: boolean;
}

export interface HistoryEntry {
  status: "open" | "planned" | "done" | "dismissed";
  /** ISO timestamp */
  at: string;
  by: Actor;
  /** What the agent changed, or why it didn't. */
  note?: string;
}

/** The overlay's settings, saved to settings.json. Unset fields use the defaults. */
export interface Settings {
  /** accent: a #rrggbb color; unset uses --afp-accent or the built-in magenta. mode: unset follows the --afp-* variables. */
  theme?: { accent?: string; mode?: "light" | "dark" | "auto" };
  button?: { label?: string; icon?: "chat" | "pin" | "pencil" | "flag" | "megaphone" | "eye"; show?: "both" | "icon" | "text" };
  /** default: where the script attributes dock it, else floating. custom: next to `selector`. hidden: shortcut only. */
  position?: {
    mode?: "default" | "floating" | "custom" | "hidden";
    corner?: "bottom-left" | "bottom-right" | "top-left" | "top-right";
    selector?: string;
    place?: "before" | "after" | "inside";
  };
  /** Toggles Feedback mode, e.g. "Alt+Shift+F" (the default). "" turns it off. */
  shortcut?: string;
  /** Numbered pins on the page in Feedback mode. Default true. */
  showPins?: boolean;
  /** Replaces the git name on new comments (ignored when the app supplies authors). */
  name?: string;
  /** Ask agents for a note on each resolution. Default true. */
  askForNotes?: boolean;
  /** Where the Feedback panel sits (default bottom-right), whether it's collapsed, and whether it lists all pages' comments (default) or this page's. */
  panel?: { corner?: "bottom-left" | "bottom-right" | "top-left" | "top-right"; collapsed?: boolean; scope?: "all" | "page" };
}

export interface HandlerOptions {
  /** Where feedback.jsonl, FEEDBACK.md and settings.json live. Default .agent-feedback-pins */
  dir?: string;
  /** URL prefix. Default /__afp */
  base?: string;
  /** The signed-in person, for apps with their own logins. Default: the git identity. */
  author?: (req: IncomingMessage) => Author | undefined | Promise<Author | undefined>;
  /** Allow cross-origin calls. */
  cors?: boolean;
}

export interface TagOptions {
  base?: string;
  src?: string;
  mountBefore?: string;
  mount?: string;
  dockOnly?: boolean;
  /** Raw HTML placed before the script tag (theme variables, page config). */
  head?: string;
}

export type Handler = ((req: IncomingMessage, res: ServerResponse, next?: () => void) => Promise<boolean>) & {
  store: FeedbackStore;
  base: string;
  dir: string;
};

export function createHandler(options?: HandlerOptions): Handler;
export function scriptTag(options?: TagOptions): string;
export function injectHtml(html: string, options?: TagOptions): string;
export function gitAuthor(cwd?: string): Author;
/** The coding agent running the CLI (from AFP_AGENT, AI_AGENT or CLAUDECODE), else the git identity. */
export function cliActor(env?: Record<string, string | undefined>): Actor;
/** The last time a comment was marked done or dismissed, if it was. */
export function lastResolution(item: { history?: HistoryEntry[] }): HistoryEntry | undefined;
export function renderMarkdown(items: unknown[], settings?: Settings): string;
export function wantsNotes(settings?: Settings): boolean;
export function cleanSettings(input: unknown): Settings;
export const STATUSES: readonly ["open", "planned", "done", "dismissed"];
export const DEFAULT_BASE: string;
export const DEFAULT_DIR: string;

export class FeedbackStore {
  constructor(dir: string);
  dir: string;
  jsonl: string;
  markdown: string;
  settingsFile: string;
  getSettings(): Settings;
  setSettings(input: unknown): Settings;
  list(): any[];
  add(input: unknown): any;
  /** `by` is who is acting; status changes are appended to the comment's `history`. */
  update(idOrNumber: string, patch: { comment?: string; status?: string; note?: string }, by?: Actor | string): any;
  remove(idOrNumber: string, byEmail?: string): boolean;
  render(): void;
}
