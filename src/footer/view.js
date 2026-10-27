import { BLOCK_ATTR, MAX_CARDS } from "./constants.js";
import { el } from "./dom.js";
import { charCount, cutChars } from "./format.js";

// Buttons are never `disabled` (that would drop keyboard focus); they carry aria-disabled and ignore clicks instead.
const isDisabled = (node) => node.getAttribute("aria-disabled") === "true";
const setDisabled = (node, value) => node.setAttribute("aria-disabled", value ? "true" : "false");

function buildTip(config, text, fmt, handlers, ui) {
  const buttons = config.tips.map((tip) =>
    el("button", {
      type: "button",
      class: "dyska-coin",
      "data-code": tip.code,
      "aria-pressed": "false",
      text: fmt(tip.amount),
      on: {
        click: () => {
          if (!ui.busy) handlers.onTip(tip.code);
        },
      },
    }),
  );
  const titleId = "dyska-tip-title";
  const thanks = el("p", { class: "dyska-thanks", role: "status" });
  const section = el("section", { class: "dyska-card dyska-tip", "aria-labelledby": titleId }, [
    el("h3", { class: "dyska-title", id: titleId, text: text.tipTitle }),
    el("p", { class: "dyska-hint", text: text.tipHint }),
    el("div", { class: "dyska-coins", role: "group", "aria-label": text.tipGroup }, buttons),
    thanks,
  ]);
  return {
    section,
    update(state) {
      for (const button of buttons) {
        button.setAttribute("aria-pressed", button.dataset.code === state.tipCode ? "true" : "false");
        setDisabled(button, state.busy);
      }
      thanks.textContent = state.tipCode && config.tips.some((t) => t.code === state.tipCode) ? text.tipThanks : "";
    },
  };
}

function buildService(key, service, label, hint, fmt, handlers, ui) {
  const input = el("input", {
    type: "checkbox",
    "data-service": key,
    on: {
      change: () => {
        // A native checkbox toggles itself: undo that while a change is running.
        if (ui.busy) input.checked = !input.checked;
        else handlers.onService(key, input.checked);
      },
    },
  });
  const row = el("label", { class: "dyska-service" }, [
    input,
    el("span", { class: "dyska-service-name", text: label }),
    el("span", { class: "dyska-price", text: fmt(service.price) }),
    el("span", { class: "dyska-service-hint", text: hint }),
  ]);
  return { row, input };
}

function buildServices(config, text, fmt, handlers, ui) {
  const parts = [];
  if (config.parcelProtection) {
    parts.push({ key: "parcelProtection", ...buildService("parcelProtection", config.parcelProtection, text.parcelProtection, text.parcelProtectionHint, fmt, handlers, ui) });
  }
  if (config.priorityShipping) {
    parts.push({ key: "priorityShipping", ...buildService("priorityShipping", config.priorityShipping, text.priorityShipping, text.priorityShippingHint, fmt, handlers, ui) });
  }
  if (parts.length === 0) return null;
  const titleId = "dyska-services-title";
  const section = el("section", { class: "dyska-card dyska-services", "aria-labelledby": titleId }, [
    el("h3", { class: "dyska-title", id: titleId, text: text.servicesTitle }),
    ...parts.map((part) => part.row),
  ]);
  return {
    section,
    update(state) {
      for (const part of parts) {
        part.input.checked = Boolean(state.services[part.key]);
        setDisabled(part.input, state.busy);
      }
    },
  };
}

function buildNote(index, total, maxLength, text, handlers) {
  const id = `dyska-note-${index}`;
  const counter = el("span", { class: "dyska-counter" });
  const textarea = el("textarea", {
    id,
    rows: 3,
    placeholder: text.notePlaceholder,
    "aria-describedby": `${id}-counter`,
    on: {
      input: () => {
        // The limit counts code points (like the backend), which the maxlength attribute cannot do.
        if (charCount(textarea.value) > maxLength) textarea.value = cutChars(textarea.value, maxLength);
        counter.textContent = `${charCount(textarea.value)} / ${maxLength}`;
        handlers.onNote(index, textarea.value);
      },
    },
  });
  counter.id = `${id}-counter`;
  counter.textContent = `0 / ${maxLength}`;
  const label = el("label", { for: id, text: text.noteLabel(index + 1, total) });
  const wrap = el("div", { class: "dyska-note" }, [label, textarea, counter]);
  return { wrap, textarea, counter, label };
}

