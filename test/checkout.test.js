import { afterEach, describe, expect, it, vi } from "vitest";

import { start } from "../src/footer/init.js";
import { REF, REF2, cartPage, installFetch, installShoptet, resetDom, setPath, uninstallShoptet } from "./helpers.js";

let handle;

function giftState(extra) {
  window.sessionStorage.setItem(
    "dyska:gift",
    JSON.stringify({ eshopId: "123456", ref: REF, texts: ["Ahoj", "Čau"], cardCode: "DYSKA-CARD", maxLength: 120, synced: true, ...extra }),
  );
}

let http;

function stepTwo(options) {
  setPath("/objednavka/krok-2/");
  document.body.textContent = "";
  const form = document.createElement("form");
  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.id = "add-note";
  const remark = document.createElement("textarea");
  remark.id = "remark";
  remark.name = "remark";
  if (options && options.maxLength) remark.maxLength = options.maxLength;
  remark.value = (options && options.remark) || "";
  form.append(toggle, remark);
  document.body.appendChild(form);
  const shop = installShoptet({
    pageType: "orderStep2",
    cart: [{ code: "NORM-1", quantity: 1 }, ...(((options && options.cards) ?? 2) > 0 ? [{ code: "DYSKA-CARD", quantity: (options && options.cards) ?? 2 }] : [])],
  });
  if (options && options.previous) shoptet.custom.postSuccessfulValidation = options.previous;
  http = installFetch(options && options.fetch);
  for (const failure of (options && options.failures) || []) http.fail(failure.status, failure);
  handle = start({ api: { base: "https://api.example" }, debounceMs: 10 });
  return { form, remark, toggle, shop };
}

afterEach(() => {
  handle?.destroy();
  handle = null;
  resetDom();
  uninstallShoptet();
  delete globalThis.fetch;
  setPath("/");
});

