import { defineConfig } from "astro/config";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://news.edu-evidence.org",
  integrations: [react(), sitemap()],
  vite: {
    plugins: [tailwindcss()],
  },
});
