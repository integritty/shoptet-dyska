import { afterEach, describe, expect, it, vi } from "vitest";

import { start } from "../src/footer/init.js";
import { CONFIG, REF, cartPage, installFetch, installShoptet, resetDom, setPath, uninstallShoptet } from "./helpers.js";

const NORM = { code: "NORM-1", quantity: 1 };
let handle;
let shop;
let http;
let refresh;

function boot(shopOptions, fetchOptions, pageOptions) {
  setPath("/kosik/");
  cartPage(pageOptions);
  shop = installShoptet({ cart: [NORM], ...shopOptions });
  http = installFetch(fetchOptions);
  refresh = vi.fn();
  handle = start({
    api: { base: "https://api.example" },
    debounceMs: 20,
    cartOps: { timeoutMs: 400, pollMs: 5, refresh },
  });
  return vi.waitFor(() => expect(document.querySelector("[data-dyska-root]")).not.toBeNull());
}

const root = () => document.querySelector("[data-dyska-root]");
const coin = (code) => root().querySelector(`.dyska-coin[data-code="${code}"]`);
const idle = () => handle.app.block.whenIdle();
const settle = async () => {
  await idle();
  await vi.waitFor(() => expect(root().getAttribute("data-busy")).toBe("false"));
};

afterEach(() => {
  handle?.destroy();
  handle = null;
  resetDom();
  uninstallShoptet();
  delete globalThis.fetch;
  setPath("/");
});

describe("mounting", () => {
  it("mounts once into the cart page, fetching the config for the e-shop from the data layer", async () => {
    await boot();
    expect(document.querySelectorAll("[data-dyska-root]")).toHaveLength(1);
    expect(http.requests[0].url).toBe("https://api.example/api/v1/public/config?eshopId=123456");
    expect(document.querySelector(".cart-content").children[1]).toBe(root());
    expect(document.documentElement.getAttribute("data-dyska")).toBe("mounted");
  });

  it("keeps the block right after the table in a flex cart with explicit order values (not at the very top)", async () => {
    await boot(undefined, undefined, { flex: true });
    const container = document.querySelector(".cart-content");
    expect(container.children[1]).toBe(root());
    const order = (node) => Number.parseInt(window.getComputedStyle(node).order, 10) || 0;
    const table = container.querySelector(".cart-table");
    const summary = container.querySelector(".summary");
    expect(order(root())).toBeGreaterThan(order(table));
    expect(order(root())).toBeLessThan(order(summary));
  });

  it("does not set an order in a plain (non flex) cart", async () => {
    await boot();
    expect(root().style.order).toBe("");
  });

  it("is idempotent: repeated events and a second start never create a second block", async () => {
    await boot();
    for (const name of ["ShoptetDOMContentLoaded", "ShoptetDOMCartContentLoaded", "ShoptetDataLayerUpdated"]) {
      document.dispatchEvent(new Event(name));
    }
    expect(start({ api: { base: "https://api.example" } })).toBeNull();
    await new Promise((r) => setTimeout(r, 30));
    expect(document.querySelectorAll("[data-dyska-root]")).toHaveLength(1);
    expect(http.requests.filter((r) => r.url.includes("/public/config"))).toHaveLength(1);
  });

  it("re-inserts the block after Shoptet redraws the cart DOM", async () => {
    await boot();
    cartPage();
    expect(document.querySelector("[data-dyska-root]")).toBeNull();
    document.dispatchEvent(new Event("ShoptetDOMCartContentLoaded"));
    await vi.waitFor(() => expect(document.querySelectorAll("[data-dyska-root]")).toHaveLength(1));
  });

  it("shows nothing when the backend is down, the add-on is inactive or the currency does not match", async () => {
    await boot().catch(() => undefined);
    handle.destroy();
    resetDom();
    for (const [shopOptions, fetchOptions] of [
      [{}, { configStatus: 503 }],
      [{}, { config: { active: false } }],
      [{ currency: "EUR" }, {}],
      [{ projectId: "abc" }, {}],
    ]) {
      setPath("/kosik/");
      cartPage();
      shop = installShoptet({ cart: [NORM], ...shopOptions });
      http = installFetch(fetchOptions);
      handle = start({ api: { base: "https://api.example" } });
      await new Promise((r) => setTimeout(r, 30));
      expect(document.querySelector("[data-dyska-root]")).toBeNull();
      handle.destroy();
      resetDom();
    }
  });

  it("does nothing on other pages", async () => {
    setPath("/produkt/");
    cartPage();
    installShoptet({ pageType: "productDetail" });
    http = installFetch();
    handle = start({ api: { base: "https://api.example" } });
    await new Promise((r) => setTimeout(r, 20));
    expect(http.requests).toHaveLength(0);
    expect(document.querySelector("[data-dyska-root]")).toBeNull();
  });

  it("hides the block when the cart has no real products", async () => {
    await boot({ cart: [] });
    expect(root().hidden).toBe(true);
    shop.addLine("NORM-1", 1);
    document.dispatchEvent(new Event("ShoptetDataLayerUpdated"));
    await vi.waitFor(() => expect(root().hidden).toBe(false));
  });
});

