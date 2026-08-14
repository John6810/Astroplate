import mdx from "@astrojs/mdx";
import react from "@astrojs/react";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import AutoImport from "astro-auto-import";
import { defineConfig, fontProviders } from "astro/config";
import remarkCollapse from "remark-collapse";
import remarkToc from "remark-toc";
import sharp from "sharp";
import config from "./src/config/config.json";
import theme from "./src/config/theme.json";
import { unified } from "@astrojs/markdown-remark";

// Helper to parse font string format: "FontName:wght@400;500;600;700"
function parseFontString(fontStr) {
  const [name, weightPart] = fontStr.split(":");
  let weights = [400]; // default weight

  if (weightPart) {
    // Extract weights from wght@400;500;600 format
    const weightMatch = weightPart.match(/wght@?([\d;]+)/);
    if (weightMatch) {
      weights = weightMatch[1].split(";").map((w) => parseInt(w, 10));
    }
  }

  // remove + from font name and add space
  const cleanName = name.replace(/\+/g, " ");
  return { name: cleanName, weights };
}

// Build fonts configuration from theme.json.
// Fonts are SELF-HOSTED (woff2 in src/assets/fonts/) via the local provider,
// so the build never fetches from fonts.gstatic.com — CI stays deterministic
// and offline-safe. Each weight maps to a "<slug>-<weight>.woff2" file, e.g.
// "Heebo:wght@400;600" → heebo-400.woff2 / heebo-600.woff2.
const fontsConfig = Object.entries(theme.fonts.font_family)
  .filter(([key]) => !key.includes("_type")) // Filter out type entries
  .map(([key, fontStr]) => {
    const { name, weights } = parseFontString(fontStr);
    const typeKey = `${key}_type`;
    const fallback = theme.fonts.font_family[typeKey] || "sans-serif";
    const slug = name.toLowerCase().replace(/\s+/g, "-");

    return {
      provider: fontProviders.local(),
      name,
      cssVariable: `--font-${key}`,
      fallbacks: [fallback],
      display: "swap",
      // Local provider takes its per-weight files under `options.variants`.
      options: {
        variants: weights.map((weight) => ({
          weight,
          style: "normal",
          src: [`./src/assets/fonts/${slug}-${weight}.woff2`],
        })),
      },
    };
  });

// https://astro.build/config
export default defineConfig({
  site: config.site.base_url ? config.site.base_url : "http://examplesite.com",
  base: config.site.base_path ? config.site.base_path : "/",
  trailingSlash: config.site.trailing_slash ? "always" : "never",
  image: { service: sharp() },
  // assetsInlineLimit: 0 keeps every bundled script an EXTERNAL file — the CSP
  // pins script hashes and forbids unsafe-inline, so a small script that Vite
  // decides to inline would be silently blocked in production (the check-csp
  // guard catches it in CI, this setting prevents it structurally).
  vite: { plugins: [tailwindcss()], build: { assetsInlineLimit: 0 } },
  fonts: fontsConfig,
  integrations: [
    react(),
    sitemap(),
    AutoImport({
      imports: [
        "@/shortcodes/Button",
        "@/shortcodes/Accordion",
        "@/shortcodes/Notice",
        "@/shortcodes/Video",
        "@/shortcodes/Youtube",
        "@/shortcodes/Tabs",
        "@/shortcodes/Tab",
      ],
    }),
    mdx(),
  ],
  markdown: {
    processor: unified({
      remarkPlugins: [
        remarkToc,
        [remarkCollapse, { test: "Table of contents" }],
      ],
    }),
    shikiConfig: { theme: "one-dark-pro", wrap: true },
  },
});
