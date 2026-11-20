// Rulith Brain Agent, browser half (a plain script for dsh's module loader: no build step). It puts the product's brand
// on dsh's web page - the sidebar's mark and name, the conversation's hero mark, the tab's title and icon - and keeps
// the credit "Based on DeepSeek Harness (MIT)" at the sidebar's foot. And it gives the page its way to Rulith Brain:
// an entry at the sidebar's foot that opens the agent's own Brain page (whether Brain runs, the switch "Learn from
// research", what the last answer drew on) over the page, shown once by itself to a newcomer - without it nothing on
// dsh's page says that this agent works on Brain's memory. It reads nothing from dsh's server and sends nothing.
window.__ModuleLoader__.load({
  id: "rulith-brain-ui",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require("react");
    const h = React.createElement;
    const NAME = "Rulith Brain Agent";
    const CREDIT = "Based on DeepSeek Harness (MIT)";
    const UPSTREAM = "DeepSeek Harness";
    // the Rulith mark (the app's icon): a white R on a blue square, light top left to dark bottom right
    const LIGHT = "#3B82F6", DARK = "#1E3A8A";
    const BODY = "M30 22H56C68 22 76 30 76 40C76 48.5 71 54.5 63.5 56.5L49.5 58H44V78H30Z"
      + "M44 33.5V47H55.5C59.5 47 62 44.3 62 40.25C62 36.2 59.5 33.5 55.5 33.5Z";
    const LEG = "M49.5 58L63.5 56.5L77 78H61.5Z";
    const markSvg = (id) => '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
      + `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${LIGHT}"/><stop offset="1" stop-color="${DARK}"/></linearGradient></defs>`
      + `<rect width="100" height="100" rx="22" fill="url(#${id})"/>`
      + `<g transform="translate(-3 0)" fill="#fff"><path fill-rule="evenodd" d="${BODY}"/><path d="${LEG}"/></g></svg>`;

    let marks = 0;
    function Mark({ size, className }) {
      const [id] = React.useState(() => `rulith-brain-mark-${++marks}`);   // one gradient id per drawn mark
      const edge = size || 24;
      return h("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 100 100", width: edge, height: edge, className,
          role: "img", "aria-label": NAME, style: { display: "block", flex: "none" } },
        h("defs", null, h("linearGradient", { id, x1: 0, y1: 0, x2: 1, y2: 1 },
          h("stop", { offset: 0, stopColor: LIGHT }), h("stop", { offset: 1, stopColor: DARK }))),
        h("rect", { width: 100, height: 100, rx: 22, fill: `url(#${id})` }),
        h("g", { transform: "translate(-3 0)", fill: "#fff" }, h("path", { fillRule: "evenodd", d: BODY }), h("path", { d: LEG })));
    }
    // the agent's own Brain page: the launcher writes its address here when it copies this plugin into the profile
    // (start.mjs: the forwarder's port is another at every start). As the file ships, there is no address and no entry.
    const PANEL = "__RULITH_BRAIN_PANEL__";
    const hasPanel = /^https?:\/\//.test(PANEL);
    const ZH = typeof navigator !== "undefined" && /^zh\b/i.test(navigator.language || "");
    const WORDS = ZH
      ? { entry: "Rulith Brain", hint: "这个智能体用的记忆：是否已连接，学到了什么，回答用到了哪些内容", close: "关闭" }
      : { entry: "Rulith Brain", hint: "The memory this agent works with: whether it is connected, what it learns, what an answer drew on", close: "Close" };
    const SEEN = "rulith-brain-agent.panel-seen";
    const PANEL_ID = "rulith-brain-panel";

    /** The agent's Brain page over dsh's page: a column at the right, closed by its button, Escape, or a click beside it. */
    function openPanel(doc) {
      if (!hasPanel || !doc || !doc.body || doc.getElementById(PANEL_ID)) return false;
      const back = doc.createElement("div");
      back.id = PANEL_ID;
      back.setAttribute("role", "dialog");
      back.setAttribute("aria-modal", "true");
      back.setAttribute("aria-label", WORDS.entry);
      back.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;justify-content:flex-end;background:rgba(15,23,42,.45)";
      const pane = doc.createElement("div");
      pane.style.cssText = "display:flex;flex-direction:column;width:min(480px,100vw);height:100%;background:Canvas;color:CanvasText;box-shadow:-8px 0 28px rgba(0,0,0,.3)";
      const bar = doc.createElement("div");
      bar.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;padding:6px 8px 6px 14px;font:600 13px system-ui,sans-serif;border-bottom:1px solid rgba(128,128,128,.35)";
      const name = doc.createElement("span");
      name.textContent = WORDS.entry;
      const shut = doc.createElement("button");
      shut.type = "button";
      shut.textContent = "\u00d7";
      shut.title = WORDS.close;
      shut.setAttribute("aria-label", WORDS.close);
      shut.style.cssText = "width:30px;height:30px;border:1px solid rgba(128,128,128,.5);border-radius:6px;background:transparent;color:inherit;font:400 18px/1 system-ui,sans-serif;cursor:pointer";
      const frame = doc.createElement("iframe");
      frame.src = PANEL + (PANEL.includes("?") ? "&" : "?") + "embed=1";
      frame.title = WORDS.entry;
      frame.style.cssText = "flex:1;width:100%;border:0;background:Canvas";
      const close = () => { back.remove(); doc.removeEventListener("keydown", onKey, true); };
      const onKey = (e) => { if (e.key === "Escape") close(); };
      shut.addEventListener("click", close);
      back.addEventListener("click", (e) => { if (e.target === back) close(); });
      doc.addEventListener("keydown", onKey, true);
      bar.append(name, shut);
      pane.append(bar, frame);
      back.append(pane);
      doc.body.append(back);
      shut.focus();
      return true;
    }
    // (a small brain: two halves, as the app's icon has it)
    function Glyph() {
      return h("svg", { xmlns: "http://www.w3.org/2000/svg", viewBox: "0 0 24 24", width: 16, height: 16, fill: "none", stroke: "currentColor",
          strokeWidth: 1.7, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true", style: { flex: "none" } },
        h("path", { d: "M12 5.2a3.2 3.2 0 0 0-6 1.2 3.3 3.3 0 0 0-1.6 5.4A3.4 3.4 0 0 0 7 17.6a3 3 0 0 0 5 .9z" }),
        h("path", { d: "M12 5.2a3.2 3.2 0 0 1 6 1.2 3.3 3.3 0 0 1 1.6 5.4A3.4 3.4 0 0 1 17 17.6a3 3 0 0 1-5 .9z" }),
        h("path", { d: "M12 5.2v13.3" }));
    }
    // the entry at the sidebar's foot; the narrow sidebar shows its glyph alone
    function Memory({ wide }) {
      if (!hasPanel) return null;
      return h("button", { type: "button", "data-rulith-memory": "", title: WORDS.hint, "aria-label": `${WORDS.entry}. ${WORDS.hint}`,
          onClick: () => openPanel(document),
          style: { display: "flex", alignItems: "center", gap: 8, width: "100%", padding: wide ? "6px 12px" : "6px 0", justifyContent: wide ? "flex-start" : "center",
            border: 0, borderRadius: 6, background: "transparent", color: "inherit", font: "inherit", fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left" } },
        h(Glyph), wide ? h("span", { style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 } }, WORDS.entry) : null);
    }
    // the sidebar's foot: the way to Rulith Brain, and under it the credit (one action of dsh's row, a column of its own)
    function Foot({ wide }) {
      const entry = Memory({ wide }), credit = Credit({ wide });
      if (!entry && !credit) return null;
      return h("div", { style: { display: "flex", flexDirection: "column", alignItems: "stretch", gap: 2, flex: "1 1 100%", width: "100%", minWidth: 0 } }, entry, credit);
    }
    /** Once, for a newcomer: the Brain page opens by itself. Whether it did. */
    function introduce(doc, store) {
      if (!hasPanel) return false;
      try {
        if (store.getItem(SEEN)) return false;
        store.setItem(SEEN, "1");
      } catch { return false; }
      return openPanel(doc);
    }
    const line = { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 };
    // (the sidebar's brand row is one line high)
    function Name() {
      return h("span", { title: `${NAME}. ${CREDIT}.`, style: { ...line, fontWeight: 700 } }, NAME);
    }
    // the credit, above the settings at the sidebar's foot; the narrow sidebar has no room for it
    function Credit({ wide }) {
      if (!wide) return null;
      return h("div", { "data-rulith-credit": "", style: { ...line, padding: "4px 12px", fontSize: 12, opacity: 0.75 } }, CREDIT);
    }

    // the tab: dsh writes "<conversation> — DeepSeek Harness"; the product's name takes the place of dsh's, and the
    // tab's icon is the mark
    const retitle = (text) => String(text).split(UPSTREAM).join(NAME);
    const ICON = "data:image/svg+xml," + encodeURIComponent(markSvg("m"));
    function brandDocument(doc) {
      const fix = () => {
        if (doc.title.includes(UPSTREAM)) doc.title = retitle(doc.title);
        for (const link of doc.querySelectorAll('link[rel~="icon"]')) if (link.getAttribute("href") !== ICON) link.setAttribute("href", ICON);
      };
      fix();
      // (each change dsh makes is fixed once: what this writes no longer matches)
      const watch = new MutationObserver(fix);
      watch.observe(doc.head, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["href"] });
      return () => watch.disconnect();
    }

    function apply(ctx) {
      ctx.slots.inject("sidebar.brand.mark", () => ctx.slots.inject("sidebar.brand.name", function* () {
        yield ctx.slots.register({ name: "sidebar.brand.mark" }, Mark);
        yield ctx.slots.register({ name: "sidebar.brand.name" }, Name);
      }));
      ctx.slots.inject("conversation.hero.brand.mark", () => ctx.slots.register({ name: "conversation.hero.brand.mark" }, Mark));
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "rulith-brain-foot",
        inject: () => ({}) }, Foot));
      ctx.effect(() => brandDocument(document));
      ctx.effect(() => {
        const timer = setTimeout(() => { try { introduce(document, localStorage); } catch { /* no storage: no introduction */ } }, 1200);
        return () => clearTimeout(timer);
      });
    }
    exports.apply = apply;
    exports.inject = ["slots"];
    exports.NAME = NAME;
    exports.CREDIT = CREDIT;
    exports.retitle = retitle;
    exports.markSvg = markSvg;
    exports.PANEL = PANEL;
    exports.openPanel = openPanel;
    exports.introduce = introduce;
    return module.exports;
  }
});