describe("step 2: gift text into #remark", () => {
  it("writes the fragment on successful validation and keeps what the customer typed", () => {
    giftState();
    const { remark, form } = stepTwo({ remark: "Zvoňte dvakrát" });
    expect(remark.value).toBe("Zvoňte dvakrát");
    expect(shoptet.custom.postSuccessfulValidation(form)).toBe(true);
    expect(remark.value).toBe(`Zvoňte dvakrát\nVěnování 1: Ahoj\nVěnování 2: Čau\n[dyska:${REF}]`);
  });

  it("is idempotent across repeated hook calls, submit events and later cart events", () => {
    giftState();
    const { remark, form } = stepTwo();
    shoptet.custom.postSuccessfulValidation(form);
    const first = remark.value;
    shoptet.custom.postSuccessfulValidation(form);
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    document.dispatchEvent(new Event("ShoptetDOMContentLoaded"));
    shoptet.custom.postSuccessfulValidation(form);
    expect(remark.value).toBe(first);
    expect(remark.value.match(/\[dyska:/g)).toHaveLength(1);
  });

  it("chains onto an existing hook: calls it once and returns its result", () => {
    giftState();
    const previous = vi.fn(() => true);
    const { form, remark } = stepTwo({ previous });
    document.dispatchEvent(new Event("ShoptetDOMContentLoaded"));
    expect(shoptet.custom.postSuccessfulValidation(form)).toBe(true);
    expect(previous).toHaveBeenCalledTimes(1);
    expect(previous).toHaveBeenCalledWith(form);
    expect(remark.value).toContain(`[dyska:${REF}]`);
  });

  it("respects a hook that blocks the submit and survives a hook that throws on our side", () => {
    giftState();
    const { form } = stepTwo({ previous: () => false });
    expect(shoptet.custom.postSuccessfulValidation(form)).toBe(false);
  });

  it("re-wraps when another script replaces the hook later", () => {
    giftState();
    const { form, remark } = stepTwo();
    const replacement = vi.fn(() => true);
    shoptet.custom.postSuccessfulValidation = replacement;
    document.dispatchEvent(new Event("ShoptetDOMContentLoaded"));
    shoptet.custom.postSuccessfulValidation(form);
    expect(replacement).toHaveBeenCalledTimes(1);
    expect(remark.value).toContain("Věnování 1: Ahoj");
  });

  it("falls back to the submit event when the template never calls the hook", () => {
    giftState();
    const { form, remark } = stepTwo();
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(remark.value).toBe(`Věnování 1: Ahoj\nVěnování 2: Čau\n[dyska:${REF}]`);
  });

  it("opens the note field when it is collapsed and notifies listeners", () => {
    giftState();
    const { form, remark, toggle } = stepTwo();
    toggle.addEventListener("click", () => {});
    const changed = vi.fn();
    remark.addEventListener("change", changed);
    shoptet.custom.postSuccessfulValidation(form);
    expect(toggle.checked).toBe(true);
    expect(changed).toHaveBeenCalled();
  });

  it("uses only as many texts as there are cards in the cart", () => {
    giftState();
    const { form, remark } = stepTwo({ cards: 1 });
    shoptet.custom.postSuccessfulValidation(form);
    expect(remark.value).toBe(`Věnování: Ahoj\n[dyska:${REF}]`);
  });

  it("removes only our fragment when the card was removed from the cart", () => {
    giftState();
    const { form, remark } = stepTwo({ cards: 0, remark: `Zvoňte\nVěnování 1: Ahoj\n[dyska:${REF}]` });
    shoptet.custom.postSuccessfulValidation(form);
    expect(remark.value).toBe("Zvoňte");
  });

  it("does not touch a remark when there is no gift state (including the customer's own 'Věnování')", () => {
    const { form, remark } = stepTwo({ remark: "Věnování: pro babičku" });
    shoptet.custom.postSuccessfulValidation(form);
    expect(remark.value).toBe("Věnování: pro babičku");
  });

  it("keeps the remark within its length limit and keeps the marker", () => {
    giftState();
    const { form, remark } = stepTwo({ maxLength: 70, remark: "x".repeat(200) });
    shoptet.custom.postSuccessfulValidation(form);
    expect(remark.value.length).toBeLessThanOrEqual(70);
    expect(remark.value.endsWith(`[dyska:${REF}]`)).toBe(true);
  });

  it("writes the visible text without a marker when the backend never issued a ref", () => {
    giftState({ ref: null, synced: false, texts: ["Ahoj"] });
    const { form, remark } = stepTwo({ cards: 1 });
    shoptet.custom.postSuccessfulValidation(form);
    expect(remark.value).toBe("Věnování: Ahoj");
    shoptet.custom.postSuccessfulValidation(form);
    expect(remark.value).toBe("Věnování: Ahoj");
  });

  it("never throws into the order flow when #remark is missing", () => {
    giftState();
    const { form } = stepTwo();
    document.querySelector("#remark").remove();
    expect(() => shoptet.custom.postSuccessfulValidation(form)).not.toThrow();
  });
});

describe("from the cart to step 2", () => {
  it("text typed in the cart reaches #remark on step 2 with the server ref", async () => {
    setPath("/kosik/");
    cartPage();
    installShoptet({ cart: [{ code: "NORM-1", quantity: 1 }, { code: "DYSKA-CARD", quantity: 1 }] });
    const http = installFetch();
    handle = start({ api: { base: "https://api.example" }, debounceMs: 10 });
    await vi.waitFor(() => expect(document.querySelector("textarea")).not.toBeNull());
    const area = document.querySelector("textarea");
    area.value = "Všechno nejlepší!";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(http.requests.some((r) => r.method === "PUT")).toBe(true));
    await vi.waitFor(() => expect(JSON.parse(window.sessionStorage.getItem("dyska:gift")).ref).toBe(REF));
    handle.destroy();
    document.documentElement.removeAttribute("data-dyska");
    const { form, remark } = stepTwo();
    shoptet.custom.postSuccessfulValidation(form);
    expect(remark.value).toBe(`Věnování: Všechno nejlepší!\n[dyska:${REF}]`);
  });

  it("clears the stored gift on the thank-you page", () => {
    giftState();
    setPath("/objednavka/dekujeme/");
    installShoptet({ pageType: "thankYou" });
    handle = start({});
    expect(window.sessionStorage.getItem("dyska:gift")).toBeNull();
  });
});

