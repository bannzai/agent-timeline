import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "test-results", "tmp"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["web/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["server/**/*.ts", "e2e/**/*.ts", "*.{ts,js}"],
    languageOptions: { globals: globals.node },
  },
);
