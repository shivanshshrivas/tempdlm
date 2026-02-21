import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript rules for all TS/TSX source files
  ...tseslint.configs.recommended,

  // React Hooks rules for renderer
  {
    files: ["src/renderer/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },

  // Project-wide rule overrides
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // Allow console in main process; renderer should use IPC
      "no-console": "off",
      // TypeScript handles unused vars better than ESLint
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Allow explicit `any` with a comment — strict TS catches real issues
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },

  // Disable ESLint formatting rules that conflict with Prettier
  prettierConfig,

  // Ignore built output and test setup files from lint
  {
    ignores: ["dist/**", "dist-electron/**", "release/**", "node_modules/**"],
  },
);
