import { describe, expect, it } from "vitest";

import { applyGiftFragment, cutChars, formatGiftRemark, formatPrice, giftFragment, sanitizeNote, stripGiftFragment } from "../src/footer/format.js";
import { CH, REF } from "./helpers.js";

const plain = (s) => s.split(String.fromCharCode(160)).join(" ");

describe("formatPrice", () => {
  it("formats CZK minor units without needless decimals", () => {
    expect(plain(formatPrice(1000, "CZK", "cs"))).toBe("10 Kč");
    expect(plain(formatPrice(2900, "CZK", "cs"))).toBe("29 Kč");
    expect(plain(formatPrice(1250, "CZK", "cs"))).toBe("12,50 Kč");
  });

  it("formats EUR for Slovak shops (0.5 / 1 / 2 / 4 EUR levels)", () => {
    expect(plain(formatPrice(50, "EUR", "sk"))).toBe("0,50 €");
    expect(plain(formatPrice(100, "EUR", "sk"))).toBe("1 €");
    expect(plain(formatPrice(400, "EUR", "sk"))).toBe("4 €");
  });

  it("falls back for an unknown currency code", () => {
    expect(formatPrice(1000, "??", "cs")).toBe("10 ??");
  });
});

// Samples copied from the backend: backend apps/api/src/orders/order-gift.test.ts ("formatGiftRemark ...")
// and the contract in the backend README ("Kontrakt s blokem v kosiku").
describe("formatGiftRemark (backend samples)", () => {
  it("single card: 'Věnování: <text>' + marker on the last line", () => {
    expect(formatGiftRemark(["Všechno nejlepší!"], REF)).toBe(`Věnování: Všechno nejlepší!\n[dyska:${REF}]`);
  });

  it("several cards: numbered lines in cart order", () => {
    expect(formatGiftRemark(["Jedna", "Dvě"], REF)).toBe(`Věnování 1: Jedna\nVěnování 2: Dvě\n[dyska:${REF}]`);
  });

  it("is readable by the backend parser (regexes copied from order-gift.ts)", () => {
    const GIFT_REF_RE = /\[dyska:([A-Za-z0-9_-]{22})\]/;
    const PREFIX_RE = /^\s*v[eě]nov[aá]n[ií]e?\s*\d{0,2}\s*:\s*/iu;
    const remark = formatGiftRemark(["Jedna", "Dvě"], REF);
    expect(GIFT_REF_RE.exec(remark)?.[1]).toBe(REF);
    const lines = remark.replace(new RegExp(GIFT_REF_RE.source, "g"), "").trim().split(/\r?\n/);
    expect(PREFIX_RE.test(lines[0])).toBe(true);
    expect(lines.map((l) => l.replace(PREFIX_RE, "").trim())).toEqual(["Jedna", "Dvě"]);
  });
});

