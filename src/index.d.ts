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
}

export interface HandlerOptions {
  /** Where feedback.jsonl and FEEDBACK.md live. Default .agent-feedback-pins */
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
export function renderMarkdown(items: unknown[]): string;
export const STATUSES: readonly ["open", "planned", "done", "dismissed"];
export const DEFAULT_BASE: string;
export const DEFAULT_DIR: string;

export class FeedbackStore {
  constructor(dir: string);
  dir: string;
  jsonl: string;
  markdown: string;
  list(): any[];
  add(input: unknown): any;
  /** `by` is who is acting; status changes are appended to the comment's `history`. */
  update(idOrNumber: string, patch: { comment?: string; status?: string }, by?: Actor | string): any;
  remove(idOrNumber: string, byEmail?: string): boolean;
  render(): void;
}
