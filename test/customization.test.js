import { afterEach, describe, expect, it, vi } from "vitest";

import { start } from "../src/footer/init.js";
import { normalizeConfig } from "../src/footer/config.js";
import { TEXT_LIMITS } from "../src/footer/constants.js";
import { textsFor } from "../src/footer/i18n.js";
import { createView } from "../src/footer/view.js";
import { CH, CONFIG, cartPage, installFetch, installShoptet, resetDom, setPath, uninstallShoptet } from "./helpers.js";

const withCustom = (extra) => normalizeConfig({ ...structuredClone(CONFIG), ...extra });
const STATE = { visible: true, busy: false, error: false, tipCode: null, services: {}, cardCount: 1, texts: [], orphans: 0 };

function build(extra, language = "cs") {
  const config = withCustom(extra);
  const view = createView({ config, text: textsFor(language, config.texts), fmt: (m) => `${m / 100} Kč`, handlers: { onTip: vi.fn(), onService: vi.fn(), onCards: vi.fn(), onNote: vi.fn(), onRemoveOrphans: vi.fn() } });
  document.body.appendChild(view.root);
  view.update(STATE);
  return { view, config };
}

afterEach(() => {
  document.body.textContent = "";
});

describe("normalizeConfig: appearance", () => {
  it("is empty without the fields (older backend) and does not change anything else", () => {
    const config = normalizeConfig(structuredClone(CONFIG));
    expect(config.appearance).toEqual({});
    expect(config.texts).toEqual({});
    expect(config.tips).toHaveLength(4);
  });

  it("keeps valid colours (lower-cased) and an integer radius within 0..24", () => {
    const config = withCustom({ appearance: { accentColor: "#AABBCC", borderColor: "#00ff00", borderRadius: 24 } });
    expect(config.appearance).toEqual({ accentColor: "#aabbcc", borderColor: "#00ff00", borderRadius: 24 });
    expect(withCustom({ appearance: { borderRadius: 0 } }).appearance).toEqual({ borderRadius: 0 });
  });

  it.each([
    "red; background:url(x)",
    "javascript:alert(1)",
    "url(https://evil.example/x)",
    "#fff",
    "#12345g",
    "#1234567",
    " #123456",
    "#123456;",
    "#123456\n",
    "red",
    "",
    123456,
    null,
    { toString: () => "#123456" },
  ])("drops a poisoned colour %j", (bad) => {
    const config = withCustom({ appearance: { accentColor: bad, borderColor: bad } });
    expect(config.appearance).toEqual({});
  });

  it.each([-1, 25, 1.5, "8", "8px", null, NaN, Infinity])("drops a bad radius %j", (bad) => {
    expect(withCustom({ appearance: { borderRadius: bad } }).appearance).toEqual({});
  });

  it("ignores a non-object appearance and unknown keys", () => {
    for (const bad of ["x", 5, [], null]) expect(withCustom({ appearance: bad }).appearance).toEqual({});
    expect(withCustom({ appearance: { accentColor: "#111111", evil: "x", "--x": "y" } }).appearance).toEqual({ accentColor: "#111111" });
  });
});

describe("normalizeConfig: texts", () => {
  it("whitelists keys and keeps clean strings", () => {
    const config = withCustom({ texts: { tipTitle: "Pošlete dýško", blockTitle: "Doplňky", evil: "x", __proto__: { polluted: "y" } } });
    expect(config.texts).toEqual({ tipTitle: "Pošlete dýško", blockTitle: "Doplňky" });
    expect({}.polluted).toBeUndefined();
  });

  it("drops empty, non-string and over-limit values (not cut)", () => {
    const texts = {};
    for (const [key, max] of Object.entries(TEXT_LIMITS)) texts[key] = "a".repeat(max + 1);
    expect(withCustom({ texts }).texts).toEqual({});
    expect(withCustom({ texts: { tipTitle: "a".repeat(TEXT_LIMITS.tipTitle) } }).texts.tipTitle).toHaveLength(TEXT_LIMITS.tipTitle);
    expect(withCustom({ texts: { tipTitle: "😀".repeat(TEXT_LIMITS.tipTitle) } }).texts.tipTitle).toBeDefined();
    expect(withCustom({ texts: { tipTitle: "a".repeat(100000) } }).texts).toEqual({});
    expect(withCustom({ texts: { tipTitle: "   ", tipHint: "", giftHint: 5, giftTitle: null, tipThanks: ["x"], servicesTitle: { a: 1 } } }).texts).toEqual({});
  });

  it("sanitises control, bidi and invisible characters and the gift marker", () => {
    const config = withCustom({ texts: { tipTitle: `a${CH.rlo}b${CH.zwsp}c${CH.bell}d\n e`, tipHint: "x [dyska:abc] y" } });
    expect(config.texts.tipTitle).toBe("abcd e");
    expect(config.texts.tipHint).not.toContain("[dyska:");
  });

  it("keeps HTML as plain text (it is only ever shown through textContent)", () => {
    expect(withCustom({ texts: { tipTitle: "<img src=x onerror=alert(1)>" } }).texts.tipTitle).toBe("<img src=x onerror=alert(1)>");
  });

  it("a non-object texts is ignored", () => {
    for (const bad of ["x", 5, null, ["tipTitle"]]) expect(withCustom({ texts: bad }).texts).toEqual({});
  });
});

