import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src", "footer");
const files = readdirSync(SRC).filter((name) => !name.startsWith("."));

// Defence in depth next to ESLint: patterns the Addon Repository reviewer rejects.
describe("source files for the Addon Repository", () => {
  it("contains only .js files and an index.js entry", () => {
    expect(files.every((name) => name.endsWith(".js"))).toBe(true);
    expect(files).toContain("index.js");
  });

  const FORBIDDEN = [
    [/\bconsole\s*\./, "console.*"],
    [/\.(innerHTML|outerHTML)\b/, "innerHTML/outerHTML"],
    [/insertAdjacentHTML/, "insertAdjacentHTML"],
    [/createContextualFragment/, "createContextualFragment"],
    [/\bDOMParser\b/, "DOMParser"],
    [/\bsrcdoc\b/i, "srcdoc"],
    [/Object\.assign\(\s*(window|globalThis|self)\b/, "Object.assign onto the global object"],
    [/document\.write/, "document.write"],
    [/\beval\s*\(/, "eval"],
    [/new Function\s*\(/, "new Function"],
    [/[^=!]==[^=]|!=[^=]/, "loose equality"],
    [/<script/i, "inline script"],
    [/\bwindow\.[A-Za-z_$][\w$]*\s*=[^=]/, "window.* assignment"],
  ];

  for (const [pattern, label] of FORBIDDEN) {
    it(`does not use ${label}`, () => {
      for (const name of files) {
        const code = readFileSync(join(SRC, name), "utf8")
          .replace(/\/\/.*$/gm, "")
          .replace(/\/\*[\s\S]*?\*\//g, "");
        expect(code, name).not.toMatch(pattern);
      }
    });
  }

  it("has English-only comments (no Czech diacritics outside string literals)", () => {
    for (const name of files) {
      for (const line of readFileSync(join(SRC, name), "utf8").split("\n")) {
        const comment = /^\s*\/\/(.*)$/.exec(line);
        if (comment) expect(comment[1], `${name}: ${line}`).not.toMatch(/[áčďéěíňóřšťúůýž]/i);
      }
    }
  });

  it("leaves no FIXME/XXX markers", () => {
    for (const name of files) expect(readFileSync(join(SRC, name), "utf8"), name).not.toMatch(/FIXME|XXX/);
  });
});
