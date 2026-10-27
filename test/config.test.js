import { afterEach, describe, expect, it, vi } from "vitest";

import { currencyMatches, loadConfig, normalizeConfig } from "../src/footer/config.js";
import { CONFIG, installFetch } from "./helpers.js";

afterEach(() => {
  delete globalThis.fetch;
});

describe("normalizeConfig", () => {
  it("keeps only ready carriers and sorts the coins", () => {
    const raw = structuredClone(CONFIG);
    raw.carriers.tips.reverse();
    raw.carriers.priorityShipping = null;
    const config = normalizeConfig(raw);
    expect(config.tips.map((t) => t.amount)).toEqual([1000, 2000, 5000, 10000]);
    expect(config.parcelProtection).toEqual({ code: "DYSKA-PROTECTION", price: 2900 });
    expect(config.priorityShipping).toBeNull();
    expect(config.giftCard).toMatchObject({ code: "DYSKA-CARD", price: 4000, maxLength: 120, allowMultiple: true });
  });

  it("rejects inactive, unknown price unit and malformed payloads", () => {
    expect(normalizeConfig({ active: false })).toBeNull();
    expect(normalizeConfig({ ...CONFIG, priceUnit: "major" })).toBeNull();
    expect(normalizeConfig({ ...CONFIG, carriers: null })).toBeNull();
    expect(normalizeConfig(null)).toBeNull();
    expect(normalizeConfig("x")).toBeNull();
  });

  it("returns null when nothing would be shown (no carriers ready)", () => {
    const raw = { ...CONFIG, carriers: { tips: [], parcelProtection: null, priorityShipping: null, giftCard: null } };
    expect(normalizeConfig(raw)).toBeNull();
  });

  it("ignores a service that is disabled in settings or has a bad price", () => {
    const raw = structuredClone(CONFIG);
    raw.parcelProtection.enabled = false;
    raw.priorityShipping.price = -5;
    raw.giftCard.maxLength = 0;
    const config = normalizeConfig(raw);
    expect(config.parcelProtection).toBeNull();
    expect(config.priorityShipping).toBeNull();
    expect(config.giftCard).toBeNull();
  });

  it("drops coins with invalid amounts or codes", () => {
    const raw = structuredClone(CONFIG);
    raw.carriers.tips = [{ amount: 0, code: "X" }, { amount: 1000 }, { amount: 2000, code: "DYSKA-TIP-2000" }];
    expect(normalizeConfig(raw).tips).toEqual([{ amount: 2000, code: "DYSKA-TIP-2000" }]);
  });
});

