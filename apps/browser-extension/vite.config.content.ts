import { defineConfig } from "vite";
import { resolve } from "path";

// Separate build for content script — must be IIFE (not ES module)
// because Chrome content scripts don't support ES modules.
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false, // Don't wipe the first build output
    rollupOptions: {
      input: resolve(__dirname, "src/content/index.ts"),
      output: {
        format: "iife",
        entryFileNames: "content.js",
        inlineDynamicImports: true,
      },
    },
  },
});
