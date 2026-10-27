import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createGiftStore, createNotesSync } from "../src/footer/notes.js";
import { REF, REF2, installFetch, refN } from "./helpers.js";

const OPTIONS = { base: "https://api.example" };

afterEach(() => {
  vi.useRealTimers();
  delete globalThis.fetch;
  window.sessionStorage.clear();
});

describe("createGiftStore", () => {
  it("persists to sessionStorage and restores for the same e-shop only", () => {
    const store = createGiftStore("1");
    store.setTexts(["Ahoj"]);
    store.setRef(REF);
    expect(createGiftStore("1").get()).toMatchObject({ ref: REF, texts: ["Ahoj"] });
    expect(createGiftStore("2").get()).toMatchObject({ ref: null, texts: [] });
  });

  it("works in memory when sessionStorage throws", () => {
    const broken = {
      getItem() {
        throw new Error("denied");
      },
      setItem() {
        throw new Error("denied");
      },
      removeItem() {
        throw new Error("denied");
      },
    };
    const store = createGiftStore("1", broken);
    store.setTexts(["Ahoj"]);
    store.setRef(REF);
    expect(store.get().texts).toEqual(["Ahoj"]);
    expect(() => store.clear()).not.toThrow();
    const without = createGiftStore("1", null);
    without.setTexts(["x"]);
    expect(without.get().texts).toEqual(["x"]);
  });

  it("ignores corrupt stored data", () => {
    window.sessionStorage.setItem("dyska:gift", "{not json");
    expect(createGiftStore("1").get().texts).toEqual([]);
    window.sessionStorage.setItem("dyska:gift", JSON.stringify({ eshopId: "1", texts: ["a"], ref: "bad ref" }));
    expect(createGiftStore("1").get()).toMatchObject({ texts: ["a"], ref: null });
  });
});