// The code is used as a cart product code, so a poisoned backend answer must not reach addToCart.
describe("normalizeConfig: poisoned carrier codes", () => {
  const withCarriers = (carriers, extra) => normalizeConfig({ ...structuredClone(CONFIG), ...extra, carriers: { ...structuredClone(CONFIG.carriers), ...carriers } });

  it("drops a tip whose code is not exactly DYSKA-TIP-<amount>", () => {
    const config = withCarriers({
      tips: [
        { amount: 1000, code: "DYSKA-TIP-2000" }, // amount and code disagree
        { amount: 2000, code: "dyska-tip-2000" }, // lower case is not what the backend generates
        { amount: 3000, code: "DYSKA-TIP-3000 " },
        { amount: 4000, code: "DYSKA-TIP-04000" },
        { amount: 5000, code: "DYSKA-TIP-5000" },
        { amount: 12345678, code: "DYSKA-TIP-12345678" }, // more than 7 digits
        { amount: 6000, code: "DYSKA-PROTECTION" },
        { amount: 7000, code: "OTHER-PRODUCT" },
        { amount: 8000, code: "DYSKA-TIP-8000\nDYSKA-CARD" },
        { amount: 9000, code: "<img src=x>" },
        { amount: 1.5, code: "DYSKA-TIP-1.5" },
        { amount: "1000", code: "DYSKA-TIP-1000" },
      ],
    });
    expect(config.tips).toEqual([{ amount: 5000, code: "DYSKA-TIP-5000" }]);
  });

  it("requires the exact code of its own kind for services and the card", () => {
    const config = withCarriers({
      parcelProtection: { code: "DYSKA-PRIORITY" },
      priorityShipping: { code: "DYSKA-TIP-1000" },
      giftCard: { code: "DYSKA-PROTECTION" },
    });
    expect(config.parcelProtection).toBeNull();
    expect(config.priorityShipping).toBeNull();
    expect(config.giftCard).toBeNull();
    expect(config.tips).toHaveLength(4);
  });

  it("drops a code that is used twice (the first claim wins)", () => {
    const config = withCarriers({
      tips: [
        { amount: 1000, code: "DYSKA-TIP-1000" },
        { amount: 1000, code: "DYSKA-TIP-1000" },
        { amount: 2000, code: "DYSKA-TIP-2000" },
      ],
    });
    expect(config.tips.map((t) => t.code)).toEqual(["DYSKA-TIP-1000", "DYSKA-TIP-2000"]);
  });

  it("returns null when every code is poisoned, so the block is not shown at all", () => {
    expect(
      withCarriers({
        tips: [{ amount: 1000, code: "EVIL" }],
        parcelProtection: { code: "EVIL" },
        priorityShipping: { code: "EVIL" },
        giftCard: { code: "EVIL" },
      }),
    ).toBeNull();
  });

  it("ignores non-string codes and malformed carrier objects", () => {
    const config = withCarriers({ tips: [null, 5, { amount: 1000, code: 1000 }, { amount: 2000, code: "DYSKA-TIP-2000" }], parcelProtection: "x", priorityShipping: { code: null }, giftCard: [] });
    expect(config.tips).toHaveLength(1);
    expect(config.parcelProtection).toBeNull();
    expect(config.priorityShipping).toBeNull();
    expect(config.giftCard).toBeNull();
  });
});

describe("loadConfig", () => {
  it("requests the public config for the e-shop with a response.ok check and no credentials", async () => {
    const { requests } = installFetch();
    const config = await loadConfig("123456", { base: "https://api.example" });
    expect(config.tips).toHaveLength(4);
    expect(requests[0].url).toBe("https://api.example/api/v1/public/config?eshopId=123456");
    expect(requests[0].init.credentials).toBe("omit");
  });

  it("returns null for a non-2xx response", async () => {
    installFetch({ configStatus: 500 });
    await expect(loadConfig("123456")).resolves.toBeNull();
  });

  it("returns null when the backend says the add-on is inactive", async () => {
    installFetch({ config: { active: false } });
    await expect(loadConfig("123456")).resolves.toBeNull();
  });

  it("returns null (no exception) on a network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("network down");
    });
    await expect(loadConfig("123456")).resolves.toBeNull();
  });

  it("aborts and returns null after the timeout", async () => {
    globalThis.fetch = vi.fn(
      (url, init) =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    await expect(loadConfig("123456", { timeoutMs: 20 })).resolves.toBeNull();
  });

  it("the timeout also covers reading the body", async () => {
    globalThis.fetch = vi.fn(async (url, init) => ({
      ok: true,
      status: 200,
      json: () =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    }));
    await expect(loadConfig("123456", { timeoutMs: 20 })).resolves.toBeNull();
  });
});

describe("currencyMatches", () => {
  const config = { currency: null };
  it("expects CZK for Czech and EUR for Slovak shops", () => {
    expect(currencyMatches(config, "CZK", "cs")).toBe(true);
    expect(currencyMatches(config, "EUR", "cs")).toBe(false);
    expect(currencyMatches(config, "EUR", "sk")).toBe(true);
    expect(currencyMatches(config, "CZK", "sk")).toBe(false);
    expect(currencyMatches(config, null, "cs")).toBe(false);
  });

  it("trusts a currency named by the backend", () => {
    expect(currencyMatches({ currency: "EUR" }, "EUR", "cs")).toBe(true);
    expect(currencyMatches({ currency: "EUR" }, "CZK", "cs")).toBe(false);
  });
});
