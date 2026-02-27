/**
 * Maintainability ESLint config — runs as a separate CI job via `npm run lint:maintainability`.
 *
 * Keeps stricter structural rules separate from the base lint config so that:
 *  - The main `eslint.config.mjs` stays focused on correctness and style
 *  - Maintainability violations are visible but can be tightened independently
 *
 * Rule levels:
 *  "error" — hard requirement; must pass before merging
 *  "warn"  — advisory; visible in CI output but does not fail the build on day 1
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";
import jsdoc from "eslint-plugin-jsdoc";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // ── Naming conventions ──────────────────────────────────────────────────────
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/naming-convention": [
        "error",
        // Default: camelCase for everything unless overridden below
        {
          selector: "default",
          format: ["camelCase"],
          leadingUnderscore: "allow", // _privateVar, _testOnlyExport
          trailingUnderscore: "forbid",
        },
        // Variables: camelCase, UPPER_CASE (constants), or PascalCase (class instances,
        // component imports assigned to local bindings, dynamic import destructuring)
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
          leadingUnderscore: "allow",
          trailingUnderscore: "forbid",
        },
        // Functions: camelCase or PascalCase
        // PascalCase is required for React components (e.g. QueueView, StatusBadge)
        {
          selector: "function",
          format: ["camelCase", "PascalCase"],
          leadingUnderscore: "allow",
        },
        // Import bindings: camelCase or PascalCase (React component default imports)
        {
          selector: "import",
          format: ["camelCase", "PascalCase"],
        },
        // Object literal properties: camelCase or UPPER_CASE
        // UPPER_CASE is used for IPC channel maps (IPC_EVENTS, IPC_INVOKE)
        {
          selector: "objectLiteralProperty",
          format: ["camelCase", "UPPER_CASE"],
          leadingUnderscore: "allow",
        },
        // Types, interfaces, classes, enums: PascalCase; no "I" prefix
        {
          selector: ["typeLike"],
          format: ["PascalCase"],
          custom: { regex: "^(?!I[A-Z])", match: true }, // disallow IFoo style
        },
        // Enum members: UPPER_CASE or PascalCase
        {
          selector: "enumMember",
          format: ["UPPER_CASE", "PascalCase"],
        },
        // Allow any name for object destructuring (e.g. from external APIs)
        {
          selector: "variable",
          modifiers: ["destructured"],
          format: null,
        },
        // Parameters: camelCase, allow leading _ for intentionally unused params
        {
          selector: "parameter",
          format: ["camelCase"],
          leadingUnderscore: "allow",
        },
      ],
    },
  },

  // ── Import structure ────────────────────────────────────────────────────────
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // No two import statements from the same module path
      "no-duplicate-imports": "error",
    },
  },

  // ── Complexity limits ────────────────────────────────────────────────────────
  // Thresholds calibrated against current codebase:
  //   - validateSettingsPatch() orchestrator has complexity ~17 (8 field guards + error checks)
  //   - attemptDeletion() has complexity ~15
  //   - All other functions well within limits
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      // Hard limits — enforced now
      complexity: ["error", 20],
      "max-depth": ["error", 5],
      // Soft limits — advisory until code is refactored
      "max-lines": ["warn", { max: 600, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": ["warn", { max: 100, skipBlankLines: true, skipComments: true }],
      "max-params": ["warn", 5],
    },
  },

  // ── JSDoc requirements ───────────────────────────────────────────────────────
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: { jsdoc },
    rules: {
      // Require JSDoc on exported top-level function declarations.
      // ArrowFunctionExpression is excluded — React components are defined as
      // arrow functions by convention and their props are documented by TypeScript
      // interfaces, so per-prop JSDoc would be redundant noise.
      "jsdoc/require-jsdoc": [
        "error",
        {
          publicOnly: true,
          require: {
            FunctionDeclaration: true,
            ArrowFunctionExpression: false,
            FunctionExpression: false,
            MethodDefinition: false,
            ClassDeclaration: false,
          },
        },
      ],
      // Require a description sentence in every JSDoc block
      "jsdoc/require-description": ["error", { descriptionStyle: "body" }],
      // Require @param for each parameter.
      // checkDestructured: false — React component props are documented by the
      // companion Props interface; repeating each in JSDoc adds noise without value.
      "jsdoc/require-param": ["error", { enableFixer: false, checkDestructured: false }],
      // Require @returns for non-void functions
      "jsdoc/require-returns": ["error", { enableFixer: false }],
    },
  },

  // Disable ESLint formatting rules that conflict with Prettier
  prettierConfig,

  // Exclude build artifacts and test files from maintainability checks
  {
    ignores: [
      "dist/**",
      "dist-electron/**",
      "release/**",
      "node_modules/**",
      "src/**/__tests__/**", // test files have different structural norms
    ],
  },
);
