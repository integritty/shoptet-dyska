import { vi } from "vitest";

export const REF = "AbCdEfGhIjKlMnOpQrStUv";

export const CONFIG = {
  active: true,
  priceUnit: "minor",
  tipCoins: [1000, 2000, 5000, 10000],
  parcelProtection: { enabled: true, price: 2900 },
  priorityShipping: { enabled: true, price: 7900 },
  giftCard: { enabled: true, price: 4000, maxLength: 120, allowMultiple: true },
  carriers: {
    tips: [
      { amount: 1000, code: "DYSKA-TIP-1000" },
      { amount: 2000, code: "DYSKA-TIP-2000" },
      { amount: 5000, code: "DYSKA-TIP-5000" },
      { amount: 10000, code: "DYSKA-TIP-10000" },
    ],
    parcelProtection: { code: "DYSKA-PROTECTION" },
    priorityShipping: { code: "DYSKA-PRIORITY" },
    giftCard: { code: "DYSKA-CARD" },
  },
};

// Characters that cannot be typed through the editor tooling safely.
export const CH = {
  rlo: String.fromCharCode(0x202e),
  zwsp: String.fromCharCode(0x200b),
  bell: String.fromCharCode(7),
  zwj: String.fromCharCode(0x200d),
  shy: String.fromCharCode(0xad),
};

export function setPath(path) {
  window.history.pushState({}, "", path);
}

export const REF2 = "ZyXwVuTsRqPoNmLkJiHgFe";

// A 22-character ref that differs per number (the server issues a new one for an unknown ref).
export const refN = (n) => `Ref${String(n).padStart(19, "0")}`;

// What Shoptet charges per unit (major units) for the carrier products, as the backend announces them in CONFIG.
function defaultPrice(code) {
  const tip = /^DYSKA-TIP-(\d+)$/.exec(code);
  if (tip) return Number(tip[1]) / 100;
  return { "DYSKA-PROTECTION": 29, "DYSKA-PRIORITY": 79, "DYSKA-CARD": 40 }[code] ?? 100;
}

// Fake Shoptet storefront: data layer, getShoptetDataLayer and a cartShared that mutates the data layer
// asynchronously and fires ShoptetDataLayerUpdated, like the real one. Like the real API, addToCart and
// removeFromCart return a promise that resolves with {code: 200|500} (HTTP 200 even for a failure).
//   failCodes     add of these codes fails; `failMode`: "code500" (resolves {code: 500}), "reject", "silent" (never answers)
//   removeFails   remove of lines with these codes fails the same way
//   wrongPrices   {code: unit price} charged instead of the announced one
export function installShoptet(options) {
  const opts = {
    cart: [],
    currency: "CZK",
    language: "cs",
    projectId: "123456",
    pageType: "cart",
    failCodes: [],
    removeFails: [],
    failMode: "code500",
    wrongPrices: {},
    ...options,
  };
  let nextId = 1;
  const shoptetData = {
    projectId: opts.projectId,
    currency: opts.currency,
    language: opts.language,
    pageType: opts.pageType,
    cart: [],
  };
  const calls = [];
  const priceOf = (code) => opts.wrongPrices[code] ?? defaultPrice(code);
  const addLine = (code, quantity) => {
    const existing = shoptetData.cart.find((l) => l.code === code);
    if (existing) existing.quantity += quantity;
    else {
      shoptetData.cart.push({ code, quantity, itemId: `item${nextId}`, priceId: `price${nextId++}`, guid: `g${nextId}`, priceWithVat: priceOf(code) });
    }
  };
  for (const line of opts.cart) addLine(line.code, line.quantity || 1);
  const update = (fn) =>
    setTimeout(() => {
      fn();
      document.dispatchEvent(new Event("ShoptetDataLayerUpdated"));
    }, 0);
  const answer = (fails, then) => {
    if (!fails) {
      then();
      return Promise.resolve({ code: 200, payload: {} });
    }
    if (opts.failMode === "silent") return undefined;
    if (opts.failMode === "reject") return Promise.reject(new Error("network"));
    return Promise.resolve({ code: 500, message: "error" });
  };
  const cartShared = {
    addToCart: vi.fn(({ productCode, amount }) => {
      calls.push(`add:${productCode}:${amount}`);
      return answer(opts.failCodes.includes(productCode), () => update(() => addLine(productCode, amount)));
    }),
    removeFromCart: vi.fn(({ itemId }) => {
      const code = shoptetData.cart.find((l) => l.itemId === itemId)?.code;
      calls.push(`remove:${code}`);
      return answer(opts.removeFails.includes(code), () =>
        update(() => {
          shoptetData.cart = shoptetData.cart.filter((l) => l.itemId !== itemId);
        }),
      );
    }),
    updateQuantityInCart: vi.fn(),
  };
  globalThis.dataLayer = [{ shoptet: shoptetData }];
  globalThis.getShoptetDataLayer = (key) => (key ? shoptetData[key] : shoptetData);
  globalThis.shoptet = { cartShared, cart: { getCartContent: vi.fn() }, custom: {} };
  return { data: shoptetData, calls, cartShared, addLine };
}

