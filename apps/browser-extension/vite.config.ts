import { defineConfig } from "vite";
import { resolve } from "path";
import { cpSync, existsSync, mkdirSync } from "fs";

// Plugin to copy static files (manifest.json, icons) to dist
function copyStaticPlugin() {
  return {
    name: "copy-static",
    closeBundle() {
      const dist = resolve(__dirname, "dist");
      // Copy manifest.json
      cpSync(resolve(__dirname, "manifest.json"), resolve(dist, "manifest.json"));
      // Copy icons if they exist
      const iconsDir = resolve(__dirname, "public/icons");
      const distIcons = resolve(dist, "icons");
      if (existsSync(iconsDir)) {
        if (!existsSync(distIcons)) mkdirSync(distIcons, { recursive: true });
        cpSync(iconsDir, distIcons, { recursive: true });
      }
    },
  };
}

// Build popup + background (ES module format)
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        popup: resolve(__dirname, "popup.html"),
        background: resolve(__dirname, "src/background/index.ts"),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name].js",
        assetFileNames: "[name].[ext]",
      },
    },
  },
  plugins: [copyStaticPlugin()],
});
