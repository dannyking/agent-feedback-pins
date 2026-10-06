import type { IncomingMessage, ServerResponse } from "node:http";

export interface Author {
  name: string;
  email: string;
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
  update(idOrNumber: string, patch: { comment?: string; status?: string }, byEmail?: string): any;
  remove(idOrNumber: string, byEmail?: string): boolean;
  render(): void;
}