export function uninstallShoptet() {
  delete globalThis.dataLayer;
  delete globalThis.getShoptetDataLayer;
  delete globalThis.shoptet;
}

// Minimal cart page markup containing one mount target.
// `flex: true` mimics a template that lays the cart out as a flex column with explicit `order` values.
export function cartPage(options = {}) {
  document.body.textContent = "";
  const content = document.createElement("div");
  content.className = "cart-content";
  const table = document.createElement("div");
  table.className = "cart-table";
  content.appendChild(table);
  if (options.flex) {
    content.style.display = "flex";
    content.style.flexDirection = "column";
    table.style.order = "1";
    const summary = document.createElement("div");
    summary.className = "summary";
    summary.style.order = "4";
    content.appendChild(summary);
  }
  document.body.appendChild(content);
}

// fetch mock of the backend: config, PUT /notes and DELETE /notes. `requests` records everything.
// Like the real server, PUT keeps a ref it issued and answers an unknown / missing ref with a new one
// (the first is `ref`, then refN(2), refN(3)...). `fail(status, {retryAfter, reason})` makes the next notes
// request fail (400 invalid, 404 unavailable, 429 + Retry-After seconds, 5xx); `knownRefs` are refs the server has.
export function installFetch(options) {
  const opts = { config: CONFIG, ref: REF, configStatus: 200, notesStatus: 200, knownRefs: [], ...options };
  const requests = [];
  const known = new Set(opts.knownRefs);
  const failures = [];
  let issued = 0;
  const issue = () => {
    issued += 1;
    return issued === 1 ? opts.ref : refN(issued);
  };
  const json = (data, status, headers) => ({
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => (headers && headers[name.toLowerCase()]) ?? null },
    json: async () => data,
  });
  const fn = vi.fn(async (url, init) => {
    const method = (init && init.method) || "GET";
    const body = init && init.body ? JSON.parse(init.body) : undefined;
    requests.push({ url: String(url), method, body, init });
    if (String(url).includes("/public/config")) return json(opts.config, opts.configStatus);
    const failure = failures.shift() || (opts.notesStatus === 200 ? null : { status: opts.notesStatus });
    if (failure) {
      const headers = failure.retryAfter === undefined ? {} : { "retry-after": String(failure.retryAfter) };
      return json({ reason: failure.reason || "error" }, failure.status, headers);
    }
    if (method === "PUT") {
      const ref = body.ref && known.has(body.ref) ? body.ref : issue();
      known.add(ref);
      return json({ ref, count: body.notes.length, expiresAt: "x" }, 200);
    }
    known.delete(body.ref);
    return json(null, 204);
  });
  globalThis.fetch = fn;
  return {
    fn,
    requests,
    known,
    fail: (status, extra) => failures.push({ status, ...extra }),
  };
}

export function resetDom() {
  document.documentElement.removeAttribute("data-dyska");
  document.body.textContent = "";
  document.head.querySelectorAll("style[data-dyska-style]").forEach((n) => n.remove());
  window.sessionStorage.clear();
}
