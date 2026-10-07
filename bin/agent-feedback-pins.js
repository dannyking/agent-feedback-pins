#!/usr/bin/env node
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { cliActor, createHandler, DEFAULT_BASE, DEFAULT_DIR, FeedbackStore, scriptTag, wantsNotes } from "../src/index.js";

const HELP = `agent-feedback-pins: pinned UI feedback for AI agents to act on.

Usage:
  agent-feedback-pins serve [--port 4499] [--host 127.0.0.1]   standalone collector (any stack)
  agent-feedback-pins list [--all] [--json]                     open comments (or all)
  agent-feedback-pins done <n...>                               mark comments done
  agent-feedback-pins dismiss <n...>                            mark comments dismissed
  agent-feedback-pins reopen <n...>                             mark comments open again
  agent-feedback-pins plan <n...>                               mark comments planned
  agent-feedback-pins render                                    regenerate FEEDBACK.md

Options:
  --dir <path>   feedback folder (default ${DEFAULT_DIR})
  --note <text>  what you changed, or why you didn't; shown in the app's history.
                 Required for done and dismiss unless notes are turned off in settings
                 (one note per command, so resolve comments one at a time)
  --by <name>    who is changing the status, logged in each comment's history
                 (default: the coding agent, detected from AFP_AGENT, AI_AGENT or
                 CLAUDECODE, else your git identity)`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: "string", default: DEFAULT_DIR },
    port: { type: "string", default: "4499" },
    host: { type: "string", default: "127.0.0.1" },
    by: { type: "string" },
    note: { type: "string" },
    all: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});
const [cmd, ...args] = positionals;
const store = new FeedbackStore(values.dir);

function setStatus(status) {
  if (!args.length) throw new Error(`usage: agent-feedback-pins ${cmd} <n...>`);
  const resolving = status === "done" || status === "dismissed";
  if (resolving && values.note === undefined && wantsNotes(store.getSettings()))
    throw new Error(
      `Add a short note on what you changed (or why not), shown to the reviewer in the app:\n` +
        `  agent-feedback-pins ${cmd} ${args[0]} --note "..."\n` +
        `(Pass --note "" to skip; turn notes off in the app's settings.)`,
    );
  const by = values.by ? { name: values.by, agent: true } : cliActor();
  for (const n of args) {
    const item = store.update(n, { status, note: values.note }, by);
    console.log(item ? `#${item.number} ${status}` : `#${n} not found`);
  }
}

try {
  switch (cmd) {
    case "serve": {
      const handler = createHandler({ dir: values.dir, cors: true });
      const server = createServer((req, res) =>
        handler(req, res, () => {
          res.statusCode = 404;
          res.end("not found");
        }),
      );
      server.listen(Number(values.port), values.host, () => {
        const origin = `http://${values.host}:${values.port}`;
        console.log(`agent-feedback-pins collector on ${origin}${DEFAULT_BASE}`);
        console.log(`Saving to ${values.dir}/. Add this to your page (dev only):`);
        console.log(`  ${scriptTag({ src: `${origin}${DEFAULT_BASE}/client.js` })}`);
      });
      break;
    }
    case "list": {
      const items = store.list().filter((i) => values.all || i.status === "open" || i.status === "planned");
      if (values.json) console.log(JSON.stringify(items, null, 2));
      else if (!items.length) console.log("No open comments.");
      else
        for (const i of items)
          console.log(`#${i.number} [${i.status}] ${i.route} (${i.author?.name ?? "Unknown"}): ${i.comment.split("\n")[0]}`);
      break;
    }
    case "done":
    case "dismiss":
    case "reopen":
    case "plan":
      setStatus({ done: "done", dismiss: "dismissed", reopen: "open", plan: "planned" }[cmd]);
      break;
    case "render":
      store.render();
      console.log(`Wrote ${store.markdown}`);
      break;
    default:
      console.log(HELP);
      if (cmd && !values.help) process.exitCode = 1;
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
}
