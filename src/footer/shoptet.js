import { ESHOP_ID_RE } from "./constants.js";

// Reads a key from the Shoptet data layer: getShoptetDataLayer() first, raw dataLayer as a fallback.
export function readDataLayer(key) {
  try {
    if (typeof getShoptetDataLayer === "function") {
      const value = getShoptetDataLayer(key);
      if (value !== undefined && value !== null) return value;
    }
  } catch {
    // fall through to the raw data layer
  }
  try {
    if (typeof dataLayer !== "undefined" && Array.isArray(dataLayer)) {
      for (const entry of dataLayer) {
        if (entry && entry.shoptet && entry.shoptet[key] !== undefined) return entry.shoptet[key];
      }
    }
  } catch {
    // data layer not readable
  }
  return undefined;
}

export function getEshopId() {
  const value = String(readDataLayer("projectId") ?? "");
  return ESHOP_ID_RE.test(value) ? value : null;
}

export function getCurrency() {
  const value = readDataLayer("currency");
  return typeof value === "string" && value ? value.toUpperCase() : null;
}

// Language of the e-shop: the Shoptet data layer first, then <html lang>, otherwise Czech.
export function getLanguage() {
  const value = readDataLayer("language");
  if (typeof value === "string" && value) return value.toLowerCase().slice(0, 2);
  const lang = document.documentElement && document.documentElement.getAttribute("lang");
  return lang ? lang.toLowerCase().slice(0, 2) : "cs";
}

// Returns "cart", "step1", "step2", "thankyou" or "other".
export function detectPage(pathname, pageType) {
  const path = String(pathname || "");
  if (/(?:^|\/)objednavka\/krok-2\/?$/.test(path)) return "step2";
  if (/(?:^|\/)objednavka\/krok-1\/?$/.test(path)) return "step1";
  if (/(?:^|\/)kosik\/?$/.test(path) || pageType === "cart") return "cart";
  if (pageType === "thankYou") return "thankyou";
  return "other";
}

// Normalised cart lines from the data layer, or null when the cart is not available there.
export function readCartLines() {
  const cart = readDataLayer("cart");
  if (!Array.isArray(cart)) return null;
  const lines = [];
  for (const item of cart) {
    if (!item || typeof item.code !== "string") continue;
    const quantity = Number(item.quantity);
    const unitPrice = item.priceWithVat === undefined || item.priceWithVat === null ? NaN : Number(item.priceWithVat);
    lines.push({
      code: item.code.toUpperCase(),
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
      itemId: item.itemId === undefined ? undefined : String(item.itemId),
      priceId: item.priceId === undefined ? undefined : String(item.priceId),
      // Unit price with VAT in major units (10.5 = 10.50), or null when the data layer does not carry it.
      priceWithVat: Number.isFinite(unitPrice) ? unitPrice : null,
    });
  }
  return lines;
}

export function quantityOf(lines, code) {
  const wanted = String(code).toUpperCase();
  return (lines || []).filter((line) => line.code === wanted).reduce((sum, line) => sum + line.quantity, 0);
}