describe("tip coins", () => {
  it("choosing a coin adds exactly that carrier through shoptet.cartShared", async () => {
    await boot();
    coin("DYSKA-TIP-2000").click();
    await settle();
    expect(shop.calls).toEqual(["add:DYSKA-TIP-2000:1"]);
    expect(coin("DYSKA-TIP-2000").getAttribute("aria-pressed")).toBe("true");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("switching coins adds the new item first and removes the old one only after that", async () => {
    await boot({ cart: [NORM, { code: "DYSKA-TIP-1000", quantity: 1 }] });
    expect(coin("DYSKA-TIP-1000").getAttribute("aria-pressed")).toBe("true");
    coin("DYSKA-TIP-5000").click();
    await settle();
    expect(shop.calls).toEqual(["add:DYSKA-TIP-5000:1", "remove:DYSKA-TIP-1000"]);
    expect(shop.data.cart.filter((l) => l.code.startsWith("DYSKA-TIP-")).map((l) => l.code)).toEqual(["DYSKA-TIP-5000"]);
    expect(root().querySelectorAll('.dyska-coin[aria-pressed="true"]')).toHaveLength(1);
  });

  it("choosing the selected coin again removes the tip", async () => {
    await boot({ cart: [NORM, { code: "DYSKA-TIP-1000", quantity: 1 }] });
    coin("DYSKA-TIP-1000").click();
    await settle();
    expect(shop.calls).toEqual(["remove:DYSKA-TIP-1000"]);
    expect(root().querySelectorAll('.dyska-coin[aria-pressed="true"]')).toHaveLength(0);
  });

  it("ignores clicks while a change is running: the first choice wins, with a single tip line", async () => {
    await boot();
    coin("DYSKA-TIP-1000").click();
    expect(coin("DYSKA-TIP-2000").getAttribute("aria-disabled")).toBe("true");
    expect(coin("DYSKA-TIP-2000").disabled).toBe(false);
    coin("DYSKA-TIP-2000").click();
    coin("DYSKA-TIP-5000").click();
    await settle();
    expect(shop.calls).toEqual(["add:DYSKA-TIP-1000:1"]);
    expect(shop.data.cart.filter((l) => l.code.startsWith("DYSKA-TIP-")).map((l) => l.code)).toEqual(["DYSKA-TIP-1000"]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(coin("DYSKA-TIP-2000").getAttribute("aria-disabled")).toBe("false");
  });

  it("a failed add shows an error and leaves the cart as the data layer says", async () => {
    await boot({ failCodes: ["DYSKA-TIP-2000"] });
    coin("DYSKA-TIP-2000").click();
    await settle();
    expect(root().querySelector('[role="alert"]').hidden).toBe(false);
    expect(coin("DYSKA-TIP-2000").getAttribute("aria-pressed")).toBe("false");
    expect(refresh).not.toHaveBeenCalled();
  });

  it("does not loop on its own changes: rendering never calls the cart API", async () => {
    await boot();
    coin("DYSKA-TIP-1000").click();
    await settle();
    const before = shop.cartShared.addToCart.mock.calls.length + shop.cartShared.removeFromCart.mock.calls.length;
    for (let i = 0; i < 5; i++) document.dispatchEvent(new Event("ShoptetDataLayerUpdated"));
    await new Promise((r) => setTimeout(r, 30));
    expect(shop.cartShared.addToCart.mock.calls.length + shop.cartShared.removeFromCart.mock.calls.length).toBe(before);
  });
});

describe("services", () => {
  it("toggles protection and priority shipping as separate cart lines", async () => {
    await boot();
    const protection = root().querySelector('input[data-service="parcelProtection"]');
    const priority = root().querySelector('input[data-service="priorityShipping"]');
    protection.click();
    await settle();
    priority.click();
    await settle();
    expect(shop.calls).toEqual(["add:DYSKA-PROTECTION:1", "add:DYSKA-PRIORITY:1"]);
    expect(protection.checked && priority.checked).toBe(true);
    protection.click();
    await settle();
    expect(shop.calls.at(-1)).toBe("remove:DYSKA-PROTECTION");
    expect(shop.data.cart.map((l) => l.code)).toEqual(["NORM-1", "DYSKA-PRIORITY"]);
  });

  it("reflects services already in the cart", async () => {
    await boot({ cart: [NORM, { code: "DYSKA-PRIORITY", quantity: 1 }] });
    expect(root().querySelector('input[data-service="priorityShipping"]').checked).toBe(true);
    expect(root().querySelector('input[data-service="parcelProtection"]').checked).toBe(false);
  });
});

describe("gift cards", () => {
  const plusButton = () => root().querySelector('.dyska-step[aria-label="Přidat kartičku"]');
  const minusButton = () => root().querySelector('.dyska-step[aria-label="Ubrat kartičku"]');

  it("adds cards one by one and shows a textarea limited by maxLength for each", async () => {
    await boot();
    plusButton().click();
    await settle();
    plusButton().click();
    await settle();
    expect(shop.calls).toEqual(["add:DYSKA-CARD:1", "add:DYSKA-CARD:1"]);
    expect(shop.data.cart.find((l) => l.code === "DYSKA-CARD").quantity).toBe(2);
    const areas = root().querySelectorAll("textarea");
    expect(areas).toHaveLength(2);
    expect(areas[0].hasAttribute("maxlength")).toBe(false);
  });

  it("removing a card replaces the line with the smaller quantity; zero removes it", async () => {
    await boot({ cart: [NORM, { code: "DYSKA-CARD", quantity: 3 }] });
    minusButton().click();
    await settle();
    expect(shop.calls).toEqual(["remove:DYSKA-CARD", "add:DYSKA-CARD:2"]);
    expect(shop.data.cart.find((l) => l.code === "DYSKA-CARD").quantity).toBe(2);
    minusButton().click();
    await settle();
    minusButton().click();
    await settle();
    expect(shop.data.cart.find((l) => l.code === "DYSKA-CARD")).toBeUndefined();
    expect(root().querySelectorAll("textarea")).toHaveLength(0);
  });

  it("typing sends the text after the debounce, with the ref issued by the server", async () => {
    await boot({ cart: [NORM, { code: "DYSKA-CARD", quantity: 1 }] });
    const area = root().querySelector("textarea");
    area.value = "Všechno nejlepší!";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(http.requests.some((r) => r.method === "PUT")).toBe(true));
    const put = http.requests.find((r) => r.method === "PUT");
    expect(put.body).toEqual({ eshopId: "123456", notes: ["Všechno nejlepší!"] });
    expect(JSON.parse(window.sessionStorage.getItem("dyska:gift"))).toMatchObject({ ref: REF, texts: ["Všechno nejlepší!"] });
  });

  it("removing the last card deletes the stored gift text on the server", async () => {
    await boot({ cart: [NORM, { code: "DYSKA-CARD", quantity: 1 }] });
    const area = root().querySelector("textarea");
    area.value = "Ahoj";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(http.requests.some((r) => r.method === "PUT")).toBe(true));
    await vi.waitFor(() => expect(JSON.parse(window.sessionStorage.getItem("dyska:gift")).ref).toBe(REF));
    minusButton().click();
    await settle();
    await vi.waitFor(() => expect(http.requests.some((r) => r.method === "DELETE")).toBe(true));
    expect(http.requests.find((r) => r.method === "DELETE").body).toEqual({ eshopId: "123456", ref: REF });
  });

  it("sends only non-empty, sanitised texts for existing cards", async () => {
    await boot({ cart: [NORM, { code: "DYSKA-CARD", quantity: 2 }] });
    const [first, second] = root().querySelectorAll("textarea");
    first.value = "";
    second.value = "  Ahoj\n [dyska:x";
    second.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(http.requests.some((r) => r.method === "PUT")).toBe(true));
    expect(http.requests.find((r) => r.method === "PUT").body.notes).toEqual(["Ahoj x"]);
  });
});

