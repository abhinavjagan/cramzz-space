import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://cramzz.space",
  output: "static",
  build: {
    format: "directory",
  },
  vite: {
    build: {
      // Render's CSP permits only same-origin scripts. Keep Astro/Vite from
      // inlining small entry chunks that the browser would correctly block.
      assetsInlineLimit: 0,
      sourcemap: false,
    },
  },
});
