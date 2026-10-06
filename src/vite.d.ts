import type { HandlerOptions, TagOptions } from "./index.js";
export default function agentFeedbackPins(options?: HandlerOptions & TagOptions): {
  name: string;
  apply: "serve";
  [key: string]: unknown;
};