describe("sanitizeNote (mirrors validateGiftText)", () => {
  it("normalises whitespace and line breaks like the server", () => {
    expect(sanitizeNote("  Ahoj\r\n\tsvěte   !  ", 120)).toBe("Ahoj světe !");
  });

  it("removes control, bidi and zero-width characters instead of failing", () => {
    expect(sanitizeNote(`Ahoj${CH.rlo}${CH.zwsp}${CH.bell}${CH.shy} světe`, 120)).toBe("Ahoj světe");
  });

  it("keeps emoji sequences joined by ZWJ", () => {
    const family = ["👨", "👩", "👧"].join(CH.zwj);
    expect(sanitizeNote(`Díky ${family}`, 120)).toBe(`Díky ${family}`);
  });

  it("never lets the marker through, even when built from pieces", () => {
    expect(sanitizeNote("a [dys[dyska:ka:x b", 120)).not.toMatch(/\[dyska:/i);
  });

  it("cuts to maxLength in characters, not UTF-16 units", () => {
    expect(Array.from(sanitizeNote("😀".repeat(10), 3)).length).toBe(3);
  });
});

describe("gift fragment in #remark", () => {
  it("keeps the customer text and appends the fragment last", () => {
    expect(applyGiftFragment("Zvoňte dvakrát", ["Ahoj"], REF, 0)).toBe(`Zvoňte dvakrát\nVěnování: Ahoj\n[dyska:${REF}]`);
  });

  it("is idempotent and replaces an older fragment", () => {
    const once = applyGiftFragment("Zvoňte dvakrát", ["Ahoj"], REF, 0);
    expect(applyGiftFragment(once, ["Ahoj"], REF, 0)).toBe(once);
    expect(applyGiftFragment(once, ["Nové", "Druhé"], REF, 0)).toBe(
      `Zvoňte dvakrát\nVěnování 1: Nové\nVěnování 2: Druhé\n[dyska:${REF}]`,
    );
  });

  it("removes only our fragment when there are no notes", () => {
    const once = applyGiftFragment("Zvoňte dvakrát", ["Ahoj"], REF, 0);
    expect(applyGiftFragment(once, [], REF, 0)).toBe("Zvoňte dvakrát");
    expect(applyGiftFragment(`Věnování: moje vlastní poznámka`, [], null, 0)).toBe("Věnování: moje vlastní poznámka");
  });

  it("respects a length limit, shortening the customer text first and keeping the marker", () => {
    const limit = 60;
    const out = applyGiftFragment("x".repeat(100), ["Ahoj"], REF, limit);
    expect(out.length).toBeLessThanOrEqual(limit);
    expect(out.endsWith(`[dyska:${REF}]`)).toBe(true);
    expect(out).toContain("Věnování: Ahoj");
  });

  it("drops trailing notes when even the fragment does not fit, but keeps the marker", () => {
    const out = applyGiftFragment("", ["a".repeat(30), "b".repeat(30)], REF, 70);
    expect(out.length).toBeLessThanOrEqual(70);
    expect(out.endsWith(`[dyska:${REF}]`)).toBe(true);
  });

  it("without a ref writes the visible text only, and replaces it on the next write (given what was written)", () => {
    const first = applyGiftFragment("Pozn.", ["Ahoj"], null, 0);
    expect(first).toBe("Věnování: Ahoj\nPozn.");
    const written = giftFragment(["Ahoj"], null, 0);
    expect(applyGiftFragment(first, ["Ahoj"], null, 0, [written])).toBe(first);
    expect(applyGiftFragment(first, ["Jiné", "Dvě"], null, 0, [written])).toBe("Věnování 1: Jiné\nVěnování 2: Dvě\nPozn.");
  });

  it("stripGiftFragment leaves text without our marker alone", () => {
    expect(stripGiftFragment("Věnování: moje\nzbytek")).toBe("Věnování: moje\nzbytek");
  });
});

// The customer may type lines that look like ours; only the fragment we wrote may be removed.
describe("gift fragment: the customer's own 'Věnování' lines", () => {
  const OWN = "Věnování: pro babičku";

  it("keeps a customer line directly above our fragment (single card)", () => {
    const once = applyGiftFragment(OWN, ["Ahoj"], REF, 0);
    expect(once).toBe(`${OWN}\nVěnování: Ahoj\n[dyska:${REF}]`);
    expect(stripGiftFragment(once)).toBe(OWN);
    expect(applyGiftFragment(once, [], REF, 0)).toBe(OWN);
  });

  it("keeps customer lines above a numbered fragment, whatever their numbers", () => {
    const customer = "Věnování 1: moje\nVěnování 2: taky moje";
    const once = applyGiftFragment(customer, ["A", "B"], REF, 0);
    expect(once).toBe(`${customer}\nVěnování 1: A\nVěnování 2: B\n[dyska:${REF}]`);
    expect(stripGiftFragment(once)).toBe(customer);
  });

  it("is idempotent for a double write (submit + hook), with and without customer lines", () => {
    for (const customer of ["", OWN, "Zvoňte\nVěnování 1: x"]) {
      const once = applyGiftFragment(customer, ["Ahoj", "Čau"], REF, 0);
      expect(applyGiftFragment(once, ["Ahoj", "Čau"], REF, 0)).toBe(once);
      expect(applyGiftFragment(applyGiftFragment(once, ["Ahoj", "Čau"], REF, 0), ["Ahoj", "Čau"], REF, 0)).toBe(once);
    }
  });

  it("never removes a customer line when there is no marker", () => {
    expect(stripGiftFragment(OWN)).toBe(OWN);
    expect(stripGiftFragment(`${OWN}\nVěnování 2: x`)).toBe(`${OWN}\nVěnování 2: x`);
    expect(applyGiftFragment(OWN, ["Ahoj"], REF, 0).startsWith(OWN)).toBe(true);
  });

  it("takes only a numbered run that counts down to 1 immediately above the marker", () => {
    const text = `Věnování 3: cizí\nVěnování 1: A\nVěnování 2: B\n[dyska:${REF}]`;
    expect(stripGiftFragment(text)).toBe("Věnování 3: cizí");
  });

  it("recognises an unmarked fragment only as an exact copy of what was written at the start or the end", () => {
    const written = giftFragment(["Ahoj"], null, 0);
    expect(stripGiftFragment(`${OWN}\n${written}`, [written])).toBe(OWN);
    expect(stripGiftFragment(`${written}\n${OWN}`, [written])).toBe(OWN);
    // the same line in the middle or a different text is the customer's
    expect(stripGiftFragment(`a\n${written}\nb`, [written])).toBe(`a\n${written}\nb`);
    expect(stripGiftFragment(`${written}x\nzbytek`, [written])).toBe(`${written}x\nzbytek`);
    expect(stripGiftFragment(OWN, [written])).toBe(OWN);
    expect(stripGiftFragment("xVěnování: Ahoj", [written])).toBe("xVěnování: Ahoj");
  });

  it("strips both a trailing unmarked fragment and a marked one", () => {
    const written = giftFragment(["Ahoj"], null, 0);
    const remark = `Zvoňte\n${written}`;
    expect(applyGiftFragment(remark, ["Ahoj"], REF, 0, [written])).toBe(`Zvoňte\nVěnování: Ahoj\n[dyska:${REF}]`);
  });
});

describe("cutting by code points", () => {
  const LONE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

  it("cutChars never splits a surrogate pair", () => {
    expect(cutChars("a😀b😀c", 3)).toBe("a😀b");
    expect(cutChars("😀😀", 1)).toBe("😀");
    expect(cutChars("abc", 0)).toBe("");
  });

  it("the remark limit (UTF-16 units) never leaves a lone surrogate, in the customer text or in a note", () => {
    for (let limit = 30; limit < 80; limit += 1) {
      const out = applyGiftFragment("😀".repeat(40), ["😀".repeat(30)], REF, limit);
      expect(out.length).toBeLessThanOrEqual(limit);
      expect(out).not.toMatch(LONE);
      const unmarked = applyGiftFragment("😀".repeat(40), ["😀".repeat(30)], null, limit);
      expect(unmarked.length).toBeLessThanOrEqual(limit);
      expect(unmarked).not.toMatch(LONE);
    }
  });

  it("shortens the first note by the UTF-16 room that is left, consistently with the limit", () => {
    const out = applyGiftFragment("", ["😀".repeat(50)], REF, 60);
    expect(out.endsWith(`[dyska:${REF}]`)).toBe(true);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out).not.toMatch(LONE);
  });

  it("sanitizeNote cuts to code points and leaves no trailing space", () => {
    expect(sanitizeNote("ab cd", 3)).toBe("ab");
    expect(Array.from(sanitizeNote("😀".repeat(10), 3))).toHaveLength(3);
  });
});

