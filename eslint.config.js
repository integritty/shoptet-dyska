import js from "@eslint/js";
import globals from "globals";

// Rules mirror what the Shoptet Addon Repository reviewer rejects (see README, "Linter rules").
const forbiddenSyntax = [
  {
    selector: "MemberExpression[property.name=/^(innerHTML|outerHTML|insertAdjacentHTML)$/]",
    message: "Build DOM with createElement/textContent; innerHTML-like APIs are rejected by the Addon Repository linter.",
  },
  {
    selector: "MemberExpression[object.name='document'][property.name=/^(write|writeln)$/]",
    message: "document.write is forbidden.",
  },
  {
    selector: "AssignmentExpression[left.object.name=/^(window|globalThis|self)$/]",
    message: "Do not create globals.",
  },
  {
    selector: "CallExpression[callee.object.name='Object'][callee.property.name='assign'][arguments.0.name=/^(window|globalThis|self)$/]",
    message: "Do not create globals (Object.assign onto the global object).",
  },
  {
    selector: "MemberExpression[property.name='createContextualFragment']",
    message: "createContextualFragment parses HTML and is rejected like innerHTML.",
  },
  {
    selector: "Identifier[name='DOMParser']",
    message: "DOMParser parses HTML and is rejected like innerHTML.",
  },
  {
    selector: "MemberExpression[property.name='srcdoc']",
    message: "srcdoc injects HTML and is rejected like innerHTML.",
  },
  {
    selector: "CallExpression[callee.property.name='setAttribute'][arguments.0.value=/^(srcdoc|innerHTML|outerHTML)$/i]",
    message: "Setting an HTML-injecting attribute is rejected like innerHTML.",
  },
];

export default [
  { ignores: ["dist/**", "node_modules/**", "coverage/**"] },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: "module",
      // Only browser globals plus the objects Shoptet itself provides.
      globals: {
        ...globals.browser,
        shoptet: "readonly",
        dataLayer: "readonly",
        getShoptetDataLayer: "readonly",
      },
    },
    rules: {
      "no-console": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      "no-var": "error",
      "no-undef": "error",
      "no-implicit-globals": "error",
      eqeqeq: ["error", "always"],
      "max-depth": ["error", 4],
      "max-lines-per-function": ["warn", { max: 80, skipBlankLines: true, skipComments: true }],
      complexity: ["warn", 15],
      "no-restricted-syntax": ["error", ...forbiddenSyntax],
    },
  },
  {
    files: ["test/**/*.js", "build.mjs", "eslint.config.js", "vitest.config.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
        shoptet: "writable",
        dataLayer: "writable",
        getShoptetDataLayer: "writable",
      },
    },
    rules: { eqeqeq: ["error", "always"] },
  },
];
