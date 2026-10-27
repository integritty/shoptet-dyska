// Build for Shoptet Addon Repository: `npm ci && npm run build -- --env production`.
// `--env production` selects the production backend origin, `--env development` (or no --env) the development one;
// any other value is an error.
// DYSKA_API_BASE overrides the origin in both cases. DYSKA_OUT_FILE overrides the output file (used by tests).
import { build } from "esbuild";

const DEV_API_BASE = "https://dev-shoptet-dyska.integritty.dev";
// TEMPORARY: while the production backend (https://shoptet-dyska.integritty.dev) is not deployed, the production build
// (the one the Addon Repository runs) targets the development backend, so the add-on can be tested on a test shop.
// Switch this to "https://shoptet-dyska.integritty.dev" before the production release (and update test/build.test.js).
const PRODUCTION_API_BASE = DEV_API_BASE;

// Reads `--env production` / `--env=production` from the argument list; unknown arguments are ignored.
// No --env means development; a missing or unknown value is an error.
function readEnv(args) {
  let value = "development";
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--env") value = args[i + 1] ?? "";
    else if (args[i].startsWith("--env=")) value = args[i].slice("--env=".length);
  }
  if (value !== "production" && value !== "development") {
    throw new Error(`--env must be "production" or "development", got: ${JSON.stringify(value)}`);
  }
  return value;
}

function resolveApiBase(override, env) {
  const raw = (override || (env === "production" ? PRODUCTION_API_BASE : DEV_API_BASE)).trim().replace(/\/+$/, "");
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.search || url.hash) {
    throw new Error(`DYSKA_API_BASE must be an https URL without query or hash, got: ${raw}`);
  }
  return raw;
}

const apiBase = resolveApiBase(process.env.DYSKA_API_BASE, readEnv(process.argv.slice(2)));

// Replaces the content of src/footer/api-base.js, so the committed source stays free of build-time magic.
const apiBasePlugin = {
  name: "dyska-api-base",
  setup(b) {
    b.onLoad({ filter: /[\\/]src[\\/]footer[\\/]api-base\.js$/ }, () => ({
      contents: `export const API_BASE = ${JSON.stringify(apiBase)};\n`,
      loader: "js",
    }));
  },
};

await build({
  entryPoints: ["src/footer/index.js"],
  bundle: true,
  format: "iife",
  target: "es2020",
  minify: true,
  legalComments: "none",
  charset: "utf8",
  outfile: process.env.DYSKA_OUT_FILE || "dist/scripts.footer.min.js",
  plugins: [apiBasePlugin],
});
