import { execFileSync } from "node:child_process";
import { userInfo } from "node:os";

let cached;

/** The person running the dev server: their git identity, else their OS username. */
export function gitAuthor(cwd = process.cwd()) {
  if (cached) return cached;
  const git = (key) => {
    try {
      return execFileSync("git", ["config", key], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return "";
    }
  };
  const name = git("user.name");
  const email = git("user.email");
  let fallback = "Unknown";
  try {
    fallback = userInfo().username;
  } catch {
    // No user database entry (some containers).
  }
  cached = { name: name || email || fallback, email };
  return cached;
}

const AGENTS = { "claude-code": "Claude Code", codex: "Codex", opencode: "OpenCode", pi: "Pi", cursor: "Cursor", "gemini-cli": "Gemini CLI" };

/**
 * Who is running the CLI, for the history of a comment: the coding agent if we can tell (from
 * AFP_AGENT, the AI_AGENT convention or Claude Code's CLAUDECODE), else the git identity.
 */
export function cliActor(env = process.env) {
  const raw = env.AFP_AGENT || env.AI_AGENT?.split("_")[0] || (env.CLAUDECODE ? "claude-code" : "");
  if (raw) return { name: AGENTS[raw.toLowerCase()] ?? raw, agent: true };
  return gitAuthor();
}
