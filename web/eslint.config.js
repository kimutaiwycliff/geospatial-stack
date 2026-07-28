// Flat config (ESLint 9) -- standard Vite+React+TS setup, kept close to the
// defaults each plugin recommends rather than a heavily customized ruleset.
// This is CI's second lint gate (alongside ruff for Python); its job is to
// catch real mistakes (hook-rule violations, unused vars) before they ship,
// not to enforce a house style tsc/Prettier would already cover.
import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      // Prefixed `_` is the standard escape hatch for "intentionally unused"
      // (destructured tuple slots, catch params) -- matches tsconfig's own
      // noUnusedParameters convention rather than fighting it.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
);
