import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    // Main process tests run in Node environment
    // Renderer tests use jsdom (set per-file via @vitest-environment jsdom)
    environment: "node",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
