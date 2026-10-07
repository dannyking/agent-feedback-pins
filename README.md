# Agent feedback pins

While you develop any web app, add a temporary Feedback button so you can pin comments to page
elements for your AI agents to act on. It's inspired by
[plannotator-tui](https://github.com/plannotator/plannotator-tui) and Claude's design mode. Your
comments are saved to a Markdown file in the project. Your agent picks them up and works through
them when you use the included skill, or when you ask it to resolve the in-app comments you left.
It's easy to remove when you're ready to ship.

## Install

Tell your coding agent (Claude Code, Codex, OpenCode, Pi or similar):

> Add https://github.com/dannyking/agent-feedback-pins to this project

It sets things up to fit your stack. Then click **Feedback** in your app, leave comments, and ask
your agent to "resolve my in-app comments". When you're ready to ship: "remove the feedback pins".
To have the skill available in every project, see [Install the skill](#install-the-skill).

- Click **Feedback** in the app, click anything, type what should change.
- Each comment is saved with the page, the element's selector, its nearest heading and text, its
  position, and who wrote it.
- Comments go to `.agent-feedback-pins/feedback.jsonl` (the source of truth) and
  `.agent-feedback-pins/FEEDBACK.md` (a readable version for people and agents).
- Pins stay on the page; you can edit or delete your own comments and mark any as done.
- **View all and resolved** in the Feedback panel lists every comment, open and resolved, with a
  log of who resolved each one and when (which agent, or which person). Mark a resolved comment
  unresolved to send it back; it shows up in `FEEDBACK.md` as reopened, with its history.
- **Alt+Shift+F** (⌥⇧F on a Mac) toggles Feedback mode from anywhere in the app.
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
  `dismiss`, `plan`, `reopen` and `render`. Status changes are logged in each comment's
  `history`, with the agent that made them: detected from `AFP_AGENT`, `AI_AGENT` or Claude
  Code's `CLAUDECODE`, or given with `--by "<agent name>"`; otherwise the git identity.
- `skill/SKILL.md`: an agent skill that installs it to fit the project's stack, processes the
  feedback, and removes it.

## Install the skill

The skill (`skill/SKILL.md`) lets your coding agent add this to a project in a way that fits its
stack, work through the feedback, and remove it before shipping. Clone the repo once, then link
the skill where your agent looks for skills:

```sh
git clone https://github.com/dannyking/agent-feedback-pins ~/projects/agent-feedback-pins

# Claude Code
ln -s ~/projects/agent-feedback-pins/skill ~/.claude/skills/agent-feedback-pins

# Codex, OpenCode and Pi all read the shared Agent Skills folder
mkdir -p ~/.agents/skills
ln -s ~/projects/agent-feedback-pins/skill ~/.agents/skills/agent-feedback-pins
```

OpenCode also reads `~/.claude/skills`, and has its own `~/.config/opencode/skills`; Pi has
`~/.pi/agent/skills`. Any of them works. Restart the agent, then ask it in any project to "add
agent feedback pins". Later: "look at my in-app feedback", or "remove the feedback pins".

## Install by hand

For a Vite app:

```sh
pnpm add -D github:dannyking/agent-feedback-pins
```

```js
// vite.config.js
import agentFeedbackPins from "agent-feedback-pins/vite";
export default { plugins: [agentFeedbackPins({ mountBefore: "#user-menu" })] };
```

Any other stack: run `npx github:dannyking/agent-feedback-pins serve` and add
`<script src="http://127.0.0.1:4499/__afp/client.js" defer></script>` to your dev layout.

## Script attributes

- `data-mount-before="<selector>"` docks the button just before an element (for example your
  header's user menu). `data-mount="<selector>"` appends it inside one. Otherwise it floats
  bottom-left. These are defaults: people can move the button from [Settings](#settings). Add `data-dock-only` to hide it while that element isn't on the page (for example
  on a sign-in screen).
- `data-endpoint` overrides where the API lives (default: the script's folder).
- `window.agentFeedbackPins = { headers: () => ({...}) }` adds headers to API calls, for apps that
  authenticate with bearer tokens.

## Settings

The gear in the Feedback panel opens settings, saved to `.agent-feedback-pins/settings.json`
(alongside the feedback, so they're per checkout):

- **Accent color** (presets or any color) and **light, dark or match system**. Left on "App
  theme", the overlay uses the `--afp-*` variables your agent mapped to the app's theme.
- **Button label and icon**, shown as icon and label, icon only, or label only.
- **Button position**: where the app put it (the script attributes), floating in a corner of
  your choice, or a spot you pick by clicking an element on the page (before, after or inside
  it). On pages without that element it floats.
- **Keyboard shortcut** that toggles Feedback mode: record your own, or turn it off. It needs
  Ctrl, Alt or ⌘ so it can't fire while you type.
- **Pins**: hide the numbered pins on the page (the panel still lists the comments).

## Comment authors

By default comments are attributed to the git identity of whoever runs the dev server. Apps with
their own logins can pass `author: (req) => ({ name, email })` to `createHandler` so each
comment records the signed-in person. Only a comment's author can edit or delete it; anyone can
mark it done.

## Develop

To work on agent-feedback-pins itself: there is no build step, so edit the files and run the
tests (store, HTTP API and HTML injection) with:

```sh
node --test test/*.test.js
```

## For AI agents

If a user asks you to add this repo to their project:

1. Read [`skill/SKILL.md`](skill/SKILL.md)
   (raw: https://raw.githubusercontent.com/dannyking/agent-feedback-pins/main/skill/SKILL.md)
   and follow its **Install** section. Look at the project's stack first and pick the matching
   integration; keep it dev-only and in as few places as possible.
2. Install the package as a dev dependency from GitHub
   (`pnpm add -D github:dannyking/agent-feedback-pins`, or the npm, yarn or bun equivalent). It
   isn't published to npm. Non-JavaScript projects run the standalone collector instead.
3. Check it works: start the dev server, leave a comment, and confirm it appears in
   `.agent-feedback-pins/FEEDBACK.md`.
4. Offer to install the skill for the user (see [Install the skill](#install-the-skill)) so you
   can process and remove the feedback later. Don't link it without asking.
5. Tell the user where the Feedback button is and how to ask you to process their comments.

When asked to process or remove the feedback, follow the matching section of `skill/SKILL.md`.

## License

MIT