describe("textsFor", () => {
  it("without overrides returns the plain default table (unchanged defaults)", () => {
    expect(textsFor("cs").tipTitle).toBe("Přidat spropitné");
    expect(textsFor("cs", {})).toBe(textsFor("cs"));
    expect(textsFor("sk", undefined).tipTitle).toBe("Pridať prepitné");
    expect(textsFor("cs").blockTitle).toBe("");
  });

  it("overrides only the given texts, mapping the config names", () => {
    const text = textsFor("cs", { parcelProtectionName: "Pojištění", priorityShippingName: "Expres", giftPlaceholder: "Napište něco", tipTitle: "Dýško" });
    expect(text).toMatchObject({ parcelProtection: "Pojištění", priorityShipping: "Expres", notePlaceholder: "Napište něco", tipTitle: "Dýško" });
    expect(text.tipHint).toBe(textsFor("cs").tipHint);
    expect(textsFor("cs").parcelProtection).toBe("Ochrana zásilky");
  });

  it("ignores unknown keys and empty values", () => {
    expect(textsFor("sk", { evil: "x", tipTitle: "" })).toBe(textsFor("sk"));
  });
});

describe("view: appearance", () => {
  it("sets the CSS custom properties on the root, only validated values", () => {
    const { view } = build({ appearance: { accentColor: "#AA0000", borderColor: "#00aa00", borderRadius: 3 } });
    expect(view.root.style.getPropertyValue("--dyska-accent")).toBe("#aa0000");
    expect(view.root.style.getPropertyValue("--dyska-border")).toBe("#00aa00");
    expect(view.root.style.getPropertyValue("--dyska-radius")).toBe("3px");
  });

  it("leaves the template defaults alone without appearance and for poisoned values", () => {
    for (const extra of [{}, { appearance: { accentColor: "red; background:url(x)", borderColor: "javascript:x", borderRadius: "9px; x" } }]) {
      const { view } = build(extra);
      expect(view.root.getAttribute("style")).toBeNull();
      view.root.remove();
    }
  });

  it("a hand-built config that bypasses normalizeConfig still cannot inject CSS", () => {
    const config = withCustom({});
    config.appearance = { accentColor: "red; background:url(x)", borderColor: "#12345", borderRadius: 999 };
    const view = createView({ config, text: textsFor("cs"), fmt: String, handlers: {} });
    expect(view.root.getAttribute("style")).toBeNull();
  });

  it("radius 0 is applied", () => {
    expect(build({ appearance: { borderRadius: 0 } }).view.root.style.getPropertyValue("--dyska-radius")).toBe("0px");
  });
});

