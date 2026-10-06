#!/usr/bin/env node
import { createServer } from "node:http";
import { parseArgs } from "node:util";
import { createHandler, DEFAULT_BASE, DEFAULT_DIR, FeedbackStore, scriptTag } from "../src/index.js";

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
  --dir <path>   feedback folder (default ${DEFAULT_DIR})`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: "string", default: DEFAULT_DIR },
    port: { type: "string", default: "4499" },
    host: { type: "string", default: "127.0.0.1" },
    all: { type: "boolean", default: false },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});
const [cmd, ...args] = positionals;
const store = new FeedbackStore(values.dir);

function setStatus(status) {
  if (!args.length) throw new Error(`usage: agent-feedback-pins ${cmd} <n...>`);
  for (const n of args) {
    const item = store.update(n, { status });
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
