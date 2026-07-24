import type { PluginOption } from "vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist-web",
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
  preview: {
    port: 4173,
  },
  plugins: [] as PluginOption[],
});