describe("invisible characters", () => {
  const cp = (...codes) => String.fromCodePoint(...codes);
  const STRIPPED = [
    ["line separator", cp(0x2028)],
    ["paragraph separator", cp(0x2029)],
    ["Mongolian vowel separator", cp(0x180e)],
    ["combining grapheme joiner", cp(0x34f)],
    ["interlinear annotation", cp(0xfff9, 0xfffa, 0xfffb)],
    ["tag characters", cp(0xe0001, 0xe0041, 0xe007f)],
    ["Arabic number sign (other Cf)", cp(0x600)],
    ["bidi isolate", cp(0x2066, 0x2069)],
  ];

  it.each(STRIPPED)("removes %s", (_name, chars) => {
    expect(sanitizeNote(`a${chars}b`, 120)).toBe("ab");
  });

  it("keeps a flag sequence with tags, but not stray tags next to it", () => {
    const england = cp(0x1f3f4, 0xe0067, 0xe0062, 0xe0065, 0xe006e, 0xe0067, 0xe007f);
    expect(sanitizeNote(`Hi ${england}`, 120)).toBe(`Hi ${england}`);
    expect(sanitizeNote(`Hi ${cp(0xe0067)}${england}${cp(0xe007f)}`, 120)).toBe(`Hi ${england}`);
    expect(sanitizeNote(`${cp(0x1f3f4)}${cp(0xe0067)}`, 120)).toBe(cp(0x1f3f4));
  });

  it("keeps ZWJ only between two emoji", () => {
    expect(sanitizeNote(`a${CH.zwj}b`, 120)).toBe("ab");
    expect(sanitizeNote(`😀${CH.zwj}`, 120)).toBe("😀");
    expect(sanitizeNote(`👨${CH.zwj}👩`, 120)).toBe(`👨${CH.zwj}👩`);
  });
});

