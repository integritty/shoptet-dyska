// Price formatting and the order remark format shared with the backend.

const LOCALES = { cs: "cs-CZ", sk: "sk-SK" };

// Amounts are integers in minor units (10 CZK = 1000, 0.5 EUR = 50). Locale and currency come from the e-shop.
export function formatPrice(minor, currency, language) {
  const amount = minor / 100;
  const whole = minor % 100 === 0;
  const locale = LOCALES[language] || LOCALES.cs;
  try {
    return new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      minimumFractionDigits: whole ? 0 : 2,
      maximumFractionDigits: whole ? 0 : 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(whole ? 0 : 2)} ${currency}`;
  }
}

// Mirrors validateGiftText() in the backend (apps/api/src/notes/gift-text.ts), but removes
// disallowed characters instead of rejecting the text. Empty string when nothing usable is left.
// Forbidden: control (Cc), lone surrogates (Cs), private use (Co), line / paragraph separators (Zl, Zp), U+180E,
// U+034F (combining grapheme joiner) and every other format character (Cf: bidi, zero-width, invisible operators,
// interlinear annotation U+FFF9-FFFB, tag characters U+E0000-E007F ...). Allowed exceptions: ZWJ between two emoji
// and the tag characters of a flag sequence (U+1F3F4, tags U+E0020-E007E, cancel tag U+E007F).
const FORBIDDEN_CHAR = /[\u034F\p{Cc}\p{Cs}\p{Co}\p{Cf}\p{Zl}\p{Zp}\u180E]/u;
const EMOJI_BEFORE_JOINER = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F]/u;
const EMOJI_AFTER_JOINER = /\p{Extended_Pictographic}/u;
const FLAG_TAGS = /^[\u{E0020}-\u{E007E}]+\u{E007F}/u;

function stripForbidden(text) {
  const chars = Array.from(text);
  const kept = [];
  for (let index = 0; index < chars.length; index += 1) {
    const ch = chars[index];
    if (ch === "\u{1F3F4}") {
      const tags = FLAG_TAGS.exec(chars.slice(index + 1).join(""));
      if (tags) {
        kept.push(ch, ...Array.from(tags[0]));
        index += Array.from(tags[0]).length;
        continue;
      }
    }
    const joiner =
      ch === "\u200D" && EMOJI_BEFORE_JOINER.test(chars[index - 1] || "") && EMOJI_AFTER_JOINER.test(chars[index + 1] || "");
    if (joiner || !FORBIDDEN_CHAR.test(ch)) kept.push(ch);
  }
  return kept.join("");
}

export function charCount(text) {
  return Array.from(text).length;
}

// Cuts to `max` code points, so a surrogate pair is never split.
export function cutChars(text, max) {
  return Array.from(text).slice(0, Math.max(0, max)).join("");
}

// Cuts to at most `units` UTF-16 units (what a textarea maxlength and String#length count) on a code point boundary.
function cutUnits(text, units) {
  let out = "";
  for (const ch of text) {
    if (out.length + ch.length > units) break;
    out += ch;
  }
  return out;
}

// A merchant-defined label from the public config: sanitised like a gift text and dropped (null) when it is empty
// or longer than `max` code points. A value over the limit means a broken or tampered answer, so it is not cut.
export function cleanLabel(raw, max) {
  if (typeof raw !== "string" || raw.length > max * 2) return null;
  const text = sanitizeNote(raw, Number.MAX_SAFE_INTEGER);
  return text === "" || charCount(text) > max ? null : text;
}

export function sanitizeNote(raw, maxLength) {
  let text = String(raw).normalize("NFC").replace(/[\r\n\t]+/g, " ");
  text = stripForbidden(text);
  let previous;
  do {
    previous = text;
    text = text.replace(/\[dyska:/gi, "");
  } while (text !== previous);
  text = text.replace(/ {2,}/g, " ").trim();
  return cutChars(text, maxLength).trimEnd();
}

// The remark label follows the e-shop language (Czech or Slovak).
export function giftLabel(language) {
  return language === "sk" ? "Venovanie" : "Věnování";
}

function formatGiftBody(notes, language) {
  const label = giftLabel(language);
  return notes.length === 1 ? `${label}: ${notes[0]}` : notes.map((n, i) => `${label} ${i + 1}: ${n}`).join("\n");
}

// Same output as formatGiftRemark() in the backend (apps/api/src/orders/order-gift.ts); the backend also reads "Venovanie".
export function formatGiftRemark(notes, ref, language) {
  return `${formatGiftBody(notes, language)}\n[dyska:${ref}]`;
}

const MARKER_LINE_RE = /^\[dyska:[A-Za-z0-9_-]{22}\]$/;
// Our gift lines (either language): "<label>: <text>" for one card, "<label> <n>: <text>" for several (n counts from 1).
const GIFT_LINE_RE = /^(?:Věnování|Venovanie)(?: (\d{1,2}))?:/;

// How many lines directly above `end` form a fragment written by this block. Numbered lines must run
// n, n-1, ... 1, so a line the customer typed above our fragment (even one that looks like ours) is never taken.
function fragmentLineCount(lines, end) {
  const last = GIFT_LINE_RE.exec(lines[end - 1] || "");
  if (!last) return 0;
  if (last[1] === undefined) return 1;
  let count = 0;
  for (let expected = Number(last[1]); expected >= 1 && end - count - 1 >= 0; expected -= 1) {
    const match = GIFT_LINE_RE.exec(lines[end - count - 1]);
    if (!match || Number(match[1]) !== expected) break;
    count += 1;
  }
  return count;
}

// Removes an exact copy of `tail` that ends the text and starts on its own line.
function stripTail(text, tail) {
  let out = text.trimEnd();
  while (tail && out.endsWith(tail) && (out.length === tail.length || out[out.length - tail.length - 1] === "\n")) {
    out = out.slice(0, out.length - tail.length).trimEnd();
  }
  return out;
}

// Removes an exact copy of `head` that begins the text and ends the line.
function stripHead(text, head) {
  let out = text.trimStart();
  while (head && out.startsWith(head) && (out.length === head.length || out[head.length] === "\n")) {
    out = out.slice(head.length).trimStart();
  }
  return out;
}

// Removes the fragment written by this block and keeps everything the customer typed. A marked fragment is the
// marker line plus the gift lines above it. A fragment written without a marker (backend unreachable) is only
// recognised as an exact copy at the start or the end of the text of one of `unmarked` (the texts this block wrote earlier).
export function stripGiftFragment(remark, unmarked) {
  const out = [];
  for (const line of String(remark || "").split(/\r?\n/)) {
    if (MARKER_LINE_RE.test(line.trim())) out.length -= fragmentLineCount(out, out.length);
    else out.push(line);
  }
  let text = out.join("\n");
  for (const fragment of unmarked || []) text = stripHead(stripTail(text, fragment), fragment);
  return text.trim();
}

function fitFragment(notes, ref, limit, language) {
  const build = (list) => (ref ? formatGiftRemark(list, ref, language) : formatGiftBody(list, language));
  for (let count = notes.length; count >= 1; count -= 1) {
    const candidate = build(notes.slice(0, count));
    if (candidate.length <= limit) return candidate;
  }
  const room = limit - build([""]).length;
  if (room > 0) return build([cutUnits(notes[0], room)]);
  return ref && `[dyska:${ref}]`.length <= limit ? `[dyska:${ref}]` : "";
}

// The fragment for the given notes, shortened to `limit` UTF-16 units (0 = no limit). Without a ref there is no marker.
export function giftFragment(notes, ref, limit, language) {
  if (notes.length === 0) return "";
  const maxLen = limit > 0 ? limit : Infinity;
  const fragment = ref ? formatGiftRemark(notes, ref, language) : formatGiftBody(notes, language);
  return fragment.length > maxLen ? fitFragment(notes, ref, maxLen, language) : fragment;
}

// Writes the gift fragment into the remark. With a marker (ref): customer text first, then the fragment, the marker is
// the last line. Without a marker (backend unreachable) the fragment goes FIRST, because the backend fallback only
// reads a remark that begins with the gift label. Idempotent: any earlier fragment is replaced. `limit` is the remark
// length limit (0 = none); `unmarked` lists unmarked fragments written earlier (see stripGiftFragment).
export function applyGiftFragment(existing, notes, ref, limit, unmarked, language) {
  const base = stripGiftFragment(existing, unmarked);
  if (notes.length === 0) return base;
  const maxLen = limit > 0 ? limit : Infinity;
  const fragment = giftFragment(notes, ref, limit, language);
  if (!fragment) return cutUnits(base, maxLen);
  const room = maxLen - fragment.length - 1;
  const customer = base.length > room ? (room > 0 ? cutUnits(base, room).trimEnd() : "") : base;
  if (!customer) return fragment;
  return ref ? `${customer}\n${fragment}` : `${fragment}\n${customer}`;
}
