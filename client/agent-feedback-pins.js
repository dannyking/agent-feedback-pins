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
 * With neither, the button floats bottom-left.
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
  };

  async function reload() {
    try {
      state.items = await call("/api/items");
    } catch {
      // Feedback is best-effort; never break the app over it.
    }
    renderButton();
    if (state.active) renderPanel();
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
    :host([data-floating]) .t { background: var(--p); box-shadow: 0 4px 16px rgb(0 0 0 / .15); }
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
  `;

  const GLOBAL_CSS = `
    html.afp-active, html.afp-active * { cursor: crosshair !important; }
    html.afp-active :is(${UI_TAGS}) { cursor: auto !important; }
  `;

  // ---------- The toggle button ----------

  const buttonHost = document.createElement("agent-feedback-pins-button");
  const buttonRoot = buttonHost.attachShadow({ mode: "open" });
  const ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;

  function renderButton() {
    const open = state.items.filter((i) => i.status === "open").length;
    const btn = h(
      "button",
      {
        type: "button",
        className: "t",
        title: "Feedback mode: click any part of the app to leave a comment",
        "aria-pressed": String(state.active),
        onClick: () => setActive(!state.active),
      },
      h("span", { className: "label" }, state.active ? "Done" : "Feedback"),
      open > 0 ? h("span", { className: "badge" }, String(open)) : null,
    );
    btn.insertAdjacentHTML("afterbegin", ICON);
    buttonRoot.replaceChildren(h("style", {}, BUTTON_CSS), btn);
  }

  /** Keep the button docked where the page asked, even as a SPA re-renders around it. */
  function dock() {
    const before = attr("data-mount-before");
    const inside = attr("data-mount");
    const target = before || inside ? document.querySelector(before || inside) : null;
    if (target) {
      buttonHost.removeAttribute("data-floating");
      if (before && buttonHost.nextElementSibling !== target) target.before(buttonHost);
      if (!before && buttonHost.parentElement !== target) target.append(buttonHost);
    } else if (script?.hasAttribute("data-dock-only")) {
      if (buttonHost.isConnected) setActive(false);
      buttonHost.remove();
    } else {
      // No dock (or not rendered yet, or the page has none): float in the corner.
      buttonHost.setAttribute("data-floating", "");
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
  overlayRoot.append(h("style", {}, OVERLAY_CSS), highlight, pinsLayer, editorSlot, panelSlot);

  const globalStyle = h("style", { "data-agent-feedback-pins": "" }, GLOBAL_CSS);

  const pageItems = () => state.items.filter((i) => i.route.split("?")[0] === location.pathname && isOpen(i));

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
          h("span", {}, `${item.author?.name ?? "Unknown"} · ${item.element?.section ?? "Whole page"}`),
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

  function renderPanel() {
    if (!state.active) return panelSlot.replaceChildren();
    const items = pageItems();
    const allOpen = state.items.filter(isOpen).length;
    panelSlot.replaceChildren(
      h(
        "div",
        { className: "card panel" },
        h("div", { className: "row" }, h("div", { className: "title" }, "Feedback mode"), h("button", { type: "button", className: "quiet", style: { fontSize: "12px" }, onClick: () => setActive(false) }, "Exit (Esc)")),
        h("p", { className: "hint" }, "Click any part of the page to comment on it. Comments are saved for your next planning session."),
        h("button", { type: "button", className: "whole", onClick: () => openEditor({ element: null, at: { x: innerWidth - 380, y: innerHeight - 320 } }) }, "Comment on this whole page"),
        items.length ? h("ul", {}, items.map(panelItem)) : null,
        h("div", { className: "foot" }, `${allOpen} open comment${allOpen === 1 ? "" : "s"} across the app · saved to ${state.me.file}`),
      ),
    );
    renderPins();
  }

  // ---------- Feedback mode on and off ----------

  const isUi = (e) => e.composedPath().some((n) => n === overlayHost || n === buttonHost);

  const listeners = {
    mousemove: (e) => {
      if (state.draft || isUi(e) || !(e.target instanceof Element)) return (highlight.style.display = "none");
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
      if (state.panelEditing) {
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
      state.panelEditing = null;
      highlight.style.display = "none";
      overlayHost.remove();
      globalStyle.remove();
    }
    renderButton();
    renderPanel();
  }

  // ---------- Start ----------

  function start() {
    renderButton();
    dock();
    new MutationObserver(dock).observe(document.body, { childList: true, subtree: true });
    call("/api/me")
      .then((me) => (state.me = me))
      .catch(() => {});
    void reload();
  }
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