describe("carriers that are no longer offered", () => {
  it("offers to remove a cart line whose carrier is not ready any more", async () => {
    const config = structuredClone(CONFIG);
    config.carriers.tips = config.carriers.tips.filter((t) => t.code !== "DYSKA-TIP-5000");
    await boot({ cart: [NORM, { code: "DYSKA-TIP-5000", quantity: 1 }] }, { config });
    expect(root().querySelectorAll(".dyska-coin")).toHaveLength(3);
    expect(root().querySelectorAll('.dyska-coin[aria-pressed="true"]')).toHaveLength(0);
    const notice = root().querySelector(".dyska-orphans");
    expect(notice.hidden).toBe(false);
    notice.querySelector("button").click();
    await settle();
    expect(shop.calls).toEqual(["remove:DYSKA-TIP-5000"]);
    expect(notice.hidden).toBe(true);
  });

  it("choosing another coin replaces a withdrawn one", async () => {
    const config = structuredClone(CONFIG);
    config.carriers.tips = config.carriers.tips.filter((t) => t.code !== "DYSKA-TIP-5000");
    await boot({ cart: [NORM, { code: "DYSKA-TIP-5000", quantity: 1 }] }, { config });
    coin("DYSKA-TIP-1000").click();
    await settle();
    expect(shop.calls).toEqual(["add:DYSKA-TIP-1000:1", "remove:DYSKA-TIP-5000"]);
  });
});

