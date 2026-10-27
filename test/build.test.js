import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const DEV = "https://dev-shoptet-dyska.integritty.dev";
// TEMPORARY: equals DEV until the production backend is deployed (see build.mjs); then "https://shoptet-dyska.integritty.dev".
const PRODUCTION = DEV;
const DIST = join(process.cwd(), "dist", "scripts.footer.min.js");
const TMP = mkdtempSync(join(tmpdir(), "dyska-build-"));
let counter = 0;

// Builds into a temporary file, never into dist/ (a production dist is what gets published).
function build(args, env) {
  counter += 1;
  const out = join(TMP, `bundle-${counter}.js`);
  execFileSync(process.execPath, ["build.mjs", ...args], {
    cwd: process.cwd(),
    env: { ...process.env, DYSKA_API_BASE: "", ...env, DYSKA_OUT_FILE: out },
    stdio: "pipe",
  });
  return readFileSync(out, "utf8");
}

afterAll(() => {
  rmSync(TMP, { recursive: true, force: true });
});

describe("build", () => {
  it("does not touch dist/ (it writes to the requested output file)", () => {
    const before = existsSync(DIST) ? statSync(DIST).mtimeMs : null;
    build(["--env", "production"]);
    expect(existsSync(DIST) ? statSync(DIST).mtimeMs : null).toBe(before);
  });

  it("--env production points the bundle at the production origin only", () => {
    const code = build(["--env", "production"]);
    expect(code).toContain(`"${PRODUCTION}"`);
    // Once the production origin differs from DEV, the production bundle must not contain the dev origin.
    if (PRODUCTION !== DEV) expect(code).not.toContain("dev-shoptet-dyska");
    expect(build(["--env=production"])).toContain(`"${PRODUCTION}"`);
  });

  it("without --env (or with --env development) it uses the development origin", () => {
    for (const args of [[], ["--env", "development"], ["--env=development"], ["--unknown", "x"]]) {
      const code = build(args);
      expect(code).toContain(`"${DEV}"`);
      if (PRODUCTION !== DEV) expect(code).not.toContain(`"${PRODUCTION}"`);
    }
  });

  it("refuses any other --env value, also a missing one", () => {
    for (const args of [["--env"], ["--env", ""], ["--env", "prod"], ["--env", "staging"], ["--env=Production"]]) {
      expect(() => build(args), args.join(" ")).toThrow();
    }
  });

  it("produces one IIFE bundle without the forbidden patterns", () => {
    const code = build(["--env", "production"]);
    expect(code).not.toMatch(/console\.|innerHTML|outerHTML|insertAdjacentHTML|document\.write|eval\(|<script/);
    expect(code.startsWith("(()=>{")).toBe(true);
  });

  it("DYSKA_API_BASE overrides the origin for production and development builds", () => {
    for (const args of [["--env", "production"], []]) {
      const code = build(args, { DYSKA_API_BASE: "https://custom.example/" });
      expect(code).toContain('"https://custom.example"');
      expect(code).not.toContain("shoptet-dyska.integritty.dev");
    }
  });

  it("refuses a non-https base URL", () => {
    expect(() => build(["--env", "production"], { DYSKA_API_BASE: "http://insecure.example" })).toThrow();
  });
});
