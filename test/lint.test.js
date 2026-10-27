import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const eslint = new ESLint({ cwd: process.cwd() });

describe("ESLint rules for the Addon Repository", () => {
  it("the shipped sources have no errors or warnings", async () => {
    const results = await eslint.lintFiles(["src/**/*.js"]);
    const problems = results.flatMap((r) => r.messages.map((m) => `${r.filePath}:${m.line} ${m.ruleId}: ${m.message}`));
    expect(problems).toEqual([]);
  });

  const SAMPLES = [
    ["console", "console.log('x');", "no-console"],
    ["innerHTML assignment", "const el = document.body; el.innerHTML = '<b>' + 1 + '</b>';", "no-restricted-syntax"],
    ["insertAdjacentHTML", "document.body.insertAdjacentHTML('beforeend', 'x');", "no-restricted-syntax"],
    ["eval", "eval('1');", "no-eval"],
    ["implied eval", "setTimeout('alert(1)', 10);", "no-implied-eval"],
    ["loose equality", "export const a = (x) => x == 1;", "eqeqeq"],
    ["undefined global", "export const a = notDefinedAnywhere();", "no-undef"],
    ["window global", "window.dyska = {};", "no-restricted-syntax"],
    ["Object.assign onto window", "Object.assign(window, { dyska: 1 });", "no-restricted-syntax"],
    ["Object.assign onto globalThis", "Object.assign(globalThis, { dyska: 1 });", "no-restricted-syntax"],
    ["createContextualFragment", "export const a = document.createRange().createContextualFragment('<b></b>');", "no-restricted-syntax"],
    ["DOMParser", "export const a = new DOMParser().parseFromString('<b></b>', 'text/html');", "no-restricted-syntax"],
    ["srcdoc", "const f = document.createElement('iframe'); f.srcdoc = '<b></b>';", "no-restricted-syntax"],
    ["srcdoc through setAttribute", "const f = document.createElement('iframe'); f.setAttribute('srcdoc', 'x');", "no-restricted-syntax"],
    ["outerHTML", "document.body.outerHTML = 'x';", "no-restricted-syntax"],
    ["document.write", "document.write('x');", "no-restricted-syntax"],
    ["too deep", "export function f(a){ if(a){ if(a){ if(a){ if(a){ if(a){ return 1; } } } } } }", "max-depth"],
  ];

  for (const [label, code, rule] of SAMPLES) {
    it(`rejects ${label}`, async () => {
      const [result] = await eslint.lintText(code, { filePath: "src/footer/sample.js" });
      expect(result.messages.map((m) => m.ruleId)).toContain(rule);
    });
  }

  it("still allows Object.assign onto ordinary objects", async () => {
    const [result] = await eslint.lintText("export const a = (o) => Object.assign({}, o);", { filePath: "src/footer/sample.js" });
    expect(result.messages).toEqual([]);
  });

  it("allows what Shoptet provides", async () => {
    const code = "export const a = () => [shoptet, dataLayer, getShoptetDataLayer('cart'), document, window];";
    const [result] = await eslint.lintText(code, { filePath: "src/footer/sample.js" });
    expect(result.messages).toEqual([]);
  });
});