const stored = () => JSON.parse(window.sessionStorage.getItem("dyska:gift"));

describe("step 2: the customer's own lines and double writes", () => {
  it("never deletes a customer line that starts with 'Věnování' (marked fragment, double write, card removed)", () => {
    giftState({ texts: ["Ahoj"] });
    const own = "Věnování: pro babičku";
    const { form, remark } = stepTwo({ cards: 1, remark: own });
    shoptet.custom.postSuccessfulValidation(form);
    expect(remark.value).toBe(`${own}\nVěnování: Ahoj\n[dyska:${REF}]`);
    shoptet.custom.postSuccessfulValidation(form);
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(remark.value).toBe(`${own}\nVěnování: Ahoj\n[dyska:${REF}]`);
    document.querySelector("#remark").value = remark.value;
    handle.destroy();
    resetDom();
    giftState({ texts: ["Ahoj"] });
    const again = stepTwo({ cards: 0, remark: `${own}\nVěnování: Ahoj\n[dyska:${REF}]` });
    shoptet.custom.postSuccessfulValidation(again.form);
    expect(again.remark.value).toBe(own);
  });

  it("keeps a customer 'Věnování' line when we write an unmarked fragment, and on a repeated write", () => {
    giftState({ ref: null, synced: false, texts: ["Ahoj"] });
    const own = "Věnování: pro babičku";
    const { form, remark } = stepTwo({ cards: 1, remark: own });
    shoptet.custom.postSuccessfulValidation(form);
    expect(remark.value).toBe(`Věnování: Ahoj\n${own}`);
    shoptet.custom.postSuccessfulValidation(form);
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(remark.value).toBe(`Věnování: Ahoj\n${own}`);
  });

  it("with cards but no text it leaves the customer's remark alone", () => {
    giftState({ texts: [] });
    const { form, remark } = stepTwo({ cards: 1, remark: "Věnování: pro babičku" });
    shoptet.custom.postSuccessfulValidation(form);
    expect(remark.value).toBe("Věnování: pro babičku");
  });
});

describe("step 2: text that never reached the backend (synced: false)", () => {
  it("writes the visible text without the marker, although an old ref is stored", () => {
    giftState({ synced: false, texts: ["Nový text"] });
    const { form, remark } = stepTwo({ cards: 1, fetch: { notesStatus: 503 } });
    shoptet.custom.postSuccessfulValidation(form);
    expect(remark.value).toBe("Věnování: Nový text");
    expect(remark.value).not.toContain("[dyska:");
    expect(stored().written).toBe("Věnování: Nový text");
  });

  it("tries to send the text again when step 2 opens, and writes the marker with the new ref afterwards", async () => {
    giftState({ synced: false, texts: ["Nový text"] });
    // the server does not know REF any more (expired), so it issues REF2
    const { form, remark } = stepTwo({ cards: 1, fetch: { ref: REF2 } });
    shoptet.custom.postSuccessfulValidation(form);
    expect(remark.value).toBe("Věnování: Nový text");
    await vi.waitFor(() => expect(stored()).toMatchObject({ ref: REF2, synced: true }));
    expect(http.requests[0]).toMatchObject({ method: "PUT", body: { ref: REF, notes: ["Nový text"] } });
    shoptet.custom.postSuccessfulValidation(form);
    expect(remark.value).toBe(`Věnování: Nový text\n[dyska:${REF2}]`);
    expect(stored().written).toBeNull();
    expect(remark.value.match(/Věnování/g)).toHaveLength(1);
  });

  it("retries only once per page and keeps writing the unmarked text while the backend stays down", async () => {
    giftState({ synced: false, texts: ["Ahoj"] });
    const { form, remark } = stepTwo({ cards: 1, fetch: { notesStatus: 500 } });
    await vi.waitFor(() => expect(http.requests).toHaveLength(1));
    for (let i = 0; i < 3; i += 1) document.dispatchEvent(new Event("ShoptetDOMContentLoaded"));
    await new Promise((r) => setTimeout(r, 40));
    expect(http.requests).toHaveLength(1);
    shoptet.custom.postSuccessfulValidation(form);
    expect(remark.value).toBe("Věnování: Ahoj");
  });

  it("does not resend anything when the stored state is synced", async () => {
    giftState();
    stepTwo();
    await new Promise((r) => setTimeout(r, 40));
    expect(http.requests).toHaveLength(0);
  });

  it("a rate-limited retry (429) is attempted again later and the marker follows", async () => {
    giftState({ synced: false, texts: ["Ahoj"] });
    const { form, remark } = stepTwo({ cards: 1, failures: [{ status: 429, retryAfter: 1 }] });
    shoptet.custom.postSuccessfulValidation(form);
    expect(remark.value).toBe("Věnování: Ahoj");
    await vi.waitFor(() => expect(http.requests).toHaveLength(2), { timeout: 4000 });
    await vi.waitFor(() => expect(stored().synced).toBe(true));
    shoptet.custom.postSuccessfulValidation(form);
    expect(remark.value).toMatch(/^Věnování: Ahoj\n\[dyska:[A-Za-z0-9_-]{22}\]$/);
  });
});

