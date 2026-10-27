import { afterEach, describe, expect, it, vi } from "vitest";

import { normalizeConfig } from "../src/footer/config.js";
import { textsFor } from "../src/footer/i18n.js";
import { createView } from "../src/footer/view.js";
import { CONFIG } from "./helpers.js";

const STATE = {
  visible: true,
  busy: false,
  error: false,
  tipCode: null,
  services: { parcelProtection: false, priorityShipping: false },
  cardCount: 0,
  texts: [],
  orphans: 0,
};

function build(overrides, handlers) {
  const config = normalizeConfig({ ...CONFIG, ...overrides });
  const spies = { onTip: vi.fn(), onService: vi.fn(), onCards: vi.fn(), onNote: vi.fn(), onRemoveOrphans: vi.fn(), ...handlers };
  const view = createView({ config, text: textsFor("cs"), fmt: (m) => `${m / 100} Kč`, handlers: spies });
  document.body.appendChild(view.root);
  return { view, spies, config };
}

afterEach(() => {
  document.body.textContent = "";
});

describe("view", () => {
  it("renders without touching innerHTML / insertAdjacentHTML", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
    const trap = vi.fn();
    Object.defineProperty(Element.prototype, "innerHTML", { configurable: true, get: descriptor.get, set: trap });
    const insert = vi.spyOn(Element.prototype, "insertAdjacentHTML");
    try {
      const { view } = build();
      view.update({ ...STATE, cardCount: 2, texts: ["<img src=x onerror=alert(1)>"] });
    } finally {
      Object.defineProperty(Element.prototype, "innerHTML", descriptor);
    }
    expect(trap).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it("treats data as text: markup in a coin code or a note is never parsed", () => {
    const evil = { ...CONFIG, carriers: { ...CONFIG.carriers, tips: [{ amount: 1000, code: "<img src=x>" }] } };
    const { view } = build(evil);
    view.update({ ...STATE, cardCount: 1, texts: ["<b>bold</b><img src=x>"] });
    expect(view.root.querySelector("img")).toBeNull();
    expect(view.root.querySelector("b")).toBeNull();
    expect(view.root.querySelector("textarea").value).toBe("<b>bold</b><img src=x>");
  });

  it("shows the coins from the config, formatted, and marks 0..1 as pressed", () => {
    const { view } = build();
    view.update({ ...STATE, tipCode: "DYSKA-TIP-2000" });
    const coins = [...view.root.querySelectorAll(".dyska-coin")];
    expect(coins.map((c) => c.textContent)).toEqual(["10 Kč", "20 Kč", "50 Kč", "100 Kč"]);
    expect(coins.map((c) => c.getAttribute("aria-pressed"))).toEqual(["false", "true", "false", "false"]);
    expect(view.root.querySelector(".dyska-thanks").textContent).toBe("Mockrát děkujeme");
    view.update({ ...STATE, tipCode: null });
    expect(view.root.querySelectorAll('.dyska-coin[aria-pressed="true"]')).toHaveLength(0);
    expect(view.root.querySelector(".dyska-thanks").textContent).toBe("");
  });

  it("calls handlers with absolute targets", () => {
    const { view, spies } = build();
    view.update(STATE);
    view.root.querySelectorAll(".dyska-coin")[1].click();
    expect(spies.onTip).toHaveBeenCalledWith("DYSKA-TIP-2000");
    const box = view.root.querySelector('input[data-service="parcelProtection"]');
    box.click();
    expect(spies.onService).toHaveBeenCalledWith("parcelProtection", true);
    view.root.querySelector('.dyska-step[aria-label="Přidat kartičku"]').click();
    expect(spies.onCards).toHaveBeenCalledWith(1);
  });

  it("limits cards: stepper aria-disabled at 0 and at the maximum; a single card when multiple is off", () => {
    const { view, spies } = build();
    const [less, more] = view.root.querySelectorAll(".dyska-step");
    const off = (button) => button.getAttribute("aria-disabled");
    view.update(STATE);
    expect([off(less), off(more)]).toEqual(["true", "false"]);
    less.click();
    expect(spies.onCards).not.toHaveBeenCalled();
    view.update({ ...STATE, cardCount: 10, texts: new Array(10).fill("") });
    expect([off(less), off(more)]).toEqual(["false", "true"]);
    more.click();
    expect(spies.onCards).not.toHaveBeenCalled();
    document.body.textContent = "";
    const single = build({ giftCard: { ...CONFIG.giftCard, allowMultiple: false } });
    single.view.update({ ...STATE, cardCount: 1, texts: [""] });
    expect(single.view.root.querySelectorAll(".dyska-step")[1].getAttribute("aria-disabled")).toBe("true");
  });

  it("never uses the disabled attribute (it would drop keyboard focus)", () => {
    const { view } = build();
    view.update({ ...STATE, busy: true, cardCount: 1, texts: [""], orphans: 1 });
    expect(view.root.querySelectorAll("[disabled]")).toHaveLength(0);
    for (const button of view.root.querySelectorAll(".dyska-coin, .dyska-step")) expect(button.getAttribute("aria-disabled")).toBe("true");
  });

  it("ignores clicks while a change is running and undoes a toggled checkbox", () => {
    const { view, spies } = build();
    view.update({ ...STATE, busy: true, cardCount: 1, texts: [""], orphans: 1 });
    view.root.querySelector(".dyska-coin").click();
    for (const step of view.root.querySelectorAll(".dyska-step")) step.click();
    view.root.querySelector(".dyska-orphans button").click();
    const box = view.root.querySelector('input[data-service="parcelProtection"]');
    box.click();
    expect(box.checked).toBe(false);
    expect(Object.values(spies).flatMap((spy) => spy.mock.calls)).toHaveLength(0);
    view.update({ ...STATE, busy: false, cardCount: 1, texts: [""], orphans: 1 });
    view.root.querySelector(".dyska-coin").click();
    expect(spies.onTip).toHaveBeenCalledTimes(1);
    expect(view.root.querySelector(".dyska-coin").getAttribute("aria-disabled")).toBe("false");
  });

  it("moves focus to the stepper when the focused card is removed", () => {
    const { view } = build();
    view.update({ ...STATE, cardCount: 2, texts: ["", ""] });
    const [, second] = view.root.querySelectorAll("textarea");
    second.focus();
    view.update({ ...STATE, cardCount: 1, texts: [""] });
    expect(document.activeElement).toBe(view.root.querySelector('.dyska-step[aria-label="Ubrat kartičku"]'));
    view.root.querySelector("textarea").focus();
    view.update({ ...STATE, cardCount: 0, texts: [] });
    expect(document.activeElement).toBe(view.root.querySelector('.dyska-step[aria-label="Přidat kartičku"]'));
  });

  it("keeps focus on the stepper button after a click that reaches a limit", () => {
    const { view } = build();
    view.update({ ...STATE, cardCount: 1, texts: [""] });
    const less = view.root.querySelector('.dyska-step[aria-label="Ubrat kartičku"]');
    less.focus();
    view.update({ ...STATE, cardCount: 0, texts: [] });
    expect(document.activeElement).toBe(less);
  });

  it("shows the price error and hides everything when the backend says the add-on is unavailable", () => {
    const { view } = build();
    view.update({ ...STATE, error: "price" });
    expect(view.root.querySelector('[role="alert"]').textContent).toBe(textsFor("cs").priceError);
    view.update({ ...STATE, error: true });
    expect(view.root.querySelector('[role="alert"]').textContent).toBe(textsFor("cs").error);
    view.update({ ...STATE, unavailable: true });
    expect(view.root.hidden).toBe(true);
  });

  it("creates one textarea per card with a code point counter and no maxlength attribute", () => {
    const { view, spies } = build({ giftCard: { ...CONFIG.giftCard, maxLength: 40 } });
    view.update({ ...STATE, cardCount: 2, texts: ["Ahoj", ""] });
    const areas = view.root.querySelectorAll("textarea");
    expect(areas).toHaveLength(2);
    // maxlength counts UTF-16 units; the limit is checked in code points in the input handler instead
    expect(areas[0].hasAttribute("maxlength")).toBe(false);
    expect(areas[0].value).toBe("Ahoj");
    const counter = view.root.querySelector(`#${areas[0].id}-counter`);
    expect(counter.textContent).toBe("4 / 40");
    areas[1].value = "😀😀";
    areas[1].dispatchEvent(new Event("input", { bubbles: true }));
    expect(spies.onNote).toHaveBeenCalledWith(1, "😀😀");
    expect(view.root.querySelector(`#${areas[1].id}-counter`).textContent).toBe("2 / 40");
    view.update({ ...STATE, cardCount: 1, texts: ["Ahoj"] });
    expect(view.root.querySelectorAll("textarea")).toHaveLength(1);
  });

  it("cuts over-long input by code points, so an emoji is never split", () => {
    const { view, spies } = build({ giftCard: { ...CONFIG.giftCard, maxLength: 5 } });
    view.update({ ...STATE, cardCount: 1, texts: [""] });
    const area = view.root.querySelector("textarea");
    area.value = "😀".repeat(8);
    area.dispatchEvent(new Event("input", { bubbles: true }));
    expect(area.value).toBe("😀".repeat(5));
    expect(spies.onNote).toHaveBeenLastCalledWith(0, "😀".repeat(5));
    expect(view.root.querySelector(`#${area.id}-counter`).textContent).toBe("5 / 5");
    area.value = "abcdefgh";
    area.dispatchEvent(new Event("input", { bubbles: true }));
    expect(area.value).toBe("abcde");
  });

  it("does not overwrite a textarea the customer is typing in", () => {
    const { view } = build();
    view.update({ ...STATE, cardCount: 1, texts: [""] });
    const area = view.root.querySelector("textarea");
    area.focus();
    area.value = "rozepsáno";
    view.update({ ...STATE, cardCount: 1, texts: [""] });
    expect(area.value).toBe("rozepsáno");
  });

  it("is accessible: labelled regions, labelled textareas, live regions, button type", () => {
    const { view } = build();
    view.update({ ...STATE, cardCount: 1, texts: [""], error: true });
    expect(view.root.getAttribute("role")).toBe("region");
    expect(view.root.getAttribute("aria-label")).toBeTruthy();
    for (const section of view.root.querySelectorAll("section")) {
      expect(document.getElementById(section.getAttribute("aria-labelledby"))).not.toBeNull();
    }
    const area = view.root.querySelector("textarea");
    expect(view.root.querySelector(`label[for="${area.id}"]`)).not.toBeNull();
    expect(view.root.querySelector('[role="alert"]').textContent).not.toBe("");
    for (const button of view.root.querySelectorAll("button")) expect(button.type).toBe("button");
  });

  it("hides when the cart has nothing else and shows the notice for withdrawn carriers", () => {
    const { view, spies } = build();
    view.update({ ...STATE, visible: false });
    expect(view.root.hidden).toBe(true);
    view.update({ ...STATE, orphans: 1 });
    const notice = view.root.querySelector(".dyska-orphans");
    expect(notice.hidden).toBe(false);
    notice.querySelector("button").click();
    expect(spies.onRemoveOrphans).toHaveBeenCalled();
  });

  it("renders only the sections that are configured", () => {
    const { view } = build({ parcelProtection: { enabled: false, price: 0 }, priorityShipping: { enabled: false, price: 0 } });
    expect(view.root.querySelector(".dyska-services")).toBeNull();
    expect(view.root.querySelector(".dyska-tip")).not.toBeNull();
  });
});
