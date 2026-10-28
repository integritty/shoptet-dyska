# shoptet-dyska

Cart block of the **Dýška** add-on for Shoptet: a tip ("dýško"), two optional services (parcel protection, priority
shipping) and a gift card with a dedication text. It is plain browser JavaScript, built for the
[Shoptet Addon Repository](https://addon-repository-github-app.vercel.app/). The backend (installation, carrier
products, orders, statistics, administration) lives in a separate repository; this one only contains the block.

## Structure

```
src/footer/   block sources (flat ES modules, entry: index.js); bundled into dist/scripts.footer.min.js
assets/       static files copied by the Addon Repository (currently empty, the block needs no images)
test/         vitest + jsdom tests
build.mjs     esbuild bundle (IIFE, ES2020, minified, no obfuscation)
package-lock.json   npm lockfile, required by the Shoptet build (see below)
```

`dist/` is not committed; the Shoptet Addon Repository runs `npm ci && npm run build -- --env production` (Node 24) and
publishes the result, so **`package-lock.json` must be committed and in sync with `package.json`** (`npm i --package-lock-only`
after every dependency change). There is deliberately no `pnpm-lock.yaml`: two lockfiles would drift apart.
Source files are `.js` only (the Shoptet linter reads nothing else), comments are in English.

| Module | Role |
| --- | --- |
| `init.js` | idempotent start (marker attribute on `<html>`), page detection, event wiring |
| `config.js`, `api.js` | public config and notes requests: timeout, `response.ok`, never throws |
| `block.js`, `actions.js`, `cart-steps.js`, `cart-ops.js` | serialised cart changes through `shoptet.cartShared`, data layer as the source of truth, price check, rollback |
| `view.js`, `styles.js`, `dom.js`, `i18n.js` | DOM built with `createElement`/`textContent`, CSS injected as a `<style>` element, CS/SK texts |
| `notes.js` | gift texts: sessionStorage state, debounced and serialised `PUT`/`DELETE` |
| `checkout.js` | step 2 of the order: writes the gift fragment into `textarea#remark` |
| `format.js` | price formatting (`Intl.NumberFormat`), text sanitising, `#remark` format shared with the backend |

## Development

```bash
nvm use            # Node 24 (see .nvmrc); the Addon Repository builds with Node 24.15+
npm ci
npm run lint       # ESLint with the Addon Repository rules (zero warnings allowed)
npm test           # vitest + jsdom
npm run build                          # dist/scripts.footer.min.js against the development backend
npm run build -- --env production      # the same against the production backend (what Shoptet runs)
```

The backend origin is a build-time constant chosen by `build.mjs`: `--env production` gives
`https://shoptet-dyska.integritty.dev` (**temporarily the development origin** until the production backend is deployed, see `build.mjs`), `--env development` (or no `--env`) gives `https://dev-shoptet-dyska.integritty.dev` (the
default in `src/footer/api-base.js`, which `build.mjs` overrides); any other `--env` value fails the build. The Addon Repository runs the build without any environment
variables, which is why the production origin follows from `--env production` alone. `DYSKA_API_BASE` overrides the origin
in both cases (https only); `DYSKA_OUT_FILE` redirects the output (the build test uses it, so `dist/` is never overwritten by tests).

### Linter rules (what the Addon Repository reviewer rejects)

`no-console`, no `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`, `no-eval`/`no-implied-eval`/`no-new-func`,
`eqeqeq`, `max-depth` 4, no globals (no `window.x = …`; only the browser and Shoptet's `shoptet`, `dataLayer`,
`getShoptetDataLayer` are read), English comments, `response.ok` checks, data via `getShoptetDataLayer()` with a
`dataLayer` fallback, init also on `ShoptetDOMContentLoaded`, no inline scripts. `test/lint.test.js` and
`test/forbidden.test.js` check these rules too.

## How it works

- **Where it runs:** the footer script runs on every page. It acts only on `/kosik/` (block), `/objednavka/krok-2/`
  (remark hook) and the thank-you page (clears the stored gift). `/objednavka/krok-1/` is detected but not used.
