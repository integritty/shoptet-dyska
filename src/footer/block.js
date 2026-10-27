import { createActions } from "./actions.js";
import { CODE_PREFIX, MAX_CARDS, MOUNT_TARGETS, TIP_CODE_PREFIX } from "./constants.js";
import { formatPrice } from "./format.js";
import { textsFor } from "./i18n.js";
import { quantityOf, readCartLines } from "./shoptet.js";
import { injectStyles } from "./styles.js";
import { createView } from "./view.js";

function place(root) {
  for (const target of MOUNT_TARGETS) {
    const node = document.querySelector(target.selector);
    if (!node) continue;
    if (target.position === "after" && node.parentNode) node.parentNode.insertBefore(root, node.nextSibling);
    else node.appendChild(root);
    return true;
  }
  return false;
}

function carrierCodes(config) {
  const single = [config.parcelProtection, config.priorityShipping, config.giftCard].filter(Boolean);
  return new Set([...config.tips.map((tip) => tip.code), ...single.map((item) => item.code)]);
}

// Reduces the cart in the data layer to what the view shows.
function readState(config, cardLimit, knownCodes) {
  const lines = readCartLines() || [];
  const tipLines = lines.filter((line) => line.code.startsWith(TIP_CODE_PREFIX));
  const has = (item) => Boolean(item) && quantityOf(lines, item.code) > 0;
  const knownTips = tipLines.filter((line) => knownCodes.has(line.code));
  const singles = [config.parcelProtection, config.priorityShipping].filter(Boolean);
  const notOnce = (item) => {
    const own = lines.filter((line) => line.code === item.code);
    return own.length > 1 || own.some((line) => line.quantity !== 1);
  };
  // Quantities the block cannot represent (a tip or service more than once, more cards than allowed).
  const needsFix =
    knownTips.length > 1 ||
    knownTips.some((line) => line.quantity !== 1) ||
    singles.some(notOnce) ||
    (config.giftCard ? quantityOf(lines, config.giftCard.code) > cardLimit : false);
  return {
    needsFix,
    visible: lines.some((line) => !line.code.startsWith(CODE_PREFIX)),
    tipCode: tipLines.length > 0 ? tipLines[0].code : null,
    services: { parcelProtection: has(config.parcelProtection), priorityShipping: has(config.priorityShipping) },
    cardCount: config.giftCard ? Math.min(quantityOf(lines, config.giftCard.code), cardLimit) : 0,
    orphans: lines.filter((line) => line.code.startsWith(CODE_PREFIX) && !knownCodes.has(line.code)).length,
  };
}

// Wraps the cart ops so the block knows the cart really changed, and redraws the table even when a later
// step of the same task failed.
function trackMutations(ops, onChange) {
  const track = (call) => async (...args) => {
    const ok = await call(...args);
    if (ok) onChange();
    return ok;
  };
  return { ...ops, add: track(ops.add), remove: track(ops.remove) };
}

// A task counts as failed when it returns false or throws.
async function attempt(task) {
  try {
    return await task();
  } catch {
    return false;
  }
}

// What the view calls: cart changes go through the queue, text edits go to the store and the notes sync.
function createHandlers({ config, actions, enqueue, store, notesSync }) {
  return {
    onTip: (code) => enqueue(() => actions.setTip(code)),
    onService: (key, on) => enqueue(() => actions.setService(config[key], on)),
    onCards: (count) => enqueue(() => actions.setCards(count)),
    onRemoveOrphans: () => enqueue(() => actions.removeOrphans()),
    onNote(index, value) {
      const texts = store.get().texts;
      while (texts.length <= index) texts.push("");
      texts[index] = value;
      store.setTexts(texts);
      notesSync.schedule();
    },
  };
}

// The cart block: owns the view, runs cart changes one after another and keeps the view in line with the cart.
// The cart in the data layer is the only source of truth; the only state we keep is the gift texts.
export function createBlock({ config, language, currency, ops: rawOps, store, notesSync }) {
  const knownCodes = carrierCodes(config);
  const cardLimit = config.giftCard ? (config.giftCard.allowMultiple ? MAX_CARDS : 1) : 0;
  let queue = Promise.resolve();
  let pending = 0;
  // false, true (generic error) or "price" (Shoptet charged another price than the backend announced).
  let error = false;
  let mutated = false;
  let fixTried = false;
  let unavailable = false;
  let lastCardCount = null;
  const ops = trackMutations(rawOps, () => {
    mutated = true;
  });
  const actions = createActions({ config, ops, knownCodes, cardLimit });
  if (config.giftCard) store.setCardInfo(config.giftCard.code, config.giftCard.maxLength);

  const fullState = () => ({
    ...readState(config, cardLimit, knownCodes),
    busy: pending > 0,
    error,
    unavailable,
    texts: store.get().texts,
  });

  async function runTask(task) {
    const ok = await attempt(task);
    const price = actions.takePriceIssue();
    error = ok ? false : price ? "price" : true;
  }

  function refreshCart() {
    const changed = mutated;
    mutated = false;
    if (!changed || typeof rawOps.refresh !== "function") return;
    try {
      rawOps.refresh();
    } catch {
      // the data layer is re-read on the next event anyway
    }
  }

  // While our own changes run, cart events are ignored (no re-render loop); one sync follows at the end.
  function enqueue(task) {
    pending += 1;
    view.update(fullState());
    queue = queue.then(() => runTask(task)).then(() => {
      pending -= 1;
      if (pending > 0) return;
      refreshCart();
      sync();
    });
    return queue;
  }

  const handlers = createHandlers({ config, actions, enqueue, store, notesSync });
  const view = createView({ config, text: textsFor(language), fmt: (minor) => formatPrice(minor, currency, language), handlers });

  function sync() {
    if (pending > 0) return;
    if (!view.root.isConnected) {
      injectStyles();
      if (!place(view.root)) return;
    }
    const state = fullState();
    // One automatic repair per problem: if it did not help, the error stays and nothing loops.
    if (!state.needsFix) fixTried = false;
    else if (!fixTried && !unavailable) {
      fixTried = true;
      enqueue(() => actions.normalize());
      return;
    }
    view.update(state);
    const changed = lastCardCount === null ? !store.get().synced : state.cardCount !== lastCardCount;
    if (changed) notesSync.schedule();
    lastCardCount = state.cardCount;
  }

  return {
    sync,
    view,
    whenIdle: () => queue,
    // The backend says the add-on is off (404): hide the block and stop touching the cart.
    markUnavailable() {
      unavailable = true;
      view.update(fullState());
    },
  };
}