describe("gift fragment: language and placement", () => {
  it("uses Venovanie for Slovak shops and Věnování otherwise", () => {
    expect(formatGiftRemark(["Ahoj"], REF, "sk")).toBe(`Venovanie: Ahoj\n[dyska:${REF}]`);
    expect(formatGiftRemark(["A", "B"], REF, "sk")).toBe(`Venovanie 1: A\nVenovanie 2: B\n[dyska:${REF}]`);
    expect(formatGiftRemark(["Ahoj"], REF, "cs")).toBe(`Věnování: Ahoj\n[dyska:${REF}]`);
    expect(formatGiftRemark(["Ahoj"], REF)).toBe(`Věnování: Ahoj\n[dyska:${REF}]`);
  });

  it("recognises and replaces a marked fragment of either language", () => {
    const sk = applyGiftFragment("Zvoňte", ["Ahoj", "Čau"], REF, 0, [], "sk");
    expect(sk).toBe(`Zvoňte\nVenovanie 1: Ahoj\nVenovanie 2: Čau\n[dyska:${REF}]`);
    expect(stripGiftFragment(sk)).toBe("Zvoňte");
    expect(applyGiftFragment(sk, ["Nové"], REF, 0, [], "cs")).toBe(`Zvoňte\nVěnování: Nové\n[dyska:${REF}]`);
    expect(stripGiftFragment(`Zvoňte\nVenovanie: Ahoj\n[dyska:${REF}]`)).toBe("Zvoňte");
  });

  it("puts a fragment without a marker FIRST (the backend fallback reads only a remark that starts with it)", () => {
    expect(applyGiftFragment("Zvoňte", ["Ahoj"], null, 0, [], "sk")).toBe("Venovanie: Ahoj\nZvoňte");
    expect(applyGiftFragment("", ["Ahoj"], null, 0)).toBe("Věnování: Ahoj");
    const written = giftFragment(["Ahoj"], null, 0, "sk");
    expect(applyGiftFragment("Venovanie: Ahoj\nZvoňte", ["Nové"], null, 0, [written], "sk")).toBe("Venovanie: Nové\nZvoňte");
  });

  it("with a length limit the unmarked fragment stays and the customer text is shortened", () => {
    const value = applyGiftFragment("x".repeat(100), ["Ahoj"], null, 30);
    expect(value.length).toBeLessThanOrEqual(30);
    expect(value.startsWith("Věnování: Ahoj\n")).toBe(true);
  });
});