- **Shop identity:** `getShoptetDataLayer('projectId')`; when the data layer does not exist yet at start, it is read again on
  every Shoptet event (`ShoptetDOMContentLoaded` ...). Currency and language come from the data layer; the block is shown only when
  the currency matches the one the backend names in `currency` (`CZK`/`EUR`; without it: CZK in a Czech shop, EUR in a Slovak one).
- **Config:** `GET {API}/api/v1/public/config?eshopId=…`, 8 s timeout (it covers reading the body too). Any failure or
  `{"active":false}` means the block is simply not shown. Only carriers the backend reports as ready are offered, and their
  codes are not trusted: a code must match `^DYSKA-(TIP-\d{1,7}|PROTECTION|PRIORITY|CARD)$`, a tip needs
  `code === "DYSKA-TIP-" + amount`, services and the card need exactly their own code, codes must be unique; anything else is
  dropped (that item is not offered). Prices are integers in minor units (`priceUnit: "minor"`), formatted with `Intl.NumberFormat`.
- **Texts:** the block is available in Czech and Slovak only (`i18n.js`; the language comes from the data layer, then `<html lang>`; anything but `sk`
  gives Czech). Other languages are not supported on purpose: the add-on is sold for CZ and SK shops.
- **Cart:** the cart in the data layer is the single source of truth, nothing is cached. A change calls
  `shoptet.cartShared.addToCart({productCode, amount}, true)` / `removeFromCart({itemId, priceId, amount})` and resolves only
  when the data layer shows the result; a rejected promise or an answer body with `code >= 400` (Shoptet answers HTTP 200 with
  `{code: 500}` on failure) ends the wait at once instead of after the 8 s timeout. Changes run one after another; cart events
  that arrive meanwhile are ignored and one re-render follows (no loops); clicks while a change runs are ignored (the controls
  carry `aria-disabled`, never `disabled`, so keyboard focus is kept). Switching a coin adds the new one first and removes the old one
  only afterwards (a failed add leaves the old tip, a failed removal takes the new one out again), so there is at most one tip.
  Cards are one line whose quantity is the number of cards. Quantities the block cannot show (a tip or service with quantity > 1,
  two tip lines, more cards than allowed) are normalised once automatically (quantity 1, cards within the limit); if that fails
  the error stays and nothing is retried in a loop. Cart lines of carriers that are no longer offered get a notice with a remove button.
  After an added item the `priceWithVat` in the data layer is compared with the announced price, **only for lines with
  quantity 1** (it is not verified whether `priceWithVat` is a unit price or a line total, see TODO); a difference removes the
  item again and shows an error. A line with a higher quantity or without `priceWithVat` cannot be checked and is accepted.
  After any successful change (even when a later step failed) `shoptet.cart.getCartContent(true)` redraws the cart table (page
  reload if that function does not exist).
- **Gift text:** one textarea per card, limited to the config `maxLength` in code points (no `maxlength` attribute, which would count
  UTF-16 units; the input handler cuts the text and the counter shows code points). Typing is debounced (700 ms) into
  `PUT /api/v1/public/notes` with the known `ref`; the server answers with the ref to keep, which is a new one when it did not know
  the sent one (expired or used). An empty text or a removed card sends `DELETE`. State is kept in `sessionStorage` under
  `dyska:gift` (`ref`, texts, card code, max length, `synced`, `written`); without storage it works in memory only.
  Errors: `429` is retried after `Retry-After` (30 s when absent, at most 120 s); the third `429` with `reason: "capacity"` in a row
  stops all sending until the page is loaded again; `400` is not retried for the same text;
  `404` (`unavailable`: add-on or gift card switched off) hides the block and stops all requests; other failures leave the state
  "not synced". When the page is left (`pagehide`), a pending or running request is sent with `keepalive`, also as the follow-up
  of a request that was already in flight.
