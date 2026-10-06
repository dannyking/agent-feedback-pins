# Agent feedback pins

Leave pinned comments on any element of a web app while you develop it, then have your AI agent
work through them in one batch.

- Click **Feedback** in the app, click anything, type what should change.
- Each comment is saved with the page, the element's selector, its nearest heading and text, its
  position, and who wrote it.
- Comments go to `.agent-feedback-pins/feedback.jsonl` (the source of truth) and
  `.agent-feedback-pins/FEEDBACK.md` (a readable version for people and agents).
- Pins stay on the page; you can edit or delete your own comments and mark any as done.
- Tell your agent "look at my in-app feedback" and it plans, fixes and marks them done.

It is dev-only and built to be removed before shipping: one dev dependency and one
integration block.

## Pieces

- `client/agent-feedback-pins.js`: the overlay. No dependencies or build step, rendered in shadow
  DOM so it doesn't touch your styles. Themed with `--afp-*` CSS variables.
- `agent-feedback-pins` (Node): `createHandler()` serves the client and a small JSON API under
  `/__afp` as Connect-style middleware; `injectHtml()` adds the script tag.
- `agent-feedback-pins/vite`: a Vite plugin (dev server only).
- `bin/agent-feedback-pins.js`: a standalone collector for any stack, plus `list`, `done`,
  `dismiss`, `plan`, `reopen` and `render`.
- `skill/SKILL.md`: an agent skill that installs it to fit the project's stack, processes the
  feedback, and removes it.

## Quick start

With Claude Code, link the skill once:

```sh
ln -s ~/projects/agent-feedback-pins/skill ~/.claude/skills/agent-feedback-pins
```

Then in any project: "add agent feedback pins". Or by hand, for a Vite app:

```sh
pnpm add -D github:dannyking/agent-feedback-pins
```

```js
// vite.config.js
import agentFeedbackPins from "agent-feedback-pins/vite";
export default { plugins: [agentFeedbackPins({ mountBefore: "#user-menu" })] };
```

Any other stack: run `npx agent-feedback-pins serve` and add
`<script src="http://127.0.0.1:4499/__afp/client.js" defer></script>` to your dev layout.

## Script attributes

- `data-mount-before="<selector>"` docks the button just before an element (for example your
  header's user menu). `data-mount="<selector>"` appends it inside one. Otherwise it floats
  bottom-left. Add `data-dock-only` to hide it while that element isn't on the page (for example
  on a sign-in screen).
- `data-endpoint` overrides where the API lives (default: the script's folder).
- `window.agentFeedbackPins = { headers: () => ({...}) }` adds headers to API calls, for apps that
  authenticate with bearer tokens.

## Authors

By default comments are attributed to the git identity of whoever runs the dev server. Apps with
their own logins can pass `author: (req) => ({ name, email })` to `createHandler` so each
comment records the signed-in person. Only a comment's author can edit or delete it; anyone can
mark it done.

## Develop

```sh
node --test test/*.test.js
```
