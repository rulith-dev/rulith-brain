// Rulith Brain Agent, browser half (a plain script for dsh's module loader: no build step). It puts the product's brand
// on dsh's web page - the sidebar's mark and name, the conversation's hero mark, the tab's title and icon - and keeps
// the credit "Based on DeepSeek Harness (MIT)" at the sidebar's foot. It reads nothing from the server and sends nothing.
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
      ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({ name: "sidebar.footer.action", id: "rulith-brain-credit",
        inject: () => ({}) }, Credit));
      ctx.effect(() => brandDocument(document));
    }
    exports.apply = apply;
    exports.inject = ["slots"];
    exports.NAME = NAME;
    exports.CREDIT = CREDIT;
    exports.retitle = retitle;
    exports.markSvg = markSvg;
    return module.exports;
  }
});