- **Step 2:** `shoptet.custom.postSuccessfulValidation` is wrapped (chained, never replaced; re-wrapped if another script
  replaces it) and a `submit` listener is added as a backup. Both write the same, idempotent fragment into `#remark`
  (and open the note field via `#add-note`):

  ```
  <customer text>
  Věnování: <text>                              one card
  Věnování 1: <text 1>\nVěnování 2: <text 2>     several cards (Slovak shops: "Venovanie")
  [dyska:<ref>]                                 marker, last line
  ```

  The format is produced by `formatGiftRemark` (same as `apps/api/src/orders/order-gift.ts` in the backend; the samples in
  `test/format.test.js` are copied from its tests). Only our own fragment is replaced: the marker line plus the gift lines
  directly above it (a single line, or a numbered run counting down to 1), so a customer line such as "Věnování: pro babičku"
  stays. Text the customer typed is kept and, if the remark has a length limit (UTF-16 units, cut on code point boundaries), shortened
  first so the marker survives. Texts are sanitised like the backend validator (whitespace collapsed, control/bidi characters
  removed, `[dyska:` never sent). Forbidden characters: control, lone surrogates, private use, line/paragraph separators
  (U+2028/2029), U+180E, U+034F and every other format character (`\p{Cf}`, including U+FFF9-FFFB and tag characters), except
  a ZWJ between two emoji and the tags of a flag sequence; the backend applies the same rule.
- **Unsynced text:** when the stored state is not synced (a request failed or the page was left before it finished), step 2 first
  tries to send the text again (once per page, `429` waits for `Retry-After`) and writes the fragment **without the marker** (visible
  text only) at the **start** of the remark (the backend fallback only reads a remark that begins with the gift label), even when an old ref is stored, because that ref may point at stale text. The unmarked fragment is remembered
  (`written`) so that coming back to step 2 (Shoptet restores `#remark`) replaces it instead of duplicating it; the first write after
  a successful retry uses the ref the server returned. When the cart cannot be read in step 2, text is written only if it is synced and has a ref; otherwise nothing is written. The hook is wrapped at most a few times and does its work once even if a
  foreign script wraps it again.

## Appearance and texts

The merchant can change colours, the corner radius and the texts in the administration of the add-on (tab "Vzhled a texty").
The backend sends them in the public config as two optional objects with **filled values only** (never `null`); an older
backend sends none of them and the block then looks exactly as before. Like everything else from the backend, they are
**validated again** in `config.js` (`normalizeConfig`):

| Field | Rule | Effect |
| --- | --- | --- |
| `appearance.accentColor` | `^#[0-9a-fA-F]{6}$` | `--dyska-accent` on the block root (selected coin, checkbox, focus ring); default `currentColor` of the template |
| `appearance.borderColor` | same | `--dyska-border`; default a neutral semi-transparent grey |
| `appearance.borderRadius` | integer 0-24 | `--dyska-radius` in px; default 8 |
| `texts.<key>` | whitelisted key, string, sanitised like a gift text (control/format characters and `[dyska:` removed), non-empty, within the limit, otherwise dropped (not cut) | overrides the default text for the shop language |

Variables are set with `style.setProperty` on the root only for validated values; the text goes through `textContent`
only. Text keys and limits (code points): `blockTitle` 120, `blockSubtitle` 240, `tipTitle` 120, `tipHint` 300, `tipThanks` 80,
`servicesTitle` 120, `parcelProtectionName` 80, `parcelProtectionHint` 200, `priorityShippingName` 80,
`priorityShippingHint` 200, `giftTitle` 120 (the card price is appended in brackets), `giftHint` 300, `giftPlaceholder` 120
(the placeholder of the dedication field). `blockTitle` / `blockSubtitle` are rendered as a heading (`h2.dyska-block-title`,
`p.dyska-block-subtitle`) above the cards only when filled. There is one set of texts per shop (the merchant writes in the
shop language); texts that are not set keep the Czech / Slovak defaults from `i18n.js` (`textsFor(language, overrides)`).
The administration keeps a copy of the defaults (placeholders and preview) in `apps/admin/src/block-defaults.ts` of the
backend repository: change both together.

