import { ADD_NOTE_SELECTOR, DEFAULT_CARD_CODE, MAX_HOOK_WRAPS, REMARK_SELECTOR } from "./constants.js";
import { applyGiftFragment, giftFragment, stripGiftFragment } from "./format.js";
import { getLanguage, quantityOf, readCartLines } from "./shoptet.js";

const WRAPPED = "__dyskaWrapped";
const FORM_FLAG = "dyskaRemark";

function fire(node, type) {
  node.dispatchEvent(new Event(type, { bubbles: true }));
}

// Step 2 of the order: writes the gift fragment into #remark right before the form is sent.
// `getNotes(cardCount)` returns the sanitised, non-empty gift texts; `resync()` retries a text the backend lacks.
export function createCheckout({ store, getNotes, resync }) {
  let resyncStarted = false;
  let hookRunning = false;
  let hookWraps = 0;
  let ownHook = null;

  // With a readable cart the card line decides how many texts count. Without one the stored texts are only written
  // when the backend holds exactly them (synced and a ref): otherwise a card that was removed could get a text.
  function currentNotes(state) {
    const lines = readCartLines();
    if (!lines) return state.synced && state.ref ? getNotes(null) : [];
    const cards = quantityOf(lines, state.cardCode || DEFAULT_CARD_CODE);
    return cards === 0 ? [] : getNotes(cards);
  }

  function writeRemark() {
    const textarea = document.querySelector(REMARK_SELECTOR);
    if (!textarea) return;
    const state = store.get();
    const notes = currentNotes(state);
    const before = textarea.value;
    // Fragments this block wrote earlier without a marker (the customer came back to this step).
    const unmarked = state.written ? [state.written] : [];
    if (notes.length === 0 && stripGiftFragment(before, unmarked) === before.trim()) return;
    const limit = textarea.maxLength > 0 ? textarea.maxLength : 0;
    // The marker is only written when the backend holds the current text; otherwise the visible text goes in alone.
    const ref = notes.length > 0 && state.synced ? state.ref : null;
    const language = getLanguage();
    const value = applyGiftFragment(before, notes, ref, limit, unmarked, language);
    store.setWritten(notes.length > 0 && !ref ? giftFragment(notes, null, limit, language) : null);
    if (value === textarea.value) return;
    const toggle = document.querySelector(ADD_NOTE_SELECTOR);
    if (value && toggle && toggle.checked === false) toggle.click();
    textarea.value = value;
    fire(textarea, "input");
    fire(textarea, "change");
  }

  function safeWrite() {
    try {
      writeRemark();
    } catch {
      // never block the order
    }
  }

  // Chains onto an existing shoptet.custom.postSuccessfulValidation instead of replacing it. Our wrapper is marked,
  // never wrapped twice, and does its work once even when a foreign script wrapped it again.
  function installHook() {
    if (typeof shoptet === "undefined" || !shoptet) return;
    if (!shoptet.custom) shoptet.custom = {};
    const previous = shoptet.custom.postSuccessfulValidation;
    if (previous && (previous[WRAPPED] || previous === ownHook)) return;
    if (hookWraps >= MAX_HOOK_WRAPS) return;
    hookWraps += 1;
    const wrapper = function postSuccessfulValidation(...args) {
      const nested = hookRunning;
      hookRunning = true;
      try {
        if (!nested) safeWrite();
        return typeof previous === "function" ? previous.apply(this, args) : true;
      } finally {
        hookRunning = nested;
      }
    };
    wrapper[WRAPPED] = true;
    ownHook = wrapper;
    shoptet.custom.postSuccessfulValidation = wrapper;
  }

  // Backup path for templates that submit the form without calling the hook.
  function installSubmitListener() {
    const textarea = document.querySelector(REMARK_SELECTOR);
    const form = textarea && textarea.form;
    if (!form || form.dataset[FORM_FLAG]) return;
    form.dataset[FORM_FLAG] = "1";
    form.addEventListener("submit", safeWrite, true);
  }

  return {
    install() {
      installHook();
      installSubmitListener();
      // The text is not on the backend yet (a failed or interrupted request in the cart): try again once.
      if (!resyncStarted && typeof resync === "function" && !store.get().synced) {
        resyncStarted = true;
        resync();
      }
    },
    writeRemark: safeWrite,
  };
}
