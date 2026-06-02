import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  css: {
    // Keep PostCSS inline so Vite does not search for external .postcssrc / package.json config.
    // This avoids Windows BOM/encoding issues from unrelated config files above the renderer root.
    postcss: {
      plugins: [],
    },
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
  build: {
    outDir: "../../dist/renderer",
    emptyOutDir: true,
  },
});
