import { MAX_CAPACITY_ATTEMPTS, MAX_CARDS, NOTES_DEBOUNCE_MS, REF_RE, RETRY_DEFAULT_MS, RETRY_MAX_MS, STORAGE_KEY } from "./constants.js";
import { ApiError, deleteNotes, putNotes } from "./api.js";

function defaultStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function emptyState() {
  return { ref: null, texts: [], cardCode: null, maxLength: null, synced: true, written: null };
}

function parseState(raw, eshopId) {
  try {
    const data = JSON.parse(raw);
    if (!data || data.eshopId !== eshopId || !Array.isArray(data.texts)) return null;
    return {
      ref: typeof data.ref === "string" && REF_RE.test(data.ref) ? data.ref : null,
      texts: data.texts.filter((t) => typeof t === "string").slice(0, MAX_CARDS),
      cardCode: typeof data.cardCode === "string" ? data.cardCode : null,
      maxLength: Number.isInteger(data.maxLength) ? data.maxLength : null,
      synced: data.synced !== false,
      written: typeof data.written === "string" && data.written ? data.written : null,
    };
  } catch {
    return null;
  }
}

// Gift state shared between the cart page and step 2: texts, the server-issued ref and a "synced" flag.
// sessionStorage is optional: without it the state lives in memory for the current page only.
export function createGiftStore(eshopId, storage) {
  const area = storage === undefined ? defaultStorage() : storage;
  let state = emptyState();
  try {
    const raw = area ? area.getItem(STORAGE_KEY) : null;
    state = (raw && parseState(raw, eshopId)) || emptyState();
  } catch {
    state = emptyState();
  }
  function persist() {
    try {
      if (!area) return;
      if (state.ref === null && state.written === null && state.texts.every((t) => t === "")) area.removeItem(STORAGE_KEY);
      else area.setItem(STORAGE_KEY, JSON.stringify({ eshopId, ...state }));
    } catch {
      // storage unavailable: keep the in-memory copy
    }
  }
  return {
    get: () => ({ ...state, texts: [...state.texts] }),
    setTexts(texts) {
      state.texts = texts.slice(0, MAX_CARDS);
      state.synced = false;
      persist();
    },
    setCardInfo(code, maxLength) {
      if (state.cardCode === code && state.maxLength === maxLength) return;
      state.cardCode = code;
      state.maxLength = maxLength;
      persist();
    },
    setRef(ref) {
      state.ref = ref;
      persist();
    },
    markSynced(value) {
      state.synced = value;
      persist();
    },
    // The fragment step 2 wrote into #remark without a marker (null when it wrote a marked one or nothing).
    setWritten(fragment) {
      state.written = fragment || null;
      persist();
    },
    clear() {
      state = emptyState();
      try {
        if (area) area.removeItem(STORAGE_KEY);
      } catch {
        // ignore
      }
    },
  };
}

// Writes the texts (or deletes them when there are none) and keeps the ref the server answers with.
async function send(eshopId, store, notes, options) {
  const { ref } = store.get();
  if (notes.length === 0) {
    if (ref) await deleteNotes(eshopId, ref, options);
    store.setRef(null);
  } else {
    store.setRef(await putNotes(eshopId, ref, notes, options));
  }
}

// How long to wait after a 429: the Retry-After value (at least a second, at most RETRY_MAX_MS) or a default.
function retryDelay(error) {
  if (error.retryAfterMs === null) return RETRY_DEFAULT_MS;
  return Math.min(Math.max(error.retryAfterMs, 1000), RETRY_MAX_MS);
}

// Debounced, serialised synchronisation of the gift texts with the backend (PUT, or DELETE when empty).
// Only one request is in flight; edits made meanwhile trigger one more run. Never throws.
// Failures: 429 is retried later (Retry-After), 400 is final (the text would be refused again), 404 means the
// add-on or the gift card is switched off (`onUnavailable`, nothing is sent any more), anything else stays
// "not synced" until the next edit or step 2. Repeated 429 "capacity" stops all sending until the page is reloaded.
export function createNotesSync({ eshopId, store, getNotes, debounceMs, apiOptions, onUnavailable }) {
  const delay = debounceMs === undefined ? NOTES_DEBOUNCE_MS : debounceMs;
  let timer = null;
  let retryTimer = null;
  let running = null;
  let again = false;
  let pendingExtra;
  let unavailable = false;
  let rejected = null;
  let capacityHits = 0;

  function failed(error, signature) {
    store.markSynced(false);
    const status = error instanceof ApiError ? error.status : 0;
    if (status === 400) rejected = signature;
    else if (status === 404) {
      unavailable = true;
      if (typeof onUnavailable === "function") onUnavailable();
    } else if (status === 429) {
      capacityHits = error.reason === "capacity" ? capacityHits + 1 : 0;
      unavailable = capacityHits >= MAX_CAPACITY_ATTEMPTS;
      clearTimeout(retryTimer);
      if (!unavailable) retryTimer = setTimeout(flush, retryDelay(error));
    }
  }

  async function runOnce(extra) {
    const notes = getNotes();
    const signature = JSON.stringify(notes);
    if (rejected === signature) return;
    try {
      await send(eshopId, store, notes, { ...apiOptions, ...extra });
      capacityHits = 0;
      store.markSynced(true);
    } catch (error) {
      failed(error, signature);
    }
  }

  async function flush(extra) {
    clearTimeout(timer);
    timer = null;
    if (unavailable) return undefined;
    if (running) {
      // Keep the options of the strongest request (keepalive when the page is leaving) for the follow-up run.
      again = true;
      if (extra) pendingExtra = { ...pendingExtra, ...extra };
      return running;
    }
    clearTimeout(retryTimer);
    running = runOnce(extra);
    try {
      await running;
    } finally {
      running = null;
    }
    if (again) {
      again = false;
      const next = pendingExtra;
      pendingExtra = undefined;
      await flush(next);
    }
    return undefined;
  }

  return {
    schedule() {
      if (unavailable) return;
      store.markSynced(false);
      clearTimeout(timer);
      timer = setTimeout(() => {
        flush();
      }, delay);
    },
    flush,
    // Best-effort send when the page is going away (also while a request is already running).
    flushOnLeave() {
      if (timer !== null || running || !store.get().synced) flush({ keepalive: true });
    },
    cancel() {
      clearTimeout(timer);
      clearTimeout(retryTimer);
      timer = null;
    },
  };
}
