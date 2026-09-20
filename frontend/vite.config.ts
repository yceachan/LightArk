import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "prompt",
      injectRegister: false,
      manifest: {
        name: "Folio · 个人知识库",
        short_name: "Folio",
        description: "属于你的文档，随处可读。",
        lang: "zh-CN",
        theme_color: "#fdfdf7",
        background_color: "#fdfdf7",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          {
            src: "/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any maskable",
          },
        ],
      },
      injectManifest: {
        globPatterns: [
          "index.html",
          "assets/index-*.js",
          "assets/index-*.css",
          "assets/newsreader-latin-wght*.woff2",
          "icon*.{svg,png}",
        ],
        maximumFileSizeToCacheInBytes: 6000000,
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
      "/healthz": "http://127.0.0.1:8787",
    },
  },
  build: { chunkSizeWarningLimit: 1600 },
});
