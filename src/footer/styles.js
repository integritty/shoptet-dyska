import { STYLE_ATTR } from "./constants.js";

// Neutral styling that inherits font and colours from the template (currentColor, inherit). Every colour can be
// overridden with CSS variables on .dyska-block (--dyska-accent, --dyska-border, --dyska-surface, --dyska-radius).
// Borders and highlights are semi-transparent so the block works on light and dark templates alike.
export const CSS_TEXT = `
.dyska-block{--dyska-accent:currentColor;--dyska-border:rgba(128,128,128,.45);--dyska-surface:rgba(128,128,128,.12);--dyska-radius:8px;box-sizing:border-box;display:grid;gap:16px;margin:24px 0;font:inherit;color:inherit;text-align:left}
.dyska-block *,.dyska-block *::before,.dyska-block *::after{box-sizing:border-box}
.dyska-block[hidden],.dyska-block [hidden]{display:none !important}
.dyska-block .dyska-card{border:1px solid var(--dyska-border);border-radius:var(--dyska-radius);padding:16px;display:grid;gap:12px}
.dyska-block .dyska-title{margin:0;font:inherit;font-size:1.15em;font-weight:700;color:inherit}
.dyska-block .dyska-hint{margin:0;opacity:.8;font-size:.95em}
.dyska-block .dyska-coins{display:grid;grid-template-columns:repeat(auto-fit,minmax(84px,1fr));gap:8px}
.dyska-block .dyska-coin,.dyska-block .dyska-step,.dyska-block .dyska-link{appearance:none;font:inherit;color:inherit;text-transform:none;letter-spacing:normal;box-shadow:none;margin:0;cursor:pointer;background:transparent}
.dyska-block .dyska-coin{min-height:48px;padding:8px 12px;border:2px solid var(--dyska-border);border-radius:var(--dyska-radius);font-weight:600;transition:background-color .15s,border-color .15s}
.dyska-block .dyska-coin:hover{background:var(--dyska-surface)}
.dyska-block .dyska-coin[aria-pressed="true"]{border-color:var(--dyska-accent);background:var(--dyska-surface);box-shadow:inset 0 0 0 1px var(--dyska-accent)}
.dyska-block .dyska-coin[aria-pressed="true"]::before{content:"\\2713\\00a0"}
.dyska-block .dyska-thanks{margin:0;min-height:1.2em;font-weight:600}
.dyska-block .dyska-service{display:grid;grid-template-columns:auto 1fr auto;gap:4px 12px;align-items:center;min-height:44px;padding:8px 0;cursor:pointer}
.dyska-block .dyska-service input{position:static;appearance:auto;-webkit-appearance:checkbox;opacity:1;clip:auto;transform:none;width:20px;height:20px;margin:0;accent-color:var(--dyska-accent)}
.dyska-block .dyska-service-name{font-weight:600}
.dyska-block .dyska-service-hint{grid-column:2;opacity:.8;font-size:.9em}
.dyska-block .dyska-price{white-space:nowrap;font-weight:600}
.dyska-block .dyska-stepper{display:flex;align-items:center;gap:12px}
.dyska-block .dyska-step{width:44px;height:44px;border:2px solid var(--dyska-border);border-radius:var(--dyska-radius);font-size:1.3em;line-height:1}
.dyska-block .dyska-step:hover:not([aria-disabled="true"]){background:var(--dyska-surface)}
.dyska-block .dyska-step[aria-disabled="true"],.dyska-block .dyska-coin[aria-disabled="true"],.dyska-block .dyska-service input[aria-disabled="true"]{cursor:not-allowed}
.dyska-block .dyska-step[aria-disabled="true"]{opacity:.4}
.dyska-block .dyska-count{min-width:2ch;text-align:center;font-weight:700}
.dyska-block .dyska-note{display:grid;gap:4px}
.dyska-block .dyska-note label{font-weight:600}
.dyska-block .dyska-note textarea{display:block;width:100%;min-height:84px;padding:8px 10px;font:inherit;color:inherit;background:transparent;border:1px solid var(--dyska-border);border-radius:var(--dyska-radius);resize:vertical}
.dyska-block .dyska-counter{justify-self:end;font-size:.85em;opacity:.8}
.dyska-block .dyska-error{margin:0;font-weight:600}
.dyska-block .dyska-orphans{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.dyska-block .dyska-link{padding:4px 0;border:0;text-decoration:underline}
.dyska-block[data-busy="true"] .dyska-card{opacity:.7}
.dyska-block :focus-visible{outline:2px solid var(--dyska-accent);outline-offset:2px}
@media (prefers-reduced-motion:reduce){.dyska-block .dyska-coin{transition:none}}
@media (max-width:480px){.dyska-block .dyska-card{padding:12px}.dyska-block .dyska-service{grid-template-columns:auto 1fr}.dyska-block .dyska-service .dyska-price{grid-column:2}}
`;

// Adds the stylesheet once. The style element is created with textContent only.
export function injectStyles() {
  if (document.head.querySelector(`style[${STYLE_ATTR}]`)) return;
  const style = document.createElement("style");
  style.setAttribute(STYLE_ATTR, "");
  style.textContent = CSS_TEXT;
  document.head.appendChild(style);
}