describe("step 2: coming back to the step", () => {
  it("does not duplicate an unmarked fragment that is still in #remark after a page change", () => {
    giftState({ ref: null, synced: false, texts: ["Ahoj"] });
    const first = stepTwo({ cards: 1, remark: "Zvoňte" });
    shoptet.custom.postSuccessfulValidation(first.form);
    const written = first.remark.value;
    expect(written).toBe("Věnování: Ahoj\nZvoňte");
    // back to the cart and forward again: a new page, the stored state survives, Shoptet restores the remark
    handle.destroy();
    document.body.textContent = "";
    const second = stepTwo({ cards: 1, remark: written });
    shoptet.custom.postSuccessfulValidation(second.form);
    expect(second.remark.value).toBe(written);
    expect(second.remark.value.match(/Věnování/g)).toHaveLength(1);
  });

  it("replaces an old unmarked fragment when the text changed meanwhile, and a marked one when a ref exists", () => {
    giftState({ ref: null, synced: false, texts: ["Ahoj"] });
    const first = stepTwo({ cards: 1, remark: "Zvoňte" });
    shoptet.custom.postSuccessfulValidation(first.form);
    const written = first.remark.value;
    handle.destroy();
    document.body.textContent = "";
    window.sessionStorage.setItem("dyska:gift", JSON.stringify({ ...stored(), texts: ["Jiný text"], ref: REF, synced: true }));
    const second = stepTwo({ cards: 1, remark: written });
    shoptet.custom.postSuccessfulValidation(second.form);
    expect(second.remark.value).toBe(`Zvoňte\nVěnování: Jiný text\n[dyska:${REF}]`);
  });

  it("removes a stale unmarked fragment when the card was removed in the meantime", () => {
    giftState({ ref: null, synced: false, texts: ["Ahoj"] });
    const first = stepTwo({ cards: 1, remark: "Zvoňte" });
    shoptet.custom.postSuccessfulValidation(first.form);
    handle.destroy();
    document.body.textContent = "";
    const second = stepTwo({ cards: 0, remark: first.remark.value });
    shoptet.custom.postSuccessfulValidation(second.form);
    expect(second.remark.value).toBe("Zvoňte");
  });
});

