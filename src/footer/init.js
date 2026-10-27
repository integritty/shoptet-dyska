import { createBlock } from "./block.js";
import { createCartOps } from "./cart-ops.js";
import { createCheckout } from "./checkout.js";
import { currencyMatches, loadConfig } from "./config.js";
import { CART_EVENTS, CONFIG_RETRY_MS, DEFAULT_CARD_CODE, MAX_CARDS, ROOT_ATTR } from "./constants.js";
import { sanitizeNote } from "./format.js";
import { createGiftStore, createNotesSync } from "./notes.js";
import { detectPage, getCurrency, getEshopId, getLanguage, quantityOf, readCartLines, readDataLayer } from "./shoptet.js";

const DEFAULT_MAX_LENGTH = 250;

// Sanitised, non-empty gift texts for the given number of cards (null = unknown cart, take all stored texts).
function notesFromStore(store, cards) {
  const state = store.get();
  const max = state.maxLength || DEFAULT_MAX_LENGTH;
  const limit = cards === null || cards === undefined ? MAX_CARDS : Math.min(cards, MAX_CARDS);
  return state.texts
    .slice(0, limit)
    .map((raw) => sanitizeNote(raw, max))
    .filter((note) => note !== "");
}

// Number of cards in the cart, or null when the cart is not readable (then all stored texts count).
function cardsInCart(code) {
  const lines = readCartLines();
  return lines ? quantityOf(lines, code) : null;
}

// Loads the config and builds the block. Returns null (block simply not shown) on any problem.
async function buildBlock(eshopId, store, options) {
  const config = await loadConfig(eshopId, options.api);
  const language = getLanguage();
  const currency = getCurrency();
  if (!config || !currencyMatches(config, currency, language)) return null;
  let block = null;
  const notesSync = createNotesSync({
    eshopId,
    store,
    getNotes: () => notesFromStore(store, config.giftCard ? quantityOf(readCartLines() || [], config.giftCard.code) : 0),
    debounceMs: options.debounceMs,
    apiOptions: options.api,
    onUnavailable: () => block && block.markUnavailable(),
  });
  block = createBlock({ config, language, currency, ops: options.ops || createCartOps(options.cartOps), store, notesSync });
  return { block, notesSync };
}

// Starts the add-on once per page. The marker attribute on <html> stops a second copy of the script
// (or a second call) from creating a second block; events only re-run the idempotent `run`.
export function start(deps) {
  const options = deps || {};
  const html = document.documentElement;
  if (html.hasAttribute(ROOT_ATTR)) return null;
  html.setAttribute(ROOT_ATTR, "pending");

  // The data layer may not exist yet when the script starts; it is read again on every Shoptet event.
  let eshopId = getEshopId();
  const app = { block: null, notesSync: null, loading: false, failedAt: 0, checkout: null, store: null, destroyed: false };
  const getStore = () => app.store || (app.store = createGiftStore(eshopId, options.storage));

  async function mountBlock() {
    if (app.loading || app.block || app.destroyed) return;
    if (app.failedAt && Date.now() - app.failedAt < CONFIG_RETRY_MS) return;
    app.loading = true;
    const built = await buildBlock(eshopId, getStore(), options).catch(() => null);
    app.loading = false;
    if (app.destroyed) return;
    if (!built) {
      app.failedAt = Date.now();
      return;
    }
    app.block = built.block;
    app.notesSync = built.notesSync;
    html.setAttribute(ROOT_ATTR, "mounted");
    app.block.sync();
  }

  // Step 2 has no config: a text that never reached the backend is sent again from here, before the remark is written.
  function createStepTwo() {
    const store = getStore();
    app.notesSync = createNotesSync({
      eshopId,
      store,
      getNotes: () => notesFromStore(store, cardsInCart(store.get().cardCode || DEFAULT_CARD_CODE)),
      debounceMs: options.debounceMs,
      apiOptions: options.api,
    });
    return createCheckout({
      store,
      getNotes: (cards) => notesFromStore(store, cards),
      resync: () => app.notesSync.flush(),
    });
  }

  function run() {
    if (app.destroyed) return;
    if (!eshopId) eshopId = getEshopId();
    if (!eshopId) return;
    const page = detectPage(window.location.pathname, readDataLayer("pageType"));
    if (page === "cart") {
      if (app.block) app.block.sync();
      else mountBlock();
    } else if (page === "step2") {
      if (!app.checkout) app.checkout = createStepTwo();
      app.checkout.install();
    } else if (page === "thankyou") {
      getStore().clear();
    }
  }

  const onLeave = () => app.notesSync && app.notesSync.flushOnLeave();
  const onVisibility = () => document.visibilityState === "hidden" && onLeave();
  const onEvent = () => run();
  for (const name of CART_EVENTS) document.addEventListener(name, onEvent);
  window.addEventListener("pagehide", onLeave);
  document.addEventListener("visibilitychange", onVisibility);
  run();

  return {
    run,
    app,
    destroy() {
      app.destroyed = true;
      for (const name of CART_EVENTS) document.removeEventListener(name, onEvent);
      window.removeEventListener("pagehide", onLeave);
      document.removeEventListener("visibilitychange", onVisibility);
      if (app.notesSync) app.notesSync.cancel();
      if (app.block) app.block.view.root.remove();
      html.removeAttribute(ROOT_ATTR);
    },
  };
}
