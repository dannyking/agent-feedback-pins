import { createHandler, scriptTag } from "./handler.js";

/**
 * Vite plugin. Dev server only (apply: "serve"), so production builds never include it.
 *
 *   import agentFeedbackPins from "agent-feedback-pins/vite";
 *   plugins: [agentFeedbackPins({ mountBefore: "#user-menu" })]
 */
export default function agentFeedbackPins(options = {}) {
  return {
    name: "agent-feedback-pins",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(createHandler(options));
    },
    transformIndexHtml(html) {
      const tag = scriptTag(options);
      const i = html.lastIndexOf("</head>");
      return i === -1 ? html + tag : html.slice(0, i) + tag + html.slice(i);
    },
  };
}
