import { afterEach, describe, expect, it } from "vitest";

import { normalizeConfig } from "../src/footer/config.js";
import { textsFor } from "../src/footer/i18n.js";
import { CSS_TEXT } from "../src/footer/styles.js";
import { createView } from "../src/footer/view.js";
import { CONFIG } from "./helpers.js";

afterEach(() => {
  document.head.textContent = "";
  document.body.textContent = "";
});

describe("styles", () => {
  it("[hidden] inside the block always wins over component display rules (text of the rule)", () => {
    // Every rule that sets `display` on a block element has to lose against the [hidden] rule, which is !important.
    expect(CSS_TEXT).toMatch(/\.dyska-block\[hidden\],\.dyska-block \[hidden\]\{display:none !important\}/);
  });

  it("the service checkboxes reset the template's custom checkbox styling (native, in flow, visible)", () => {
    // Some templates hide native checkboxes (appearance:none; position:absolute) and draw their own; our grid layout needs them in flow.
    const rule = /\.dyska-block \.dyska-service input\{([^}]*)\}/.exec(CSS_TEXT)[1];
    expect(rule).toContain("position:static");
    expect(rule).toContain("appearance:auto");
    expect(rule).toContain("opacity:1");
  });

  it("hidden elements are not displayed once the stylesheet is in the document", () => {
    const style = document.createElement("style");
    style.textContent = CSS_TEXT;
    document.head.appendChild(style);
    const config = normalizeConfig(CONFIG);
    const view = createView({ config, text: textsFor("cs"), fmt: (m) => String(m), handlers: {} });
    document.body.appendChild(view.root);
    view.update({ visible: true, busy: false, error: false, tipCode: null, services: {}, cardCount: 0, texts: [], orphans: 0 });
    const hidden = view.root.querySelectorAll("[hidden]");
    expect(hidden.length).toBeGreaterThan(0);
    for (const node of hidden) expect(getComputedStyle(node).display, node.className).toBe("none");
    // The orphan notice is shown when there are orphans.
    view.update({ visible: true, busy: false, error: false, tipCode: null, services: {}, cardCount: 0, texts: [], orphans: 2 });
    const notice = view.root.querySelector(".dyska-orphans");
    expect(notice.hidden).toBe(false);
    expect(getComputedStyle(notice).display).toBe("flex");
  });
});
