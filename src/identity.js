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
