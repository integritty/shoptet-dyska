import { CODE_PREFIX, TIP_CODE_PREFIX } from "./constants.js";
import { createCartSteps } from "./cart-steps.js";
import { quantityOf } from "./shoptet.js";

// Cart changes expressed as absolute targets ("this tip", "service on", "n cards"), always computed from the
// cart as it is when the change runs. Each returns true when the data layer shows the wanted result.
// The new item goes in before the old one is removed, so a failure leaves the cart as it was.
export function createActions({ config, ops, knownCodes, cardLimit }) {
  const { linesWhere, linesOf, removeAll, addChecked, replaceLine, takePriceIssue } = createCartSteps({ config, ops });

  async function setTip(code) {
    const lines = linesWhere((line) => line.code.startsWith(TIP_CODE_PREFIX));
    const same = lines.filter((line) => line.code === code);
    const others = lines.filter((line) => line.code !== code);
    // Choosing the selected coin again deselects it.
    if (same.length === 1 && same[0].quantity === 1 && others.length === 0) return removeAll(lines);
    if (same.length === 0) {
      // Switching: the new coin goes in first, so a failure leaves the old tip untouched.
      if (!(await addChecked(code, 1))) return false;
    } else if (same.length > 1 || same[0].quantity !== 1) {
      if (!(await replaceLine(same, code, 1))) return false;
    }
    if (await removeAll(others)) return true;
    // The old coin would not go: drop the new one again so that there is still exactly one tip.
    if (same.length === 0) await removeAll(linesOf(code));
    return false;
  }

  async function setService(item, on) {
    const lines = linesOf(item.code);
    if (on) return lines.length > 0 ? true : addChecked(item.code, 1);
    return removeAll(lines);
  }

  // The quantity of the card line is the number of cards. Fewer cards = replace the line with a smaller one.
  async function setCards(count) {
    const code = config.giftCard.code;
    const wanted = Math.max(0, Math.min(cardLimit, count));
    const lines = linesOf(code);
    const current = quantityOf(lines, code);
    if (wanted === current) return true;
    if (wanted > current) return addChecked(code, wanted - current);
    return replaceLine(lines, code, wanted);
  }

  // Brings quantities back to what the block offers: one tip line with quantity 1, services once, cards within the limit.
  async function normalize() {
    const tips = linesWhere((line) => knownCodes.has(line.code) && line.code.startsWith(TIP_CODE_PREFIX));
    if (tips.length > 1 || (tips.length === 1 && tips[0].quantity !== 1)) {
      const keep = tips[0].code;
      const sameCode = tips.filter((line) => line.code === keep);
      if (!(await replaceLine(sameCode, keep, 1))) return false;
      if (!(await removeAll(tips.filter((line) => line.code !== keep)))) return false;
    }
    for (const item of [config.parcelProtection, config.priorityShipping]) {
      const lines = item ? linesOf(item.code) : [];
      if (lines.length > 0 && (lines.length > 1 || lines[0].quantity !== 1)) {
        if (!(await replaceLine(lines, item.code, 1))) return false;
      }
    }
    if (config.giftCard && quantityOf(linesOf(config.giftCard.code), config.giftCard.code) > cardLimit) return setCards(cardLimit);
    return true;
  }

  return {
    setTip,
    setService,
    setCards,
    normalize,
    // Lines of carriers the backend no longer offers (not READY any more, disabled, price changed).
    removeOrphans: () => removeAll(linesWhere((line) => line.code.startsWith(CODE_PREFIX) && !knownCodes.has(line.code))),
    takePriceIssue,
  };
}