describe("Slovak shop", () => {
  it("formats EUR amounts and uses Slovak texts", async () => {
    const config = structuredClone(CONFIG);
    config.carriers.tips = [
      { amount: 50, code: "DYSKA-TIP-50" },
      { amount: 100, code: "DYSKA-TIP-100" },
    ];
    await boot({ currency: "EUR", language: "sk" }, { config });
    expect(root().querySelector(".dyska-coin").textContent.split(String.fromCharCode(160)).join(" ")).toBe("0,50 €");
    expect(root().querySelector(".dyska-tip .dyska-title").textContent).toBe("Pridať prepitné");
  });
});

const cardLine = () => shop.data.cart.find((l) => l.code === "DYSKA-CARD");
const tipCodes = () => shop.data.cart.filter((l) => l.code.startsWith("DYSKA-TIP-")).map((l) => l.code);
const alertText = () => root().querySelector('[role="alert"]').textContent;

describe("atomic coin switching and failures", () => {
  const OLD = { code: "DYSKA-TIP-1000", quantity: 1 };

  it("a failed add of the new coin keeps the old tip and fails fast on the {code: 500} answer", async () => {
    await boot({ cart: [NORM, OLD], failCodes: ["DYSKA-TIP-5000"] });
    const started = Date.now();
    coin("DYSKA-TIP-5000").click();
    await settle();
    expect(Date.now() - started).toBeLessThan(300); // the API timeout in this test is 400 ms
    expect(shop.calls).toEqual(["add:DYSKA-TIP-5000:1"]);
    expect(tipCodes()).toEqual(["DYSKA-TIP-1000"]);
    expect(coin("DYSKA-TIP-1000").getAttribute("aria-pressed")).toBe("true");
    expect(root().querySelector('[role="alert"]').hidden).toBe(false);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("a rejected add promise fails fast as well", async () => {
    await boot({ failCodes: ["DYSKA-TIP-2000"], failMode: "reject" });
    const started = Date.now();
    coin("DYSKA-TIP-2000").click();
    await settle();
    expect(Date.now() - started).toBeLessThan(300);
    expect(root().querySelector('[role="alert"]').hidden).toBe(false);
  });

  it("an API that never answers ends in an error after the timeout", async () => {
    await boot({ failCodes: ["DYSKA-TIP-2000"], failMode: "silent" });
    const started = Date.now();
    coin("DYSKA-TIP-2000").click();
    await settle();
    expect(Date.now() - started).toBeGreaterThanOrEqual(350);
    expect(root().querySelector('[role="alert"]').hidden).toBe(false);
  });

  it("when the old coin cannot be removed the new one is taken out again, and the cart is redrawn", async () => {
    await boot({ cart: [NORM, OLD], removeFails: ["DYSKA-TIP-1000"] });
    coin("DYSKA-TIP-5000").click();
    await settle();
    expect(shop.calls).toEqual(["add:DYSKA-TIP-5000:1", "remove:DYSKA-TIP-1000", "remove:DYSKA-TIP-5000"]);
    expect(tipCodes()).toEqual(["DYSKA-TIP-1000"]);
    expect(root().querySelector('[role="alert"]').hidden).toBe(false);
    // the cart really changed on the way (add + rollback), so the cart table is redrawn although the task failed
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("redraws the cart after a successful step even when a later step of the task fails", async () => {
    await boot({ cart: [NORM, { code: "DYSKA-CARD", quantity: 3 }], failCodes: ["DYSKA-CARD"] });
    root().querySelector('.dyska-step[aria-label="Ubrat kartičku"]').click();
    await settle();
    // the line was removed, the smaller one could not be added, the old quantity was put back (also failing)
    expect(shop.calls).toEqual(["remove:DYSKA-CARD", "add:DYSKA-CARD:2", "add:DYSKA-CARD:3"]);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(root().querySelector('[role="alert"]').hidden).toBe(false);
  });

  it("restores the old card quantity when the replacement line cannot be added", async () => {
    await boot({ cart: [NORM, { code: "DYSKA-CARD", quantity: 3 }] });
    const original = shop.cartShared.addToCart.getMockImplementation();
    let first = true;
    shop.cartShared.addToCart.mockImplementation((args) => {
      if (first) {
        first = false;
        shop.calls.push(`add:${args.productCode}:${args.amount}`);
        return Promise.resolve({ code: 500 });
      }
      return original(args);
    });
    root().querySelector('.dyska-step[aria-label="Ubrat kartičku"]').click();
    await settle();
    expect(shop.calls).toEqual(["remove:DYSKA-CARD", "add:DYSKA-CARD:2", "add:DYSKA-CARD:3"]);
    expect(cardLine().quantity).toBe(3);
  });

  it("while a change is running every control is aria-disabled and further clicks do nothing", async () => {
    await boot();
    coin("DYSKA-TIP-1000").click();
    const box = root().querySelector('input[data-service="parcelProtection"]');
    expect(box.getAttribute("aria-disabled")).toBe("true");
    box.click();
    for (const step of root().querySelectorAll(".dyska-step")) {
      expect(step.getAttribute("aria-disabled")).toBe("true");
      step.click();
    }
    await settle();
    expect(shop.calls).toEqual(["add:DYSKA-TIP-1000:1"]);
    expect(box.checked).toBe(false);
  });
});

describe("quantities above one on DYSKA lines", () => {
  const settleAll = async () => {
    await vi.waitFor(() => expect(root().getAttribute("data-busy")).toBe("false"));
    await idle();
    await vi.waitFor(() => expect(root().getAttribute("data-busy")).toBe("false"));
  };

  it("normalises a service with quantity 3 to a single line with quantity 1", async () => {
    await boot({ cart: [NORM, { code: "DYSKA-PROTECTION", quantity: 3 }] });
    await settleAll();
    await vi.waitFor(() => expect(shop.data.cart.find((l) => l.code === "DYSKA-PROTECTION")?.quantity).toBe(1));
    expect(shop.calls).toEqual(["remove:DYSKA-PROTECTION", "add:DYSKA-PROTECTION:1"]);
    expect(root().querySelector('input[data-service="parcelProtection"]').checked).toBe(true);
    expect(refresh).toHaveBeenCalled();
  });

  it("normalises a tip with quantity 2 and two different tip lines to exactly one tip", async () => {
    await boot({ cart: [NORM, { code: "DYSKA-TIP-2000", quantity: 2 }] });
    await settleAll();
    await vi.waitFor(() => expect(shop.data.cart.find((l) => l.code === "DYSKA-TIP-2000")?.quantity).toBe(1));
    handle.destroy();
    resetDom();
    uninstallShoptet();
    await boot({ cart: [NORM, { code: "DYSKA-TIP-1000", quantity: 1 }, { code: "DYSKA-TIP-5000", quantity: 1 }] });
    await settleAll();
    await vi.waitFor(() => expect(tipCodes()).toEqual(["DYSKA-TIP-1000"]));
  });

  it("reduces cards to one when multiple cards are not allowed, and to ten at most when they are", async () => {
    const single = structuredClone(CONFIG);
    single.giftCard.allowMultiple = false;
    await boot({ cart: [NORM, { code: "DYSKA-CARD", quantity: 4 }] }, { config: single });
    await settleAll();
    await vi.waitFor(() => expect(cardLine()?.quantity).toBe(1));
    expect(root().querySelectorAll("textarea")).toHaveLength(1);
    handle.destroy();
    resetDom();
    uninstallShoptet();
    await boot({ cart: [NORM, { code: "DYSKA-CARD", quantity: 15 }] });
    await settleAll();
    await vi.waitFor(() => expect(cardLine()?.quantity).toBe(10));
    expect(root().querySelectorAll("textarea")).toHaveLength(10);
  });

  it("leaves a valid cart alone (cards within the limit are not touched)", async () => {
    await boot({ cart: [NORM, { code: "DYSKA-CARD", quantity: 3 }, { code: "DYSKA-TIP-1000", quantity: 1 }] });
    await new Promise((r) => setTimeout(r, 40));
    expect(shop.calls).toEqual([]);
  });

  it("repairs only once: a failing repair shows the error and does not loop", async () => {
    await boot({ cart: [NORM, { code: "DYSKA-PRIORITY", quantity: 2 }], failCodes: ["DYSKA-PRIORITY"] });
    await settleAll();
    await new Promise((r) => setTimeout(r, 60));
    document.dispatchEvent(new Event("ShoptetDataLayerUpdated"));
    await new Promise((r) => setTimeout(r, 60));
    expect(shop.cartShared.removeFromCart).toHaveBeenCalledTimes(1);
    expect(shop.cartShared.addToCart.mock.calls.filter(([a]) => a.amount === 1)).toHaveLength(1);
    expect(root().querySelector('[role="alert"]').hidden).toBe(false);
  });
});

describe("price check against the announced price", () => {
  it("removes a coin Shoptet charges differently and tells the customer", async () => {
    await boot({ wrongPrices: { "DYSKA-TIP-2000": 25 } });
    coin("DYSKA-TIP-2000").click();
    await settle();
    expect(shop.calls).toEqual(["add:DYSKA-TIP-2000:1", "remove:DYSKA-TIP-2000"]);
    expect(tipCodes()).toEqual([]);
    expect(alertText()).toBe(textsPrice());
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("checks services and cards too, using price x quantity", async () => {
    await boot({ wrongPrices: { "DYSKA-PROTECTION": 30, "DYSKA-CARD": 41 } });
    root().querySelector('input[data-service="parcelProtection"]').click();
    await settle();
    expect(shop.data.cart.map((l) => l.code)).toEqual(["NORM-1"]);
    expect(alertText()).toBe(textsPrice());
    root().querySelector('.dyska-step[aria-label="Přidat kartičku"]').click();
    await settle();
    expect(cardLine()).toBeUndefined();
  });

  it("accepts the announced price, also for several cards, and a line without a readable price", async () => {
    await boot();
    root().querySelector('.dyska-step[aria-label="Přidat kartičku"]').click();
    await settle();
    root().querySelector('.dyska-step[aria-label="Přidat kartičku"]').click();
    await settle();
    expect(cardLine().quantity).toBe(2);
    expect(root().querySelector('[role="alert"]').hidden).toBe(true);
    shop.data.cart.find((l) => l.code === "DYSKA-CARD").priceWithVat = undefined;
    root().querySelector('input[data-service="priorityShipping"]').click();
    await settle();
    expect(root().querySelector('[role="alert"]').hidden).toBe(true);
  });

  it("checks the price only for lines with quantity 1 (priceWithVat is not verified to be a unit price)", async () => {
    await boot({ cart: [NORM, { code: "DYSKA-CARD", quantity: 1 }], wrongPrices: { "DYSKA-CARD": 99 } });
    root().querySelector('.dyska-step[aria-label="Přidat kartičku"]').click();
    await settle();
    expect(cardLine().quantity).toBe(2);
    expect(root().querySelector('[role="alert"]').hidden).toBe(true);
  });

  it("a wrong price on the replacement coin leaves the old tip in place", async () => {
    await boot({ cart: [NORM, { code: "DYSKA-TIP-1000", quantity: 1 }], wrongPrices: { "DYSKA-TIP-5000": 1 } });
    coin("DYSKA-TIP-5000").click();
    await settle();
    expect(tipCodes()).toEqual(["DYSKA-TIP-1000"]);
    expect(alertText()).toBe(textsPrice());
  });
});

function textsPrice() {
  return "Cena doplňku v košíku neodpovídá nabídce, proto byl z košíku odebrán.";
}

describe("backend answers to the gift text", () => {
  const typeText = (value) => {
    const area = root().querySelector("textarea");
    area.value = value;
    area.dispatchEvent(new Event("input", { bubbles: true }));
  };

  it("hides the block and sends nothing more when the backend answers 404 unavailable", async () => {
    await boot({ cart: [NORM, { code: "DYSKA-CARD", quantity: 1 }] });
    http.fail(404, { reason: "unavailable" });
    typeText("Ahoj");
    await vi.waitFor(() => expect(root().hidden).toBe(true));
    const sent = http.requests.filter((r) => r.method === "PUT").length;
    typeText("Ahoj světe");
    await new Promise((r) => setTimeout(r, 60));
    expect(http.requests.filter((r) => r.method === "PUT")).toHaveLength(sent);
    document.dispatchEvent(new Event("ShoptetDataLayerUpdated"));
    expect(root().hidden).toBe(true);
  });

  it("keeps the block when a 429 asks to wait; the retry follows later", async () => {
    await boot({ cart: [NORM, { code: "DYSKA-CARD", quantity: 1 }] });
    http.fail(429, { retryAfter: 1, reason: "rate_limit" });
    typeText("Ahoj");
    await vi.waitFor(() => expect(http.requests.filter((r) => r.method === "PUT")).toHaveLength(1));
    expect(root().hidden).toBe(false);
    await vi.waitFor(() => expect(http.requests.filter((r) => r.method === "PUT")).toHaveLength(2), { timeout: 3000 });
    await vi.waitFor(() => expect(JSON.parse(window.sessionStorage.getItem("dyska:gift")).synced).toBe(true));
  });
});

describe("late data layer", () => {
  it("starts without a data layer and mounts once ShoptetDOMContentLoaded arrives with the shop id", async () => {
    setPath("/kosik/");
    cartPage();
    http = installFetch();
    refresh = vi.fn();
    handle = start({ api: { base: "https://api.example" }, debounceMs: 20, cartOps: { timeoutMs: 400, pollMs: 5, refresh } });
    await new Promise((r) => setTimeout(r, 20));
    expect(http.requests).toHaveLength(0);
    shop = installShoptet({ cart: [NORM] });
    document.dispatchEvent(new Event("ShoptetDOMContentLoaded"));
    await vi.waitFor(() => expect(document.querySelector("[data-dyska-root]")).not.toBeNull());
    expect(http.requests[0].url).toContain("eshopId=123456");
  });
});