function buildGift(config, text, fmt, handlers, ui) {
  const gift = config.giftCard;
  const max = gift.allowMultiple ? MAX_CARDS : 1;
  const titleId = "dyska-gift-title";
  const count = el("output", { class: "dyska-count", "aria-live": "polite", text: "0" });
  const less = el("button", { type: "button", class: "dyska-step", "aria-label": text.cardLess, text: "\u2212" });
  const more = el("button", { type: "button", class: "dyska-step", "aria-label": text.cardMore, text: "+" });
  const notes = el("div", { class: "dyska-notes" });
  let current = 0;
  // Clicks while a change is running (or at a limit) are ignored; the next render shows the real cart.
  const request = (button, wanted) => {
    if (ui.busy || isDisabled(button)) return;
    current = Math.max(0, Math.min(max, wanted));
    handlers.onCards(current);
  };
  less.addEventListener("click", () => request(less, current - 1));
  more.addEventListener("click", () => request(more, current + 1));
  const fields = [];
  const section = el("section", { class: "dyska-card dyska-gift", "aria-labelledby": titleId }, [
    el("h3", { class: "dyska-title", id: titleId, text: `${text.giftTitle} (${fmt(gift.price)})` }),
    el("p", { class: "dyska-hint", text: text.giftHint }),
    el("div", { class: "dyska-stepper", role: "group", "aria-label": text.cardCount }, [less, count, more]),
    notes,
  ]);
  // Returns true when the focused textarea was removed, so focus is not lost with it.
  function syncFields(state) {
    let lostFocus = false;
    while (fields.length > state.cardCount) {
      const field = fields.pop();
      lostFocus = lostFocus || field.wrap.contains(document.activeElement);
      notes.removeChild(field.wrap);
    }
    while (fields.length < state.cardCount) {
      const field = buildNote(fields.length, state.cardCount, gift.maxLength, text, handlers);
      fields.push(field);
      notes.appendChild(field.wrap);
    }
    fields.forEach((field, index) => {
      field.label.textContent = text.noteLabel(index + 1, state.cardCount);
      const value = state.texts[index] || "";
      if (field.textarea.value !== value && document.activeElement !== field.textarea) {
        field.textarea.value = value;
        field.counter.textContent = `${charCount(value)} / ${gift.maxLength}`;
      }
    });
    return lostFocus;
  }
  return {
    section,
    update(state) {
      if (!state.busy) current = state.cardCount;
      count.textContent = String(state.cardCount);
      setDisabled(less, state.busy || current <= 0);
      setDisabled(more, state.busy || current >= max);
      if (syncFields(state)) (state.cardCount > 0 ? less : more).focus();
    },
  };
}

function buildOrphans(text, handlers, ui) {
  const notice = el("div", { class: "dyska-orphans", role: "status", hidden: true }, [
    el("span", { text: text.orphanNotice }),
    el("button", { type: "button", class: "dyska-link", text: text.orphanRemove, on: { click: () => !ui.busy && handlers.onRemoveOrphans() } }),
  ]);
  return { notice, update: (state) => (notice.hidden = state.orphans === 0) };
}

// Builds the block with DOM APIs only. `update(state)` reflects the cart; it never changes the cart itself.
export function createView({ config, text, fmt, handlers }) {
  const error = el("p", { class: "dyska-error", role: "alert", hidden: true });
  const ui = { busy: false };
  const parts = [];
  if (config.tips.length > 0) parts.push(buildTip(config, text, fmt, handlers, ui));
  const services = buildServices(config, text, fmt, handlers, ui);
  if (services) parts.push(services);
  if (config.giftCard) parts.push(buildGift(config, text, fmt, handlers, ui));
  const orphans = buildOrphans(text, handlers, ui);
  const root = el(
    "div",
    { class: "dyska-block", [BLOCK_ATTR]: "", role: "region", "aria-label": text.blockLabel, hidden: true },
    [...parts.map((part) => part.section), orphans.notice, error],
  );
  return {
    root,
    update(state) {
      ui.busy = Boolean(state.busy);
      root.hidden = !state.visible || Boolean(state.unavailable);
      root.setAttribute("data-busy", state.busy ? "true" : "false");
      root.setAttribute("aria-busy", state.busy ? "true" : "false");
      for (const part of parts) part.update(state);
      orphans.update(state);
      error.textContent = state.error ? (state.error === "price" ? text.priceError : text.error) : "";
      error.hidden = !state.error;
    },
  };
}
