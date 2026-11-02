import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { createThemeBootScript } from "./src/web/theme.ts";

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "inject-theme-boot",
      transformIndexHtml(html) {
        return html.replace(
          "<!-- inject-theme-boot -->",
          `<script>${createThemeBootScript()}</script>`,
        );
      },
    },
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src/web"),
    },
  },
  build: {
    outDir: "src/web/dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:3000",
    },
    watch: {
      ignored: ["**/workspaces/**"],
    },
  },
});
