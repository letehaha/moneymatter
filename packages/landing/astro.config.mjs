import sitemap from '@astrojs/sitemap';
import vue from '@astrojs/vue';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  output: 'static',
  site: 'https://moneymatter.app',
  trailingSlash: 'never',
  integrations: [
    vue(),
    sitemap({
      // Legal pages and /demo render <meta name="robots" content="noindex">.
      // Sitemaps must only contain canonical, indexable URLs (Google docs).
      filter: (page) => !['/privacy-policy', '/terms-of-use', '/demo'].some((path) => page.endsWith(path)),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    envDir: '../../',
    envPrefix: 'VITE_',
  },
});