describe("step 2: the validation hook is never wrapped endlessly", () => {
  it("does the work once when a foreign script wraps our hook again and again", () => {
    giftState();
    const { form, remark } = stepTwo();
    const calls = [];
    for (let i = 0; i < 20; i += 1) {
      const inner = shoptet.custom.postSuccessfulValidation;
      shoptet.custom.postSuccessfulValidation = function foreign(...args) {
        calls.push(i);
        return inner.apply(this, args);
      };
      document.dispatchEvent(new Event("ShoptetDOMContentLoaded"));
    }
    expect(shoptet.custom.postSuccessfulValidation(form)).toBe(true);
    // the remark is written once (no duplicate fragment) and every foreign layer ran exactly once
    expect(remark.value).toBe(`Věnování 1: Ahoj\nVěnování 2: Čau\n[dyska:${REF}]`);
    expect(calls).toHaveLength(20);
  });

  it("stops wrapping after a few replacements and never wraps its own wrapper", () => {
    giftState();
    stepTwo();
    const own = shoptet.custom.postSuccessfulValidation;
    for (let i = 0; i < 5; i += 1) document.dispatchEvent(new Event("ShoptetDOMContentLoaded"));
    expect(shoptet.custom.postSuccessfulValidation).toBe(own);
    let replacements = 0;
    for (let i = 0; i < 10; i += 1) {
      shoptet.custom.postSuccessfulValidation = () => true;
      document.dispatchEvent(new Event("ShoptetDOMContentLoaded"));
      if (shoptet.custom.postSuccessfulValidation.name === "postSuccessfulValidation") replacements += 1;
    }
    expect(replacements).toBeLessThanOrEqual(3);
  });
});

describe("step 2: language and unreadable cart", () => {
  it("the data layer language wins over <html lang>", () => {
    giftState({ texts: ["Ahoj"] });
    const { form, remark } = stepTwo({ cards: 1 });
    document.documentElement.setAttribute("lang", "sk");
    shoptet.custom.postSuccessfulValidation(form);
    // the data layer says cs and wins over <html lang>
    expect(remark.value).toBe(`Věnování: Ahoj\n[dyska:${REF}]`);
    document.documentElement.removeAttribute("lang");
  });

  it("uses <html lang> when the data layer has no language", () => {
    giftState({ texts: ["Ahoj"] });
    const { form, remark } = stepTwo({ cards: 1 });
    globalThis.getShoptetDataLayer = (key) => (key === "language" ? undefined : { projectId: "123456", cart: [{ code: "DYSKA-CARD", quantity: 1 }] }[key]);
    globalThis.dataLayer = [{ shoptet: { projectId: "123456", cart: [{ code: "DYSKA-CARD", quantity: 1 }] } }];
    document.documentElement.setAttribute("lang", "sk-SK");
    shoptet.custom.postSuccessfulValidation(form);
    document.documentElement.removeAttribute("lang");
    expect(remark.value).toBe(`Venovanie: Ahoj\n[dyska:${REF}]`);
  });

  it("with an unreadable cart it writes only text that is synced and has a ref", () => {
    giftState({ texts: ["Ahoj"], synced: true });
    const ok = stepTwo({ cards: 1 });
    delete globalThis.getShoptetDataLayer;
    globalThis.dataLayer = [{ shoptet: { projectId: "123456" } }];
    shoptet.custom.postSuccessfulValidation(ok.form);
    expect(ok.remark.value).toBe(`Věnování: Ahoj\n[dyska:${REF}]`);

    handle.destroy();
    giftState({ texts: ["Ahoj"], synced: false });
    const unsynced = stepTwo({ cards: 1, fetch: { notesStatus: 503 } });
    delete globalThis.getShoptetDataLayer;
    globalThis.dataLayer = [{ shoptet: { projectId: "123456" } }];
    shoptet.custom.postSuccessfulValidation(unsynced.form);
    expect(unsynced.remark.value).toBe("");

    handle.destroy();
    giftState({ texts: ["Ahoj"], ref: null, synced: true });
    const noRef = stepTwo({ cards: 1 });
    delete globalThis.getShoptetDataLayer;
    globalThis.dataLayer = [{ shoptet: { projectId: "123456" } }];
    shoptet.custom.postSuccessfulValidation(noRef.form);
    expect(noRef.remark.value).toBe("");
  });
});
