import { CART_EVENTS, CART_POLL_MS, CART_WAIT_TIMEOUT_MS } from "./constants.js";
import { readCartLines } from "./shoptet.js";

function cartShared() {
  if (typeof shoptet === "undefined" || !shoptet || !shoptet.cartShared) throw new Error("shoptet.cartShared is not available");
  return shoptet.cartShared;
}

// Resolves true as soon as the cart in the data layer satisfies `predicate`, false on timeout or as soon as
// `shouldAbort()` says the request already failed. The data layer is the single source of truth: a success
// answer of the Shoptet API is never trusted on its own, only a failure is used to stop waiting early.
export function waitForCart(predicate, options, shouldAbort) {
  const timeoutMs = (options && options.timeoutMs) || CART_WAIT_TIMEOUT_MS;
  const pollMs = (options && options.pollMs) || CART_POLL_MS;
  return new Promise((resolve) => {
    let finished = false;
    let timeoutTimer = null;
    let pollTimer = null;
    const finish = (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutTimer);
      clearInterval(pollTimer);
      for (const name of CART_EVENTS) document.removeEventListener(name, check);
      resolve(result);
    };
    function check() {
      try {
        if (shouldAbort && shouldAbort()) finish(false);
        else if (predicate(readCartLines() || [])) finish(true);
      } catch {
        // a predicate that throws counts as "not yet"
      }
    }
    for (const name of CART_EVENTS) document.addEventListener(name, check);
    pollTimer = setInterval(check, pollMs);
    timeoutTimer = setTimeout(() => finish(false), timeoutMs);
    check();
  });
}

// The Shoptet cart API answers HTTP 200 with a body like {code: 500}. Returns a probe that turns true as soon as
// the returned promise (if there is one) rejects or resolves with such a failure code.
function watchResult(result) {
  const probe = { failed: false };
  if (result && typeof result.then === "function") {
    result.then(
      (value) => {
        if (value && typeof value === "object" && Number(value.code) >= 400) probe.failed = true;
      },
      () => {
        probe.failed = true;
      },
    );
  }
  return () => probe.failed;
}

// Asks Shoptet to redraw the cart table; falls back to a page reload when that function does not exist.
export function refreshCartContent() {
  try {
    if (typeof shoptet !== "undefined" && shoptet.cart && typeof shoptet.cart.getCartContent === "function") {
      shoptet.cart.getCartContent(true);
      return;
    }
  } catch {
    // fall back to reload below
  }
  window.location.reload();
}

// Cart mutations through shoptet.cartShared. Each call resolves true only once the data layer shows the result,
// and false right away when the API reports a failure (rejection or a body with code >= 400).
export function createCartOps(options) {
  const waitOptions = options || {};
  return {
    async add(code, amount) {
      const before = (readCartLines() || []).filter((line) => line.code === code).reduce((sum, line) => sum + line.quantity, 0);
      const failed = watchResult(cartShared().addToCart({ productCode: code, amount }, true));
      return waitForCart(
        (lines) => lines.filter((line) => line.code === code).reduce((sum, line) => sum + line.quantity, 0) >= before + amount,
        waitOptions,
        failed,
      );
    },
    async remove(line) {
      const failed = watchResult(cartShared().removeFromCart({ itemId: line.itemId, priceId: line.priceId, amount: line.quantity }));
      return waitForCart(
        (lines) => !lines.some((other) => (line.itemId !== undefined ? other.itemId === line.itemId : other.code === line.code)),
        waitOptions,
        failed,
      );
    },
    refresh: waitOptions.refresh || refreshCartContent,
  };
}
