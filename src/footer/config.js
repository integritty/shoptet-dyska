import { getPublicConfig } from "./api.js";
import {
  CARRIER_CODE_RE,
  DEFAULT_CARD_CODE,
  HEX_COLOR_RE,
  PRIORITY_CODE,
  PROTECTION_CODE,
  RADIUS_MAX,
  RADIUS_MIN,
  TEXT_LIMITS,
  TIP_CODE_PREFIX,
} from "./constants.js";
import { cleanLabel } from "./format.js";

const isMinor = (value) => Number.isInteger(value) && value >= 0;

// The carrier code is used as a cart product code, so it is never taken on trust: it must be on the whitelist,
// be exactly the code of its own kind, and be unique. Anything else is dropped (the item is not offered).
function validCode(carrier, expected) {
  if (!carrier || typeof carrier.code !== "string" || !CARRIER_CODE_RE.test(carrier.code)) return null;
  return carrier.code === expected ? carrier.code : null;
}

function readService(setting, carrier, expected) {
  if (!setting || setting.enabled !== true || !isMinor(setting.price)) return null;
  const code = validCode(carrier, expected);
  return code ? { code, price: setting.price } : null;
}

function readGift(setting, carrier) {
  const service = readService(setting, carrier, DEFAULT_CARD_CODE);
  if (!service || !Number.isInteger(setting.maxLength) || setting.maxLength < 1 || setting.maxLength > 250) return null;
  return { ...service, maxLength: setting.maxLength, allowMultiple: setting.allowMultiple === true };
}

function readTips(list, used) {
  const tips = [];
  for (const tip of Array.isArray(list) ? list : []) {
    if (!tip || !Number.isInteger(tip.amount) || tip.amount <= 0) continue;
    const code = validCode(tip, `${TIP_CODE_PREFIX}${tip.amount}`);
    if (!code || used.has(code)) continue;
    used.add(code);
    tips.push({ amount: tip.amount, code });
  }
  return tips.sort((a, b) => a.amount - b.amount);
}

// Keeps a single-use service only when its code was not claimed by another item.
function unique(service, used) {
  if (!service || used.has(service.code)) return null;
  used.add(service.code);
  return service;
}

// Keeps only values that are safe to put into CSS custom properties: #rrggbb colours and an integer radius.
function readAppearance(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of ["accentColor", "borderColor"]) {
    if (typeof raw[key] === "string" && HEX_COLOR_RE.test(raw[key])) out[key] = raw[key].toLowerCase();
  }
  if (Number.isInteger(raw.borderRadius) && raw.borderRadius >= RADIUS_MIN && raw.borderRadius <= RADIUS_MAX) {
    out.borderRadius = raw.borderRadius;
  }
  return out;
}

// Whitelisted keys only, each a clean non-empty string within its limit (shown with textContent, never as HTML).
function readTexts(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of Object.keys(TEXT_LIMITS)) {
    const text = cleanLabel(raw[key], TEXT_LIMITS[key]);
    if (text) out[key] = text;
  }
  return out;
}

// Validates the public config. Only carriers that the backend reports as ready are offered.
// Returns null when the add-on is inactive, the shape is unexpected or nothing would be shown.
export function normalizeConfig(raw) {
  if (!raw || raw.active !== true || raw.priceUnit !== "minor") return null;
  const carriers = raw.carriers;
  if (!carriers || typeof carriers !== "object") return null;
  const used = new Set();
  const tips = readTips(carriers.tips, used);
  const config = {
    currency: typeof raw.currency === "string" && raw.currency ? raw.currency.toUpperCase() : null,
    tips,
    parcelProtection: unique(readService(raw.parcelProtection, carriers.parcelProtection, PROTECTION_CODE), used),
    priorityShipping: unique(readService(raw.priorityShipping, carriers.priorityShipping, PRIORITY_CODE), used),
    giftCard: unique(readGift(raw.giftCard, carriers.giftCard), used),
    // Optional (older backends do not send them): customisation of the look and the texts.
    appearance: readAppearance(raw.appearance),
    texts: readTexts(raw.texts),
  };
  const empty = tips.length === 0 && !config.parcelProtection && !config.priorityShipping && !config.giftCard;
  return empty ? null : config;
}

// Currency gate: the backend amounts are in the shop currency and carry no code, so the block is rendered
// only for the currency expected for the shop language (CZK for cs, EUR for sk), or the one the backend names.
export function currencyMatches(config, currency, language) {
  if (!currency) return false;
  if (config.currency) return config.currency === currency;
  return language === "sk" ? currency === "EUR" : currency === "CZK";
}

// Never throws: any failure means "do not show the block".
export async function loadConfig(eshopId, options) {
  try {
    return normalizeConfig(await getPublicConfig(eshopId, options));
  } catch {
    return null;
  }
}