## Backend contract

| Call | Used for |
| --- | --- |
| `GET /api/v1/public/config?eshopId=` | `active`, `priceUnit:"minor"`, `parcelProtection`, `priorityShipping`, `giftCard` (`enabled`, `price`, `maxLength`, `allowMultiple`), `carriers` (`tips[{amount,code}]`, `parcelProtection{code}`, `priorityShipping{code}`, `giftCard{code}`), optional `appearance` and `texts` (see "Appearance and texts") |
| `PUT /api/v1/public/notes` `{eshopId, ref?, notes[]}` | store or overwrite the gift texts, returns `{ref}` |
| `DELETE /api/v1/public/notes` `{eshopId, ref}` | the customer deleted the text or removed the cards |

No cookies are sent (`credentials: "omit"`), the `ref` travels only in request bodies.

## TODO: verify on a live Shoptet shop

Everything below is an assumption taken from measurements during development or from general Shoptet behaviour; it was not
exercised against a live storefront.

- [ ] Mount point on `/kosik/` per template: the list in `MOUNT_TARGETS` (`.cart-table`, `.cart-content`, `#content-wrapper`, `main`) is a guess. `<div id="dyska-mount">` overrides it.
- [ ] After a silent `addToCart`/`removeFromCart` the data layer `cart` is updated and `ShoptetDataLayerUpdated` fires; otherwise the block reports an error after 8 s. Whether the call returns a promise-like value resolving with `{code: 200|500}` (documented for the AJAX response) is also unverified; without it only the timeout applies.
- [ ] `priceWithVat` in `dataLayer.shoptet.cart[]` is the unit price with VAT in major units. Until verified, the price check runs only for lines with quantity 1 (TODO: for quantity > 1 compare unit price once this is confirmed, and `itemPrice` vs `unitPrice`).
- [ ] `shoptet.cart.getCartContent(true)` exists and redraws the cart table (otherwise the block reloads the page after every change).
- [ ] `removeFromCart` semantics of `amount`: the block always removes the whole line and re-adds (it never uses `updateQuantityInCart`, whose semantics are unmeasured).
- [ ] Step 2: `textarea#remark` and `#add-note`, whether `postSuccessfulValidation` is called on every submit path, any `maxlength`/server limit of the remark, the exact `dataLayer.pageType` values (`thankYou`).
- [ ] Mini cart / side panel and "quick checkout" are not handled (the docs do not confirm they exist as separate DOM).
- [ ] Step 1 (`/objednavka/krok-1/`) does not show the block; decide whether it should.
- [ ] Slovak URLs (`/kosik/`, `/objednavka/krok-2/`) and language-prefixed shops (`/sk/kosik/`).
- [ ] Template matrix (Classic, Step, Techno, Tango, Waltz, Disco, Samba and Designer templates): CSS conflicts, dark templates, mobile layout, keyboard and screen-reader behaviour.
- [ ] Interaction with discounts, free shipping thresholds, gift-with-order add-ons and coupons (carriers count towards the cart value).
- [ ] CORS preflight for `PUT`/`DELETE` with `keepalive` when the page is closed (best effort).
- [ ] Addon Repository: `npm ci && npm run build -- --env production` is what is run (production origin from `--env production`), a `<style>` element injected by script is accepted (CSP), subfolders/flat layout of `src/footer`, no obfuscation, `--env` accepts only `production` or `development` (anything else fails the build; no `--env` means development).
- [ ] Backend: the public config now carries `currency` (derived from the shop language) and the optional `appearance` / `texts` customisation; the built-in default texts exist in Czech and Slovak only.
- [ ] The backend fallback for the dedication text only reads a remark that starts with the gift label, so the unmarked fragment is written first. With a marker the fragment follows the customer's text (the `ref` marker is used, so the fallback only matters when the stored note expired). The fallback takes the whole remark as the gift text, including the customer's own lines below the fragment.