describe("view: texts", () => {
  it("shows the default texts unchanged without a config text", () => {
    const { view } = build({});
    expect(view.root.querySelector(".dyska-tip .dyska-title").textContent).toBe("Přidat spropitné");
    expect(view.root.querySelector(".dyska-heading")).toBeNull();
    expect(view.root.querySelector(".dyska-services .dyska-service-name").textContent).toBe("Ochrana zásilky");
    expect(view.root.querySelector("textarea").placeholder).toBe("Napište pár slov na kartičku…");
  });

  it("overrides the texts and keeps the rest at the default", () => {
    const { view } = build({
      texts: {
        tipTitle: "Pošlete dýško",
        tipHint: "Děkujeme",
        servicesTitle: "Navíc",
        parcelProtectionName: "Pojištění",
        parcelProtectionHint: "Pro jistotu",
        priorityShippingName: "Expres",
        priorityShippingHint: "Rychle",
        giftTitle: "Přání",
        giftHint: "Napište přání",
        giftPlaceholder: "Zde",
      },
    });
    const q = (s) => view.root.querySelector(s).textContent;
    expect(q(".dyska-tip .dyska-title")).toBe("Pošlete dýško");
    expect(q(".dyska-tip .dyska-hint")).toBe("Děkujeme");
    expect(q(".dyska-services .dyska-title")).toBe("Navíc");
    expect(q(".dyska-service-name")).toBe("Pojištění");
    expect(q(".dyska-service-hint")).toBe("Pro jistotu");
    expect([...view.root.querySelectorAll(".dyska-service-name")].map((n) => n.textContent)).toEqual(["Pojištění", "Expres"]);
    expect(q(".dyska-gift .dyska-title")).toBe("Přání (40 Kč)");
    expect(q(".dyska-gift .dyska-hint")).toBe("Napište přání");
    expect(view.root.querySelector("textarea").placeholder).toBe("Zde");
    expect(view.root.querySelector(".dyska-coins").getAttribute("aria-label")).toBe("Výše spropitného");
  });

  it("the thank-you text is overridden too", () => {
    const config = withCustom({ texts: { tipThanks: "Díky!" } });
    const view = createView({ config, text: textsFor("cs", config.texts), fmt: String, handlers: { onTip: vi.fn() } });
    view.update({ ...STATE, tipCode: "DYSKA-TIP-1000" });
    expect(view.root.querySelector(".dyska-thanks").textContent).toBe("Díky!");
  });

  it("renders the block title and subtitle only when filled", () => {
    const both = build({ texts: { blockTitle: "Doplňky", blockSubtitle: "Vyberte si" } }).view.root;
    expect(both.querySelector(".dyska-heading h2").textContent).toBe("Doplňky");
    expect(both.querySelector(".dyska-heading p").textContent).toBe("Vyberte si");
    expect(both.firstElementChild.className).toBe("dyska-heading");
    document.body.textContent = "";
    const onlyTitle = build({ texts: { blockTitle: "Jen titulek" } }).view.root;
    expect(onlyTitle.querySelector(".dyska-block-title").textContent).toBe("Jen titulek");
    expect(onlyTitle.querySelector(".dyska-block-subtitle")).toBeNull();
    document.body.textContent = "";
    const onlySub = build({ texts: { blockSubtitle: "Jen podnadpis" } }).view.root;
    expect(onlySub.querySelector(".dyska-block-title")).toBeNull();
    expect(onlySub.querySelector(".dyska-block-subtitle").textContent).toBe("Jen podnadpis");
  });

  it("names the region by the visible block title (aria-labelledby), otherwise by the default aria-label", () => {
    const titled = build({ texts: { blockTitle: "Doplňky", blockSubtitle: "Vyberte si" } }).view.root;
    const title = titled.querySelector(".dyska-block-title");
    expect(title.id).toBeTruthy();
    expect(titled.getAttribute("aria-labelledby")).toBe(title.id);
    expect(titled.hasAttribute("aria-label")).toBe(false);
    document.body.textContent = "";
    for (const texts of [{}, { blockSubtitle: "Jen podnadpis" }]) {
      const plain = build({ texts }).view.root;
      expect(plain.getAttribute("aria-label")).toBe("Doplňky k objednávce");
      expect(plain.hasAttribute("aria-labelledby")).toBe(false);
      document.body.textContent = "";
    }
  });

  it("HTML in a text is shown as text, never parsed", () => {
    const evil = "<img src=x onerror=alert(1)><b>x</b>";
    const { view } = build({ texts: { blockTitle: evil, tipTitle: evil, servicesTitle: evil, parcelProtectionName: evil, giftTitle: evil, giftPlaceholder: evil } });
    expect(view.root.querySelector("img")).toBeNull();
    expect(view.root.querySelector("b")).toBeNull();
    expect(view.root.querySelector(".dyska-block-title").textContent).toBe(evil);
    expect(view.root.querySelector(".dyska-tip .dyska-title").textContent).toBe(evil);
    expect(view.root.querySelector("textarea").placeholder).toBe(evil);
  });

  it("works in Slovak with overrides", () => {
    const { view } = build({ texts: { tipTitle: "Dať prepitné" } }, "sk");
    expect(view.root.querySelector(".dyska-tip .dyska-title").textContent).toBe("Dať prepitné");
    expect(view.root.querySelector(".dyska-tip .dyska-hint").textContent).toContain("Poďakujte");
  });
});

describe("end to end: public config with appearance and texts", () => {
  let handle;
  afterEach(() => {
    handle?.destroy();
    handle = null;
    resetDom();
    uninstallShoptet();
    delete globalThis.fetch;
    setPath("/");
  });

  async function boot(config) {
    setPath("/kosik/");
    cartPage();
    installShoptet({ cart: [{ code: "NORM-1", quantity: 1 }] });
    installFetch({ config });
    handle = start({ api: { base: "https://api.example" }, debounceMs: 20, cartOps: { timeoutMs: 400, pollMs: 5, refresh: vi.fn() } });
    await vi.waitFor(() => expect(document.querySelector("[data-dyska-root]")).not.toBeNull());
    return document.querySelector("[data-dyska-root]");
  }

  it("applies the customisation from the backend", async () => {
    const root = await boot({
      ...structuredClone(CONFIG),
      appearance: { accentColor: "#112233", borderRadius: 16 },
      texts: { blockTitle: "Doplňky k objednávce", tipTitle: "Dýško pro tým" },
    });
    expect(root.style.getPropertyValue("--dyska-accent")).toBe("#112233");
    expect(root.style.getPropertyValue("--dyska-radius")).toBe("16px");
    expect(root.style.getPropertyValue("--dyska-border")).toBe("");
    expect(root.querySelector(".dyska-block-title").textContent).toBe("Doplňky k objednávce");
    expect(root.querySelector(".dyska-tip .dyska-title").textContent).toBe("Dýško pro tým");
  });

  it("an old-shaped config (no appearance, no texts) renders the defaults", async () => {
    const root = await boot(structuredClone(CONFIG));
    expect(root.getAttribute("style")).toBeNull();
    expect(root.querySelector(".dyska-heading")).toBeNull();
    expect(root.querySelector(".dyska-tip .dyska-title").textContent).toBe("Přidat spropitné");
  });
});