describe("createNotesSync", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  function setup(initialTexts, fetchOptions, syncOptions) {
    const http = installFetch(fetchOptions);
    const store = createGiftStore("123456");
    store.setTexts(initialTexts);
    const sync = createNotesSync({
      eshopId: "123456",
      store,
      getNotes: () => store.get().texts.filter((t) => t !== ""),
      debounceMs: 700,
      apiOptions: OPTIONS,
      ...syncOptions,
    });
    return { requests: http.requests, http, store, sync };
  }

  it("debounces typing into one PUT and stores the ref issued by the server", async () => {
    const { requests, store, sync } = setup(["A"]);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(300);
    store.setTexts(["Ah"]);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(300);
    store.setTexts(["Ahoj"]);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(699);
    expect(requests).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2);
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ method: "PUT", url: "https://api.example/api/v1/public/notes" });
    expect(requests[0].body).toEqual({ eshopId: "123456", notes: ["Ahoj"] });
    expect(store.get()).toMatchObject({ ref: REF, synced: true });
  });

  it("sends the known ref on the next PUT so the server overwrites instead of creating a note", async () => {
    const { requests, store, sync } = setup(["Ahoj"]);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    store.setTexts(["Ahoj světe"]);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    expect(requests[1].body).toEqual({ eshopId: "123456", ref: REF, notes: ["Ahoj světe"] });
  });

  it("sends DELETE and forgets the ref when the text is cleared", async () => {
    const { requests, store, sync } = setup(["Ahoj"]);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    store.setTexts([""]);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    expect(requests[1]).toMatchObject({ method: "DELETE", body: { eshopId: "123456", ref: REF } });
    expect(store.get().ref).toBeNull();
  });

  it("sends nothing when there is neither text nor ref", async () => {
    const { requests, sync } = setup([""]);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    expect(requests).toHaveLength(0);
  });

  it("keeps one request in flight and sends the latest text afterwards, with the ref of the first", async () => {
    const { requests, store, sync } = setup(["A"]);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) => {
      if (requests.length === 0) await gate;
      return original(url, init);
    });
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    store.setTexts(["AB"]);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(requests).toHaveLength(2);
    expect(requests[1].body.ref).toBe(REF);
    expect(requests[1].body.notes).toEqual(["AB"]);
  });

  it("never throws on a failed request and marks the state as not synced", async () => {
    installFetch({ notesStatus: 500 });
    const store = createGiftStore("123456");
    store.setTexts(["Ahoj"]);
    const sync = createNotesSync({ eshopId: "123456", store, getNotes: () => ["Ahoj"], debounceMs: 10, apiOptions: OPTIONS });
    sync.schedule();
    await vi.advanceTimersByTimeAsync(20);
    expect(store.get()).toMatchObject({ ref: null, synced: false });
  });

  it("flushOnLeave sends pending text with keepalive", async () => {
    const { requests, sync } = setup(["Ahoj"]);
    sync.schedule();
    sync.flushOnLeave();
    await vi.advanceTimersByTimeAsync(5);
    expect(requests).toHaveLength(1);
    expect(requests[0].init.keepalive).toBe(true);
  });

  it("takes over a new ref when the server does not know the one it sent (expired or consumed)", async () => {
    const { requests, store, sync } = setup(["Ahoj"], { ref: REF2 });
    store.setRef(REF);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    expect(requests[0].body.ref).toBe(REF);
    expect(store.get()).toMatchObject({ ref: REF2, synced: true });
    store.setTexts(["Ahoj světe"]);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    expect(requests[1].body.ref).toBe(REF2);
    expect(store.get().ref).toBe(REF2);
  });

  it("issues a fresh ref after DELETE: the old one is not known to the server any more", async () => {
    const { requests, store, sync } = setup(["Ahoj"]);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    store.setTexts([""]);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    store.setTexts(["Znovu"]);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    expect(requests[2].body.ref).toBeUndefined();
    expect(store.get().ref).toBe(refN(2));
  });

  it("429 with Retry-After: retries after that many seconds, not before", async () => {
    const { requests, http, store, sync } = setup(["Ahoj"]);
    http.fail(429, { retryAfter: 5, reason: "rate_limit" });
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    expect(requests).toHaveLength(1);
    expect(store.get().synced).toBe(false);
    await vi.advanceTimersByTimeAsync(4900);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(requests).toHaveLength(2);
    expect(store.get()).toMatchObject({ ref: REF, synced: true });
  });

  it("429 without a usable header waits for the default delay; a date header is understood", async () => {
    const { requests, http, sync } = setup(["Ahoj"]);
    http.fail(429, { reason: "capacity" });
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    await vi.advanceTimersByTimeAsync(29000);
    expect(requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1500);
    expect(requests).toHaveLength(2);
    const dated = setup(["Ahoj"]);
    dated.http.fail(429, { retryAfter: new Date(Date.now() + 10000).toUTCString() });
    dated.sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    await vi.advanceTimersByTimeAsync(7000);
    expect(dated.requests).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(4000);
    expect(dated.requests).toHaveLength(2);
  });

  it("429 capacity three times in a row stops sending until the page is loaded again", async () => {
    const { requests, http, store, sync } = setup(["Ahoj"]);
    for (let i = 0; i < 5; i += 1) http.fail(429, { reason: "capacity" });
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    await vi.advanceTimersByTimeAsync(31000);
    await vi.advanceTimersByTimeAsync(31000);
    expect(requests).toHaveLength(3);
    await vi.advanceTimersByTimeAsync(300000);
    store.setTexts(["Ahoj světe"]);
    sync.schedule();
    sync.flushOnLeave();
    await vi.advanceTimersByTimeAsync(5000);
    await sync.flush();
    expect(requests).toHaveLength(3);
    expect(store.get().synced).toBe(false);
  });

  it("a successful request or another 429 reason resets the capacity counter", async () => {
    const { requests, http, store, sync } = setup(["Ahoj"]);
    http.fail(429, { reason: "capacity" });
    http.fail(429, { reason: "capacity" });
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    await vi.advanceTimersByTimeAsync(62000);
    expect(requests).toHaveLength(3);
    expect(store.get().synced).toBe(true);
    http.fail(429, { reason: "capacity" });
    http.fail(429, { retryAfter: 1, reason: "rate_limit" });
    http.fail(429, { reason: "capacity" });
    store.setTexts(["Jiný"]);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    await vi.advanceTimersByTimeAsync(40000);
    await vi.advanceTimersByTimeAsync(40000);
    expect(requests.length).toBeGreaterThanOrEqual(7);
    expect(store.get().synced).toBe(true);
  });

  it("a long Retry-After is capped", async () => {
    const { requests, http, sync } = setup(["Ahoj"]);
    http.fail(429, { retryAfter: 86400 });
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    await vi.advanceTimersByTimeAsync(121000);
    expect(requests).toHaveLength(2);
  });

  it("400 is final for that text: no retry, but a changed text is sent", async () => {
    const { requests, http, store, sync } = setup(["Ahoj"]);
    http.fail(400, { reason: "invalid" });
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    await sync.flush();
    await vi.advanceTimersByTimeAsync(200000);
    expect(requests).toHaveLength(1);
    expect(store.get().synced).toBe(false);
    store.setTexts(["Jiný text"]);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    expect(requests).toHaveLength(2);
    expect(store.get().synced).toBe(true);
  });

  it("404 unavailable: reports it once and sends nothing any more", async () => {
    const onUnavailable = vi.fn();
    const { requests, http, store, sync } = setup(["Ahoj"], undefined, { onUnavailable });
    http.fail(404, { reason: "unavailable" });
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    store.setTexts(["Ahoj světe"]);
    sync.schedule();
    sync.flushOnLeave();
    await vi.advanceTimersByTimeAsync(5000);
    await sync.flush();
    expect(requests).toHaveLength(1);
    expect(onUnavailable).toHaveBeenCalledTimes(1);
  });

  it("5xx and network errors stay 'not synced' without scheduling a storm of retries", async () => {
    const { requests, http, store, sync } = setup(["Ahoj"]);
    http.fail(503);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    await vi.advanceTimersByTimeAsync(60000);
    expect(requests).toHaveLength(1);
    expect(store.get().synced).toBe(false);
  });

  it("flushOnLeave while a request is running hands keepalive to the follow-up request", async () => {
    const { requests, store, sync } = setup(["A"]);
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const original = globalThis.fetch;
    globalThis.fetch = vi.fn(async (url, init) => {
      if (requests.length === 0) await gate;
      return original(url, init);
    });
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch.mock.calls[0][1].keepalive).toBe(false);
    store.setTexts(["AB"]);
    sync.flushOnLeave(); // the page is going away while the first request is still running
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(requests).toHaveLength(2);
    expect(requests[0].init.keepalive).toBe(false);
    expect(requests[1].init.keepalive).toBe(true);
    expect(requests[1].body.notes).toEqual(["AB"]);
  });

  it("flushOnLeave sends nothing when everything is already synced and idle", async () => {
    const { requests, sync } = setup(["Ahoj"]);
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    sync.flushOnLeave();
    await vi.advanceTimersByTimeAsync(10);
    expect(requests).toHaveLength(1);
  });

  it("cancel stops a pending retry", async () => {
    const { requests, http, sync } = setup(["Ahoj"]);
    http.fail(429, { retryAfter: 3 });
    sync.schedule();
    await vi.advanceTimersByTimeAsync(700);
    sync.cancel();
    await vi.advanceTimersByTimeAsync(10000);
    expect(requests).toHaveLength(1);
  });
});
