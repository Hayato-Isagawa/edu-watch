import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://news.edu-evidence.org",
  // Astro 7 は既定の HTML 空白圧縮を 'jsx' ルールに変更した。v6 の挙動を維持し、
  // 日本語テキストの字間差や VRT の差分を防ぐため true に固定する。
  compressHTML: true,
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
