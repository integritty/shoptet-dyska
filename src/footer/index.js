import { start } from "./init.js";

function boot() {
  try {
    start();
  } catch {
    // a failure here must never affect the shop page
  }
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
