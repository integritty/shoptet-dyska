// Default backend origin (development). build.mjs replaces this module with the origin chosen at build time:
// the production origin for `--env production`, or the DYSKA_API_BASE value when it is set.
export const API_BASE = "https://dev-shoptet-dyska.integritty.dev";
