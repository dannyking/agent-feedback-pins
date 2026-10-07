/*
 * agent-feedback-pins client: a dev-only overlay for leaving pinned comments on any element.
 * No dependencies and no build step. Everything renders in shadow DOM, so it neither
 * inherits nor leaks the host app's styles; colors come from --afp-* custom properties.
 *
 * Load it with <script src="/__afp/client.js" defer></script>. Optional attributes:
 *   data-endpoint="/__afp"          where the collector lives (default: the script's folder)
 *   data-mount-before="<selector>"  dock the toggle button just before this element
 *   data-mount="<selector>"         or append it inside this element
 *   data-dock-only                  hide the button while that element isn't on the page
 * With neither, the button floats bottom-left. People can override all of this (and the theme,
 * button label and icon, keyboard shortcut and pins) from the settings modal; those choices are
 * saved to settings.json beside the feedback.
 *
 * Optional page config, set before the script runs:
 *   window.agentFeedbackPins = { headers: () => ({ authorization: "Bearer ..." }) }
 */
(() => {
  if (window.__agentFeedbackPins) return;
  window.__agentFeedbackPins = true;

  const script = document.currentScript;
  const attr = (n) => script?.getAttribute(n) || undefined;
  const endpoint = (
    attr("data-endpoint") ?? (script?.src ? new URL(".", script.src).href : "/__afp/")
  ).replace(/\/$/, "");
  const config = window.agentFeedbackPins ?? {};
  const UI_TAGS = "agent-feedback-pins, agent-feedback-pins-button";

  // ---------- Talking to the collector ----------

  async function call(path, method = "GET", body) {
    const headers = { ...(config.headers?.() ?? {}) };
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(endpoint + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  }

  const state = {
    active: false,
    items: [],
    me: { author: { name: "", email: "" }, file: ".agent-feedback-pins/FEEDBACK.md" },
    draft: null, // { element, at: {x, y}, editing? }
    panelEditing: null, // id of the panel comment being edited inline
    modal: null, // "history" or "settings" while a modal is open
    historyFilter: "all", // all | open | resolved
    settings: {}, // as saved; prefs() fills in the defaults
    picking: false, // choosing a spot for the button
    recording: false, // recording a new keyboard shortcut
  };

  const DEFAULTS = {
    theme: { accent: "", mode: "" }, // "" follows the --afp-* variables
    button: { label: "Feedback", icon: "chat", show: "both" },
    position: { mode: "default", corner: "bottom-left", selector: "", place: "before" },
    shortcut: "Alt+Shift+F",
    showPins: true,
    name: "", // "" keeps the git name
    askForNotes: true,
    panel: { corner: "bottom-right", collapsed: false, scope: "all" }, // scope: all | page
  };

  function prefs() {
    const s = state.settings;
    return {
      theme: { ...DEFAULTS.theme, ...s.theme },
      button: { ...DEFAULTS.button, ...s.button },
      position: { ...DEFAULTS.position, ...s.position },
      shortcut: s.shortcut ?? DEFAULTS.shortcut,
      showPins: s.showPins ?? DEFAULTS.showPins,
      name: s.name ?? DEFAULTS.name,
      askForNotes: s.askForNotes ?? DEFAULTS.askForNotes,
      panel: { ...DEFAULTS.panel, ...s.panel },
    };
  }

  async function reload() {
    try {
      state.items = await call("/api/items");
    } catch {
      // Feedback is best-effort; never break the app over it.
    }
    renderButton();
    if (state.active) renderPanel();
    if (state.modal) renderModal();
  }

  // ---------- Describing the clicked element ----------

  const clean = (s, n = 160) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, n) || undefined;

  function cssPath(el) {
    const parts = [];
    let node = el;
    while (node && node !== document.body && parts.length < 12) {
      if (node.id) {
        parts.unshift(`#${CSS.escape(node.id)}`);
        break;
      }
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.tagName === node.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = parent;
    }
    return parts.join(" > ");
  }

  /** The nearest heading that introduces this element: the section a reader would name. */
  function sectionOf(el) {
    let node = el;
    while (node && node !== document.body) {
      if (/^H[1-4]$/.test(node.tagName)) return clean(node.textContent, 120);
      const heading = node.querySelector(
        ":scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > div > h1, :scope > div > h2, :scope > div > h3",
      );
      if (heading) return clean(heading.textContent, 120);
      node = node.parentElement;
    }
    return pageTitle();
  }

  function pageTitle() {
    return clean((document.querySelector("main h1") ?? document.querySelector("h1"))?.textContent, 120);
  }

  function describe(el) {
    const r = el.getBoundingClientRect();
    return {
      selector: cssPath(el),
      tag: el.tagName.toLowerCase(),
      text: clean(el.innerText, 200),
      label: clean(
        el.getAttribute("aria-label") ??
          el.getAttribute("title") ??
          el.getAttribute("alt") ??
          el.getAttribute("placeholder"),
      ),
      section: sectionOf(el),
      rect: { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height },
    };
  }

  // ---------- Tiny DOM helpers ----------

  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on")) el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === "style") Object.assign(el.style, v);
      else if (k === "className") el.className = v;
      else if (k in el && (typeof v !== "string" || k === "value")) el[k] = v;
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c);
    return el;
  }

  const isOpen = (i) => i.status === "open" || i.status === "planned";
  const lastResolution = (i) => (i.history ?? []).findLast((x) => x.status === "done" || x.status === "dismissed");
  const ago = (iso) => {
    const s = (Date.parse(iso) - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
    for (const [unit, n] of [["year", 31536000], ["month", 2592000], ["day", 86400], ["hour", 3600], ["minute", 60]])
      if (Math.abs(s) >= n) return rtf.format(Math.round(s / n), unit);
    return "just now";
  };
  const when = (iso) => h("time", { dateTime: iso, title: new Date(iso).toLocaleString() }, ago(iso));
  const mine = (i) =>
    !i.author?.email || i.author.email.toLowerCase() === (state.me.author.email || "").toLowerCase();
  const initials = (name) =>
    (name || "?")
      .split(/\s+/)
      .map((p) => p[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();

  // ---------- Styles ----------

  const mix = (v, pct) => `color-mix(in srgb, var(${v}) ${pct}%, transparent)`;
  const VARS = `
    :host {
      --a: var(--afp-accent, #d303be);
      --at: var(--afp-accent-text, #a1028f);
      --oa: var(--afp-on-accent, #ffffff);
      --p: var(--afp-panel, #ffffff);
      --p2: var(--afp-panel-2, #f5f5fe);
      --in: var(--afp-input, #f7f7f8);
      --l: var(--afp-line, #e0e0e4);
      --fg: var(--afp-fg, #141418);
      --mu: var(--afp-muted, #4f5062);
      --di: var(--afp-dim, #828395);
      --bad: var(--afp-danger, #e22c10);
      --av: var(--afp-avatar, #5b4dfc);
      --avt: var(--afp-avatar-text, #4a3ed0);
      font-family: var(--afp-font, inherit);
    }
    * { box-sizing: border-box; }
    button { font: inherit; color: inherit; background: none; border: 0; padding: 0; cursor: pointer; }
    button:disabled { opacity: .5; cursor: default; }
  `;

  const BUTTON_CSS = `${VARS}
    :host { display: inline-flex; }
    :host([data-floating]) { position: fixed; left: 16px; bottom: 16px; z-index: 2147483000; }
    :host([data-floating*="right"]) { left: auto; right: 16px; }
    :host([data-floating^="top"]) { bottom: auto; top: 16px; }
    :host([data-floating]) .t { background: var(--p); box-shadow: 0 4px 16px rgb(0 0 0 / .15); }
    :host([data-themed]) .t { background: var(--p); }
    .t { display: flex; align-items: center; gap: 8px; border-radius: 999px; border: 1px solid var(--l);
      padding: 6px 12px; font-size: 12px; line-height: 16px; font-weight: 600; color: var(--mu);
      transition: color .15s, background-color .15s, border-color .15s; }
    .t:hover { color: var(--fg); }
    .t[aria-pressed="true"] { border-color: ${mix("--a", 70)}; background: ${mix("--a", 15)}; color: var(--at); }
    .badge { border-radius: 999px; background: ${mix("--a", 25)}; padding: 0 6px; font-size: 10px;
      line-height: 15px; font-weight: 700; color: var(--at); }
    @media (max-width: 639px) { .label { display: none; } }
  `;

  const OVERLAY_CSS = `${VARS}
    :host { position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 2147483000; font-size: 14px;
      line-height: 1.43; color: var(--fg); text-align: left; }
    .hl { pointer-events: none; position: fixed; border: 2px solid var(--a); border-radius: 6px;
      background: ${mix("--a", 10)}; transition: all 75ms; }
    .pin { position: absolute; display: flex; align-items: center; justify-content: center; height: 24px;
      min-width: 24px; padding: 0 4px; border-radius: 999px; border: 2px solid #fff; background: var(--a);
      color: var(--oa); font-size: 11px; font-weight: 900; box-shadow: 0 10px 15px -3px rgb(0 0 0 / .25); }
    .card { position: fixed; border-radius: 16px; background: var(--p); padding: 16px;
      box-shadow: 0 25px 50px -12px rgb(0 0 0 / .35); }
    .editor { width: 340px; border: 1px solid ${mix("--a", 60)}; }
    .panel { right: 16px; bottom: 16px; width: 340px; border: 1px solid ${mix("--a", 50)};
      background: color-mix(in srgb, var(--p) 95%, transparent); backdrop-filter: blur(8px); }
    .eyebrow { margin-bottom: 8px; font-size: 11px; font-weight: 700; text-transform: uppercase;
      letter-spacing: .05em; color: var(--at); }
    .target { margin-bottom: 8px; font-size: 12px; color: var(--mu); display: -webkit-box;
      -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    textarea { display: block; width: 100%; resize: vertical; border-radius: 8px; border: 1px solid var(--l);
      background: ${mix("--in", 60)}; padding: 8px; font: inherit; font-size: 14px; color: var(--fg); outline: none; }
    textarea:focus { border-color: var(--a); }
    textarea.sm { padding: 6px; font-size: 12px; border-radius: 6px; }
    .row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .links { display: flex; gap: 12px; font-size: 12px; }
    .danger { color: var(--bad); }
    .danger:hover, .link:hover { text-decoration: underline; }
    .quiet { color: var(--mu); }
    .quiet:hover { color: var(--fg); }
    .ghost { border-radius: 8px; padding: 6px 12px; font-size: 12px; color: var(--mu); }
    .ghost:hover { color: var(--fg); }
    .save { border-radius: 8px; background: var(--a); padding: 6px 12px; font-size: 12px; font-weight: 700; color: var(--oa); }
    .kbd { opacity: .6; }
    .err { margin-top: 4px; font-size: 12px; color: var(--bad); }
    .title { font-weight: 700; color: var(--at); }
    .hint { margin: 4px 0 0; font-size: 12px; color: var(--mu); }
    .whole { margin-top: 12px; width: 100%; border-radius: 8px; border: 1px solid var(--l); padding: 6px 12px;
      font-size: 12px; font-weight: 600; color: var(--mu); }
    .whole:hover { color: var(--fg); }
    ul { list-style: none; margin: 12px 0 0; padding: 0 4px 0 0; max-height: 224px; overflow-y: auto;
      display: flex; flex-direction: column; gap: 8px; }
    li { display: flex; gap: 8px; border-radius: 8px; background: ${mix("--p2", 70)}; padding: 8px; }
    .num { margin-top: 2px; display: flex; height: 20px; min-width: 20px; align-items: center; justify-content: center;
      border-radius: 999px; background: var(--a); padding: 0 4px; font-size: 10px; font-weight: 900; color: var(--oa); }
    .body { min-width: 0; flex: 1; }
    .text { white-space: pre-wrap; font-size: 12px; color: color-mix(in srgb, var(--fg) 90%, transparent); }
    .meta { margin-top: 2px; display: flex; flex-wrap: wrap; align-items: center; column-gap: 8px; font-size: 10px; color: var(--di); }
    .meta .link { font-weight: 600; color: var(--at); }
    .meta .danger { font-weight: 600; }
    .inline-actions { margin-top: 4px; display: flex; justify-content: flex-end; gap: 8px; font-size: 11px; }
    .inline-actions .link { font-weight: 700; color: var(--at); }
    .av { display: flex; height: 20px; width: 20px; flex-shrink: 0; align-items: center; justify-content: center;
      border-radius: 999px; background: ${mix("--av", 30)}; font-size: 9px; font-weight: 700; color: var(--avt); }
    .foot { margin-top: 12px; font-size: 11px; color: var(--di); }
    .foot .link { font-weight: 600; color: var(--at); }
    .backdrop { position: fixed; inset: 0; background: rgb(0 0 0 / .35); display: flex; align-items: center;
      justify-content: center; padding: 16px; }
    .modal { position: relative; display: flex; flex-direction: column; width: min(600px, 100%); max-height: min(720px, 100%);
      border: 1px solid ${mix("--a", 50)}; }
    .modal > ul { max-height: none; flex: 1; min-height: 0; }
    .x { font-size: 20px; line-height: 1; color: var(--mu); padding: 0 4px; }
    .x:hover { color: var(--fg); }
    .tabs { margin-top: 12px; display: flex; gap: 4px; font-size: 12px; }
    .tabs button { border-radius: 999px; padding: 4px 10px; color: var(--mu); border: 1px solid var(--l); }
    .tabs button[aria-pressed="true"] { border-color: ${mix("--a", 70)}; background: ${mix("--a", 15)}; color: var(--at); font-weight: 600; }
    .chip { border-radius: 999px; padding: 0 6px; font-size: 10px; font-weight: 700; line-height: 15px; text-transform: uppercase;
      letter-spacing: .03em; background: ${mix("--a", 20)}; color: var(--at); }
    .chip.done, .chip.dismissed { background: ${mix("--mu", 18)}; color: var(--mu); }
    li.resolved .num { background: var(--di); }
    li.resolved .text { color: var(--mu); }
    .log { margin: 4px 0 0; padding: 0; list-style: none; display: block; max-height: none; font-size: 10px; color: var(--di); }
    .log li { display: list-item; background: none; padding: 0; border-radius: 0; }
    .empty { margin-top: 16px; font-size: 12px; color: var(--mu); }
    .panel.collapsed { padding: 10px 16px; }
    .count { margin-left: 6px; border-radius: 999px; background: ${mix("--a", 20)}; padding: 0 6px; font-size: 10px; font-weight: 700; color: var(--at); }
    .note { margin: 1px 0 3px 8px; padding-left: 6px; border-left: 2px solid var(--l); color: var(--mu); white-space: pre-wrap; }
    .head-actions { display: flex; align-items: center; gap: 12px; }
    .icon-btn { display: flex; color: var(--mu); }
    .icon-btn:hover { color: var(--fg); }
    .settings { overflow-y: auto; margin-top: 4px; padding-right: 4px; }
    .field { margin-top: 16px; }
    .field > .label { display: block; margin-bottom: 6px; font-size: 12px; font-weight: 600; }
    .field .tabs { margin-top: 0; flex-wrap: wrap; }
    .field .hint { margin-top: 6px; }
    .swatches { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .sw { width: 24px; height: 24px; border-radius: 999px; border: 2px solid var(--p); box-shadow: 0 0 0 1px var(--l); }
    .sw[aria-pressed="true"] { box-shadow: 0 0 0 2px var(--fg); }
    .sw.app { background: conic-gradient(#d303be, #2563eb, #16a34a, #ea580c, #d303be); }
    input[type="color"] { width: 28px; height: 28px; padding: 0; border: 0; background: none; cursor: pointer; }
    input[type="text"] { width: 100%; border-radius: 8px; border: 1px solid var(--l); background: ${mix("--in", 60)};
      padding: 6px 8px; font: inherit; font-size: 13px; color: var(--fg); outline: none; }
    input[type="text"]:focus { border-color: var(--a); }
    .tabs.icons button { display: flex; padding: 6px 8px; }
    .check { display: flex; align-items: center; gap: 8px; font-size: 13px; cursor: pointer; }
    .check input { accent-color: var(--a); width: 16px; height: 16px; margin: 0; }
    kbd { border-radius: 6px; border: 1px solid var(--l); background: ${mix("--in", 60)}; padding: 3px 8px; font: inherit;
      font-size: 12px; font-weight: 600; }
    code { font-size: 11px; color: var(--mu); word-break: break-all; }
    .banner { left: 50%; top: 16px; transform: translateX(-50%); padding: 10px 16px; font-size: 13px; font-weight: 600;
      border: 1px solid ${mix("--a", 60)}; color: var(--at); }
  `;

  const GLOBAL_CSS = `
    html.afp-active, html.afp-active * { cursor: crosshair !important; }
    html.afp-active :is(${UI_TAGS}) { cursor: auto !important; }
  `;

  // ---------- The toggle button ----------

  const buttonHost = document.createElement("agent-feedback-pins-button");
  const buttonRoot = buttonHost.attachShadow({ mode: "open" });
  const ICONS = {
    chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
    pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><path d="M4 22v-7"/>',
    megaphone: '<path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    collapse: '<path d="m6 9 6 6 6-6"/>',
    expand: '<path d="m18 15-6-6-6 6"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  };

  function icon(name, size = 14) {
    const t = document.createElement("template");
    t.innerHTML = `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] ?? ICONS.chat}</svg>`;
    return t.content.firstChild;
  }

  function renderButton() {
    const open = state.items.filter((i) => i.status === "open").length;
    const { button, shortcut } = prefs();
    const label = button.label.trim() || "Feedback";
    // An empty label means icon only, whatever the display choice.
    const showText = button.show !== "icon" && (button.show === "text" || !!button.label.trim());
    const btn = h(
      "button",
      {
        type: "button",
        className: "t",
        title: `Feedback mode: click any part of the app to leave a comment${shortcut ? ` (${keyLabel(shortcut)})` : ""}`,
        "aria-label": state.active ? "Exit feedback mode" : label,
        "aria-pressed": String(state.active),
        onClick: () => setActive(!state.active),
      },
      button.show !== "text" || !showText ? icon(button.icon) : null,
      showText ? h("span", { className: "label" }, state.active ? "Done" : label) : null,
      open > 0 ? h("span", { className: "badge" }, String(open)) : null,
    );
    buttonRoot.replaceChildren(h("style", {}, BUTTON_CSS), btn);
  }

  /** Keep the button docked where the page asked, even as a SPA re-renders around it. */
  function dock() {
    const { position } = prefs();
    let selector = attr("data-mount-before") || attr("data-mount");
    let place = attr("data-mount-before") ? "before" : "inside";
    if (position.mode === "floating") selector = undefined;
    if (position.mode === "custom" && position.selector) [selector, place] = [position.selector, position.place];
    if (position.mode === "hidden") {
      // Shortcut only. Feedback mode stays on if it was on: its panel has the way out.
      buttonHost.remove();
      buttonHost.removeAttribute("data-floating");
      return;
    }
    let target = null;
    try {
      target = selector ? document.querySelector(selector) : null;
    } catch {
      // A saved selector that no longer parses: float instead.
    }
    if (target) {
      buttonHost.removeAttribute("data-floating");
      if (place === "before" && buttonHost.nextElementSibling !== target) target.before(buttonHost);
      if (place === "after" && buttonHost.previousElementSibling !== target) target.after(buttonHost);
      if (place === "inside" && buttonHost.parentElement !== target) target.append(buttonHost);
    } else if (script?.hasAttribute("data-dock-only") && position.mode === "default") {
      if (buttonHost.isConnected) setActive(false);
      buttonHost.remove();
    } else {
      // No dock (or not rendered yet, or the page has none): float in the corner.
      const corner = position.mode === "floating" ? position.corner : "bottom-left";
      if (buttonHost.getAttribute("data-floating") !== corner) {
        buttonHost.setAttribute("data-floating", corner);
        if (state.active) renderPanel(); // it keeps clear of the button's corner
      }
      if (buttonHost.parentElement !== document.body) document.body.append(buttonHost);
    }
  }

  // ---------- The overlay: highlight, pins, editor, panel ----------

  const overlayHost = document.createElement("agent-feedback-pins");
  const overlayRoot = overlayHost.attachShadow({ mode: "open" });
  const highlight = h("div", { className: "hl", style: { display: "none" } });
  const pinsLayer = h("div");
  const editorSlot = h("div");
  const panelSlot = h("div");
  const modalSlot = h("div");
  // Later slots paint on top: the editor above the panel, a modal above both.
  overlayRoot.append(h("style", {}, OVERLAY_CSS), highlight, pinsLayer, panelSlot, editorSlot, modalSlot);

  const globalStyle = h("style", { "data-agent-feedback-pins": "" }, GLOBAL_CSS);

  const onThisPage = (i) => i.route.split("?")[0] === location.pathname;
  const pageItems = () => state.items.filter((i) => onThisPage(i) && isOpen(i));

  function pinPosition(item) {
    if (!item.element) return null;
    let rect = item.element.rect;
    try {
      const el = document.querySelector(item.element.selector);
      if (el) {
        const r = el.getBoundingClientRect();
        if (r.width || r.height) rect = { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
      }
    } catch {
      // Invalid selector after a layout change: fall back to the stored position.
    }
    return { left: rect.x + rect.width - 12, top: rect.y - 10 };
  }

  function renderPins() {
    if (!prefs().showPins) return pinsLayer.replaceChildren();
    pinsLayer.replaceChildren(
      ...pageItems()
        .map((item) => {
          const pos = pinPosition(item);
          if (!pos) return null;
          return h(
            "button",
            {
              type: "button",
              className: "pin",
              title: `#${item.number} ${item.author?.name ?? ""}: ${item.comment}`,
              style: { left: `${pos.left}px`, top: `${pos.top}px` },
              onClick: (e) => openEditor({ element: item.element, at: { x: e.clientX, y: e.clientY }, editing: item }),
            },
            String(item.number),
          );
        })
        .filter(Boolean),
    );
  }

  function openEditor(draft) {
    state.draft = draft;
    highlight.style.display = "none";
    const { editing, element: e } = draft;
    const canEdit = !editing || mine(editing);
    const w = 340;
    const left = Math.min(Math.max(12, draft.at.x + 12), innerWidth - w - 12);
    const top = Math.min(Math.max(12, draft.at.y + 12), innerHeight - 260);
    const target = e ? [e.section, e.label ?? e.text].filter(Boolean).join(" › ") : "Whole page";
    const area = h("textarea", {
      rows: 4,
      placeholder: "What should change here?",
      readOnly: !canEdit,
      value: editing?.comment ?? "",
      onKeydown: (ev) => {
        if (ev.key === "Enter" && (ev.metaKey || ev.ctrlKey)) void submit();
      },
      onInput: () => (save.disabled = !area.value.trim()),
    });
    const err = h("div", { className: "err", style: { display: "none" } });
    const save = h("button", { type: "button", className: "save", disabled: !editing?.comment, onClick: () => void submit() }, "Save ", h("span", { className: "kbd" }, "⌘↵"));

    async function submit() {
      const text = area.value.trim();
      if (!text) return;
      save.disabled = true;
      save.firstChild.textContent = "Saving ";
      err.style.display = "none";
      try {
        if (editing) await call(`/api/items/${editing.id}`, "PATCH", { comment: text });
        else
          await call("/api/items", "POST", {
            comment: text,
            route: location.pathname + location.search,
            url: location.href,
            pageTitle: pageTitle(),
            element: e,
            viewport: { width: innerWidth, height: innerHeight },
          });
        closeEditor();
        await reload();
      } catch (x) {
        err.textContent = x.message;
        err.style.display = "";
        save.disabled = false;
        save.firstChild.textContent = "Save ";
      }
    }

    editorSlot.replaceChildren(
      h(
        "div",
        { className: "card editor", style: { left: `${left}px`, top: `${top}px` } },
        h("div", { className: "eyebrow" }, editing ? `Comment #${editing.number} · ${editing.author?.name ?? "Unknown"}` : "New comment"),
        h("div", { className: "target", title: target }, `${e ? `<${e.tag}> ` : ""}${target}`),
        area,
        err,
        h(
          "div",
          { className: "row", style: { marginTop: "12px" } },
          h(
            "div",
            { className: "links" },
            editing && canEdit ? h("button", { type: "button", className: "danger", onClick: () => void remove(editing) }, "Delete") : null,
            editing
              ? h(
                  "button",
                  {
                    type: "button",
                    className: "quiet link",
                    onClick: async () => {
                      await call(`/api/items/${editing.id}`, "PATCH", { status: "done" });
                      closeEditor();
                      await reload();
                    },
                  },
                  "Mark done",
                )
              : null,
          ),
          h(
            "div",
            { className: "links", style: { gap: "8px" } },
            h("button", { type: "button", className: "ghost", onClick: closeEditor }, "Cancel"),
            canEdit ? save : null,
          ),
        ),
      ),
    );
    area.focus();
  }

  function closeEditor() {
    state.draft = null;
    editorSlot.replaceChildren();
  }

  async function remove(item) {
    try {
      await call(`/api/items/${item.id}`, "DELETE");
    } catch (x) {
      alert(x.message);
    }
    closeEditor();
    await reload();
  }

  function panelItem(item) {
    const avatar = h("span", { className: "av", title: `${item.author?.name ?? ""} <${item.author?.email ?? ""}>` }, initials(item.author?.name));
    const num = h("span", { className: "num" }, String(item.number));
    if (state.panelEditing === item.id) {
      const area = h("textarea", { className: "sm", rows: 3, value: item.comment });
      const cancel = () => {
        state.panelEditing = null;
        renderPanel();
      };
      const saveBtn = h("button", { type: "button", className: "link" }, "Save");
      const save = async () => {
        if (!area.value.trim()) return;
        saveBtn.disabled = true;
        saveBtn.textContent = "Saving";
        try {
          await call(`/api/items/${item.id}`, "PATCH", { comment: area.value.trim() });
          state.panelEditing = null;
          await reload();
        } catch (x) {
          alert(x.message);
          saveBtn.disabled = false;
          saveBtn.textContent = "Save";
        }
      };
      saveBtn.addEventListener("click", () => void save());
      area.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void save();
      });
      area.addEventListener("input", () => (saveBtn.disabled = !area.value.trim()));
      queueMicrotask(() => area.focus());
      return h("li", {}, num, h("div", { className: "body" }, area, h("div", { className: "inline-actions" }, h("button", { type: "button", className: "quiet", onClick: cancel }, "Cancel"), saveBtn)), avatar);
    }
    return h(
      "li",
      {},
      num,
      h(
        "div",
        { className: "body" },
        h("div", { className: "text" }, item.comment),
        h(
          "div",
          { className: "meta" },
          h("span", {}, `${item.author?.name ?? "Unknown"} · ${onThisPage(item) ? "" : `${item.route} › `}${item.element?.section ?? "Whole page"}`),
          onThisPage(item) ? null : h("a", { className: "link", href: item.url || item.route }, "Go to page"),
          mine(item)
            ? [
                h("button", { type: "button", className: "link", onClick: () => ((state.panelEditing = item.id), renderPanel()) }, "Edit"),
                h("button", { type: "button", className: "danger", onClick: () => void remove(item) }, "Delete"),
              ]
            : null,
        ),
      ),
      avatar,
    );
  }

  /** The panel's corner, nudged clear of a floating button in the same one. */
  function panelPlace() {
    const { corner, collapsed } = prefs().panel;
    const [v, x] = corner.split("-");
    const gap = buttonHost.isConnected && buttonHost.getAttribute("data-floating") === corner ? 64 : 16;
    return { top: "auto", bottom: "auto", left: "auto", right: "auto", [v]: `${gap}px`, [x]: "16px", ...(collapsed ? { width: "auto" } : {}) };
  }

  function renderPanel() {
    if (!state.active) return panelSlot.replaceChildren();
    const here = pageItems();
    const open = state.items.filter(isOpen);
    const allOpen = open.length;
    const { collapsed, scope } = prefs().panel;
    // This page's comments first, then the rest of the app's.
    const items = scope === "page" ? here : [...here, ...open.filter((i) => !onThisPage(i))];
    const toggle = () => void saveSettings((s) => (s.panel = { ...s.panel, collapsed: !collapsed }));
    const header = h(
      "div",
      { className: "row" },
      h("div", { className: "title" }, "Feedback mode", collapsed && items.length ? h("span", { className: "count", title: scope === "page" ? "Open comments on this page" : "Open comments across the app" }, String(items.length)) : null),
      h(
        "div",
        { className: "head-actions" },
        h("button", { type: "button", className: "icon-btn", title: "Settings", "aria-label": "Settings", onClick: () => openModal("settings") }, icon("gear", 16)),
        h("button", { type: "button", className: "icon-btn", title: collapsed ? "Expand" : "Collapse", "aria-label": collapsed ? "Expand panel" : "Collapse panel", "aria-expanded": String(!collapsed), onClick: toggle }, icon(collapsed ? "expand" : "collapse", 16)),
        h("button", { type: "button", className: "quiet", style: { fontSize: "12px" }, onClick: () => setActive(false) }, "Exit (Esc)"),
      ),
    );
    if (collapsed) {
      panelSlot.replaceChildren(h("div", { className: "card panel collapsed", style: panelPlace() }, header));
      return renderPins();
    }
    panelSlot.replaceChildren(
      h(
        "div",
        { className: "card panel", style: panelPlace() },
        header,
        h("p", { className: "hint" }, "Click any part of the page to comment on it. Comments are saved for your next planning session."),
        h("button", { type: "button", className: "whole", onClick: () => openEditor({ element: null, at: { x: innerWidth - 380, y: innerHeight - 320 } }) }, "Comment on this whole page"),
        allOpen
          ? h(
              "div",
              { className: "tabs" },
              [
                ["all", `All pages (${allOpen})`],
                ["page", `This page (${here.length})`],
              ].map(([value, label]) =>
                h("button", { type: "button", "aria-pressed": String(scope === value), onClick: () => void saveSettings((s) => (s.panel = { ...s.panel, scope: value })) }, label),
              ),
            )
          : null,
        items.length ? h("ul", {}, items.map(panelItem)) : null,
        h(
          "div",
          { className: "foot" },
          `${allOpen} open comment${allOpen === 1 ? "" : "s"} across the app · `,
          h("button", { type: "button", className: "link", onClick: () => openModal("history") }, "View all and resolved"),
          h("div", {}, `Saved to ${state.me.file}`),
        ),
      ),
    );
    renderPins();
  }

  // ---------- The all-comments modal ----------

  async function setStatus(item, status) {
    try {
      await call(`/api/items/${item.id}`, "PATCH", { status });
    } catch (x) {
      alert(x.message);
    }
    await reload();
  }

  function openModal(name) {
    closeEditor();
    state.modal = name;
    renderModal();
    void reload();
  }

  function closeModal() {
    state.modal = null;
    state.recording = false;
    modalSlot.replaceChildren();
  }

  function historyItem(item) {
    const resolved = !isOpen(item);
    const last = lastResolution(item);
    const here = item.route.split("?")[0] === location.pathname;
    const log = (item.history ?? []).map((x) =>
      h(
        "li",
        {},
        `${x.status === "open" ? "Reopened" : x.status[0].toUpperCase() + x.status.slice(1)} by ${x.by?.name ?? "Unknown"}${x.by?.agent ? " (agent)" : ""} · `,
        when(x.at),
        x.note ? h("div", { className: "note" }, x.note) : null,
      ),
    );
    return h(
      "li",
      { className: resolved ? "resolved" : "" },
      h("span", { className: "num" }, String(item.number)),
      h(
        "div",
        { className: "body" },
        h("div", { className: "row", style: { alignItems: "flex-start" } }, h("div", { className: "text" }, item.comment), h("span", { className: `chip ${item.status}` }, last && item.status === "open" ? "reopened" : item.status)),
        h(
          "div",
          { className: "meta" },
          h("span", {}, `${item.author?.name ?? "Unknown"} · ${item.route}${item.element?.section ? ` › ${item.element.section}` : ""} · `, when(item.createdAt)),
          resolved
            ? h("button", { type: "button", className: "link", onClick: () => void setStatus(item, "open") }, "Mark unresolved")
            : h("button", { type: "button", className: "link", onClick: () => void setStatus(item, "done") }, "Mark done"),
          here ? null : h("a", { className: "link", href: item.url || item.route }, "Go to page"),
        ),
        log.length ? h("ul", { className: "log" }, log) : null,
      ),
      h("span", { className: "av", title: `${item.author?.name ?? ""} <${item.author?.email ?? ""}>` }, initials(item.author?.name)),
    );
  }

  function renderHistory() {
    const counts = { all: state.items.length, open: state.items.filter(isOpen).length };
    counts.resolved = counts.all - counts.open;
    const items = state.items
      .filter((i) => state.historyFilter === "all" || (state.historyFilter === "open") === isOpen(i))
      .sort((a, b) => Date.parse(b.updatedAt ?? b.createdAt) - Date.parse(a.updatedAt ?? a.createdAt));
    const tab = (key, label) =>
      h("button", { type: "button", "aria-pressed": String(state.historyFilter === key), onClick: () => ((state.historyFilter = key), renderModal()) }, `${label} (${counts[key]})`);
    return [
      h("div", { className: "row" }, h("div", { className: "title" }, "All comments"), h("button", { type: "button", className: "x", title: "Close (Esc)", "aria-label": "Close", onClick: closeModal }, "×")),
      h("p", { className: "hint" }, "Every comment across the app, newest activity first. Mark a resolved one unresolved to send it back to your agent."),
      h("div", { className: "tabs" }, tab("all", "All"), tab("open", "Open"), tab("resolved", "Resolved")),
      items.length ? h("ul", {}, items.map(historyItem)) : h("p", { className: "empty" }, "Nothing here yet."),
    ];
  }

  function renderModal() {
    if (!state.modal) return modalSlot.replaceChildren();
    const body = state.modal === "settings" ? renderSettings() : renderHistory();
    modalSlot.replaceChildren(
      h(
        "div",
        { className: "backdrop", onClick: (e) => e.target === e.currentTarget && closeModal() },
        h("div", { className: "card modal", role: "dialog", "aria-modal": "true" }, body),
      ),
    );
  }

  // ---------- Settings ----------

  const ACCENTS = ["#d303be", "#7c3aed", "#2563eb", "#0891b2", "#16a34a", "#ea580c", "#dc2626", "#475569"];
  const DARK = {
    panel: "#1c1c22",
    "panel-2": "#272730",
    input: "#2a2a33",
    line: "#3a3a46",
    fg: "#f2f2f5",
    muted: "#b4b4c2",
    dim: "#8a8a9e",
    danger: "#ff6b52",
    "avatar-text": "#b3abff",
  };
  const LIGHT = { panel: "#ffffff", "panel-2": "#f5f5fe", input: "#f7f7f8", line: "#e0e0e4", fg: "#141418", muted: "#4f5062", dim: "#828395", danger: "#e22c10", "avatar-text": "#4a3ed0" };
  const darkQuery = matchMedia("(prefers-color-scheme: dark)");

  /** Set the chosen theme as --afp-* overrides on our hosts; unset choices leave the page's own. */
  function applyTheme() {
    const { accent, mode } = prefs().theme;
    const dark = mode === "dark" || (mode === "auto" && darkQuery.matches);
    const vars = mode ? { ...(dark ? DARK : LIGHT) } : {};
    if (accent) vars.accent = accent;
    // Accent text that reads on the panel: the accent pulled toward the foreground color.
    if (accent || mode) vars["accent-text"] = `color-mix(in srgb, var(--afp-accent, #d303be) 70%, var(--afp-fg, #141418))`;
    // A chosen light or dark mode won't match the page, so a docked button gets its own background.
    buttonHost.toggleAttribute("data-themed", !!mode);
    for (const host of [buttonHost, overlayHost]) {
      for (const name of [...host.style]) if (name.startsWith("--afp-")) host.style.removeProperty(name);
      for (const [k, v] of Object.entries(vars)) host.style.setProperty(`--afp-${k}`, v);
    }
  }
  darkQuery.addEventListener?.("change", applyTheme);

  function applySettings() {
    applyTheme();
    renderButton();
    dock();
    if (state.active) renderPanel();
  }

  let settingsError = "";
  async function saveSettings(change) {
    const next = structuredClone(state.settings);
    change(next);
    state.settings = JSON.parse(JSON.stringify(next)); // drop cleared (undefined) choices
    applySettings();
    try {
      state.settings = await call("/api/settings", "PUT", state.settings);
      settingsError = "";
    } catch (x) {
      settingsError = `Couldn't save: ${x.message}`;
    }
    if (state.modal === "settings") renderModal();
  }

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
  const MODS = ["Ctrl", "Alt", "Shift", "Meta"];

  /** "Alt+Shift+F" for a keydown, using the physical key so Option on a Mac still gives F. */
  function comboOf(e) {
    const key = /^Key[A-Z]$|^Digit\d$/.test(e.code) ? e.code.slice(-1) : e.code;
    const mods = MODS.filter((m) => e[`${m.toLowerCase()}Key`]);
    return [...mods, key].join("+");
  }

  function keyLabel(combo) {
    if (!isMac) return combo.replace("Meta", "Win");
    const sym = { Ctrl: "⌃", Alt: "⌥", Shift: "⇧", Meta: "⌘" };
    return combo
      .split("+")
      .map((p) => sym[p] ?? p)
      .join("");
  }

  // Always listening: the shortcut toggles Feedback mode, and settings can record a new one.
  document.addEventListener(
    "keydown",
    (e) => {
      if (state.recording) {
        if (["Control", "Alt", "Shift", "Meta"].includes(e.key)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.key === "Escape") return ((state.recording = false), renderModal());
        if (!e.ctrlKey && !e.altKey && !e.metaKey) return ((settingsError = "Include Ctrl, Alt or ⌘ so it doesn't fire while typing."), renderModal());
        state.recording = false;
        settingsError = "";
        void saveSettings((s) => (s.shortcut = comboOf(e)));
        return;
      }
      const { shortcut } = prefs();
      if (!shortcut || e.repeat || comboOf(e) !== shortcut) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setActive(!state.active);
    },
    true,
  );

  function startPicking() {
    state.picking = true;
    closeModal();
    editorSlot.replaceChildren(h("div", { className: "card banner" }, "Click where the button should go · Esc to cancel"));
  }

  function stopPicking(target) {
    state.picking = false;
    editorSlot.replaceChildren();
    highlight.style.display = "none";
    const selector = target && cssPath(target);
    if (selector) void saveSettings((s) => (s.position = { ...s.position, mode: "custom", selector }));
    openModal("settings");
  }

  function renderSettings() {
    const p = prefs();
    const docked = !!(attr("data-mount-before") || attr("data-mount"));
    const seg = (options, current, pick, className = "tabs") =>
      h(
        "div",
        { className },
        options.map(([value, label, title]) =>
          h("button", { type: "button", title, "aria-pressed": String(current === value), onClick: () => void saveSettings((s) => pick(s, value)) }, label),
        ),
      );
    const field = (label, ...body) => h("div", { className: "field" }, h("div", { className: "label" }, label), ...body);
    const set = (key) => (s, v) => (s[key] = { ...s[key], ...v });

    const custom = !ACCENTS.includes(p.theme.accent) && p.theme.accent;
    const swatches = h(
      "div",
      { className: "swatches" },
      h("button", { type: "button", className: "sw app", title: "The app's theme (--afp-accent)", "aria-pressed": String(!p.theme.accent), onClick: () => void saveSettings((s) => set("theme")(s, { accent: undefined })) }),
      ACCENTS.map((c) =>
        h("button", { type: "button", className: "sw", title: c, style: { background: c }, "aria-pressed": String(p.theme.accent === c), onClick: () => void saveSettings((s) => set("theme")(s, { accent: c })) }),
      ),
      h("input", {
        type: "color",
        title: "Custom color",
        value: custom || "#d303be",
        onChange: (e) => void saveSettings((s) => set("theme")(s, { accent: e.target.value })),
      }),
    );

    const label = h("input", {
      type: "text",
      value: p.button.label,
      maxLength: 40,
      placeholder: "Feedback",
      onChange: (e) => void saveSettings((s) => set("button")(s, { label: e.target.value })),
    });

    const icons = h(
      "div",
      { className: "tabs icons" },
      ["chat", "pin", "pencil", "flag", "megaphone", "eye"]
        .map((n) =>
          h("button", { type: "button", title: n, "aria-label": n, "aria-pressed": String(p.button.icon === n), onClick: () => void saveSettings((s) => set("button")(s, { icon: n })) }, icon(n, 16)),
        ),
    );

    const position = [
      seg(
        [
          ["default", docked ? "Where the app put it" : "Default (bottom-left)"],
          ["floating", "Floating"],
          ["custom", "Pick a spot"],
          ["hidden", "Hidden"],
        ],
        p.position.mode,
        (s, mode) => {
          set("position")(s, { mode });
          if (mode === "hidden" && !p.shortcut) delete s.shortcut; // keep a way in
          if (mode === "custom" && !p.position.selector) queueMicrotask(startPicking);
        },
      ),
      p.position.mode === "floating"
        ? h("div", { style: { marginTop: "8px" } }, seg([["bottom-left", "Bottom left"], ["bottom-right", "Bottom right"], ["top-left", "Top left"], ["top-right", "Top right"]], p.position.corner, (s, corner) => set("position")(s, { corner })))
        : null,
      p.position.mode === "custom"
        ? h(
            "div",
            { style: { marginTop: "8px" } },
            p.position.selector
              ? h("div", { className: "row" }, seg([["before", "Before"], ["after", "After"], ["inside", "Inside"]], p.position.place, (s, place) => set("position")(s, { place })), h("button", { type: "button", className: "link quiet", style: { fontSize: "12px" }, onClick: startPicking }, "Pick again"))
              : null,
            p.position.selector ? h("p", { className: "hint" }, "Next to ", h("code", {}, p.position.selector), ". It floats on pages without that element.") : null,
          )
        : null,
      p.position.mode === "hidden" ? h("p", { className: "hint" }, `No button: press ${keyLabel(p.shortcut || DEFAULTS.shortcut)} to open Feedback mode.`) : null,
    ];

    const shortcut = h(
      "div",
      { className: "row", style: { justifyContent: "flex-start", gap: "12px" } },
      h("kbd", {}, state.recording ? "Press keys…" : p.shortcut ? keyLabel(p.shortcut) : "Off"),
      h("button", { type: "button", className: "link quiet", style: { fontSize: "12px" }, onClick: () => ((state.recording = !state.recording), (settingsError = ""), renderModal()) }, state.recording ? "Cancel" : "Change"),
      p.shortcut && p.position.mode !== "hidden"
        ? h("button", { type: "button", className: "link quiet", style: { fontSize: "12px" }, onClick: () => void saveSettings((s) => (s.shortcut = "")) }, "Turn off")
        : null,
      p.shortcut !== DEFAULTS.shortcut ? h("button", { type: "button", className: "link quiet", style: { fontSize: "12px" }, onClick: () => void saveSettings((s) => delete s.shortcut) }, `Reset to ${keyLabel(DEFAULTS.shortcut)}`) : null,
    );

    return [
      h("div", { className: "row" }, h("div", { className: "title" }, "Settings"), h("button", { type: "button", className: "x", title: "Close (Esc)", "aria-label": "Close", onClick: closeModal }, "×")),
      h(
        "div",
        { className: "settings" },
        field("Accent color", swatches),
        field("Light or dark", seg([["", "App theme"], ["light", "Light"], ["dark", "Dark"], ["auto", "Match system"]], p.theme.mode, (s, mode) => set("theme")(s, { mode: mode || undefined }))),
        field("Button label", label),
        field("Button icon", icons),
        field("Show", seg([["both", "Icon and label"], ["icon", "Icon only"], ["text", "Label only"]], p.button.show, (s, show) => set("button")(s, { show }))),
        field("Button position", ...position),
        field(
          "Panel position",
          seg([["bottom-right", "Bottom right"], ["bottom-left", "Bottom left"], ["top-right", "Top right"], ["top-left", "Top left"]], p.panel.corner, (s, corner) => set("panel")(s, { corner })),
          h("p", { className: "hint" }, "Collapse it to just its header with the arrow at its top."),
        ),
        field("Keyboard shortcut for Feedback mode", shortcut),
        field(
          "Pins",
          h(
            "label",
            { className: "check" },
            h("input", { type: "checkbox", checked: p.showPins, onChange: (e) => void saveSettings((s) => (s.showPins = e.target.checked)) }),
            "Show numbered pins on open comments",
          ),
        ),
        state.me.nameable
          ? field(
              "Your name on comments",
              h("input", {
                type: "text",
                value: p.name,
                maxLength: 120,
                placeholder: state.me.gitName || "Your git name",
                onChange: (e) =>
                  void saveSettings((s) => (s.name = e.target.value.trim() || undefined)).then(() =>
                    call("/api/me").then((me) => (state.me = me)),
                  ),
              }),
              h("p", { className: "hint" }, "Used on new comments and in the history. Empty uses your git name."),
            )
          : null,
        field(
          "Agent notes",
          h(
            "label",
            { className: "check" },
            h("input", { type: "checkbox", checked: p.askForNotes, onChange: (e) => void saveSettings((s) => (s.askForNotes = e.target.checked)) }),
            "Ask agents for a note on what they changed when they resolve a comment",
          ),
          h("p", { className: "hint" }, "Notes show in each comment's history under View all and resolved."),
        ),
        settingsError ? h("div", { className: "err" }, settingsError) : null,
        h(
          "div",
          { className: "row foot" },
          h("span", {}, `Saved to ${state.me.file.replace(/FEEDBACK\.md$/, "settings.json")}`),
          h("button", { type: "button", className: "link danger", onClick: () => void saveSettings((s) => Object.keys(s).forEach((k) => delete s[k])) }, "Reset all"),
        ),
      ),
    ];
  }

  // ---------- Feedback mode on and off ----------

  const isUi = (e) => e.composedPath().some((n) => n === overlayHost || n === buttonHost);

  const listeners = {
    mousemove: (e) => {
      if ((state.draft && !state.picking) || state.modal || isUi(e) || !(e.target instanceof Element)) return (highlight.style.display = "none");
      const r = e.target.getBoundingClientRect();
      Object.assign(highlight.style, {
        display: "",
        left: `${r.left - 2}px`,
        top: `${r.top - 2}px`,
        width: `${r.width + 4}px`,
        height: `${r.height + 4}px`,
      });
    },
    click: (e) => {
      if (isUi(e) || !(e.target instanceof Element)) return;
      e.preventDefault();
      e.stopPropagation();
      if (state.picking) return stopPicking(e.target);
      if (state.draft) return;
      openEditor({ element: describe(e.target), at: { x: e.clientX, y: e.clientY } });
    },
    mousedown: (e) => {
      if (!isUi(e)) {
        e.preventDefault();
        e.stopPropagation();
      }
    },
    keydown: (e) => {
      if (e.key !== "Escape") return;
      if (state.picking) stopPicking(null);
      else if (state.modal) closeModal();
      else if (state.panelEditing) {
        state.panelEditing = null;
        renderPanel();
      } else if (state.draft) closeEditor();
      else setActive(false);
    },
  };
  listeners.submit = listeners.mousedown;

  let timer;
  const onResize = () => renderPins();

  function setActive(on) {
    if (on === state.active) return;
    state.active = on;
    for (const [type, fn] of Object.entries(listeners)) {
      if (on) document.addEventListener(type, fn, true);
      else document.removeEventListener(type, fn, true);
    }
    document.documentElement.classList.toggle("afp-active", on);
    if (on) {
      document.head.append(globalStyle);
      document.body.append(overlayHost);
      // Re-place pins as the layout shifts (polling data, drawers opening).
      timer = setInterval(renderPins, 1000);
      addEventListener("resize", onResize);
      void reload();
    } else {
      clearInterval(timer);
      removeEventListener("resize", onResize);
      closeEditor();
      closeModal();
      state.picking = state.recording = false;
      state.panelEditing = null;
      highlight.style.display = "none";
      overlayHost.remove();
      globalStyle.remove();
    }
    renderButton();
    renderPanel();
  }

  // ---------- Start ----------

  async function start() {
    call("/api/me")
      .then((me) => (state.me = me))
      .catch(() => {});
    // Wait briefly for saved settings so the button doesn't appear in one place and jump.
    const settings = call("/api/settings").catch(() => ({}));
    state.settings = await Promise.race([settings, new Promise((r) => setTimeout(() => r({}), 1500))]);
    applyTheme();
    renderButton();
    dock();
    new MutationObserver(dock).observe(document.body, { childList: true, subtree: true });
    void reload();
  }
  if (document.body) void start();
  else document.addEventListener("DOMContentLoaded", () => void start());
})();
