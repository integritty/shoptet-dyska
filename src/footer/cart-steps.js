import { quantityOf, readCartLines } from "./shoptet.js";

// Unit price in minor units per carrier code, as the backend announced it.
function priceTable(config) {
  const prices = new Map(config.tips.map((tip) => [tip.code, tip.amount]));
  for (const item of [config.parcelProtection, config.priorityShipping, config.giftCard]) {
    if (item) prices.set(item.code, item.price);
  }
  return prices;
}

// Building blocks for cart changes on top of `ops`: reading lines, removing, adding with a price check and
// replacing a line. A change that fails half way is rolled back where possible.
export function createCartSteps({ config, ops }) {
  const prices = priceTable(config);
  let priceIssue = false;
  const linesWhere = (predicate) => (readCartLines() || []).filter(predicate);
  const linesOf = (code) => linesWhere((line) => line.code === code);

  async function removeAll(lines) {
    for (const line of lines) {
      if (!(await ops.remove(line))) return false;
    }
    return true;
  }

  // The data layer carries `priceWithVat` (major units). It is not verified yet whether that is the unit price or the
  // line total (README, TODO), so only a line with quantity 1 is checked: there both are the same. A line with a higher
  // quantity, or without a readable price, cannot be checked and is accepted.
  function priceMatches(code) {
    const unit = prices.get(code);
    if (unit === undefined) return true;
    return linesOf(code).every((line) => line.quantity !== 1 || line.priceWithVat === null || Math.round(line.priceWithVat * 100) === unit);
  }

  // Adds an item and checks the price Shoptet charges; a wrong price removes the item again.
  async function addChecked(code, amount) {
    if (!(await ops.add(code, amount))) return false;
    if (priceMatches(code)) return true;
    priceIssue = true;
    await removeAll(linesOf(code));
    return false;
  }

  // Same code, new quantity: the old line has to go first (an add would only merge into it). When the new
  // line cannot be added, the old quantity is put back.
  async function replaceLine(lines, code, quantity) {
    const previous = quantityOf(lines, code);
    if (!(await removeAll(lines))) return false;
    if (quantity <= 0) return true;
    if (await addChecked(code, quantity)) return true;
    if (!priceIssue && previous > 0) await ops.add(code, previous);
    return false;
  }

  return {
    linesWhere,
    linesOf,
    removeAll,
    addChecked,
    replaceLine,
    // True once after a change was undone because Shoptet charged another price than announced.
    takePriceIssue() {
      const issue = priceIssue;
      priceIssue = false;
      return issue;
    },
  };
}
