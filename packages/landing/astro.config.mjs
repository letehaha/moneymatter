import sitemap from '@astrojs/sitemap';
import vue from '@astrojs/vue';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import { readdirSync } from 'node:fs';

// URL segment -> BCP 47 code. Mirror changes in the locale regexes of packages/frontend/nginx.conf.
export const LANDING_LOCALES = { en: 'en', uk: 'uk', es: 'es', it: 'it', de: 'de', fr: 'fr', 'pt-br': 'pt-BR' };
export const TRANSLATED_LOCALES = Object.keys(LANDING_LOCALES).filter((path) => path !== 'en');

export default defineConfig({
  output: 'static',
  site: 'https://moneymatter.app',
  trailingSlash: 'never',
  i18n: {
    defaultLocale: 'en',
    locales: Object.entries(LANDING_LOCALES).map(([path, code]) => (path === code ? code : { path, codes: [code] })),
    fallback: Object.fromEntries(TRANSLATED_LOCALES.map((path) => [path, 'en'])),
    routing: { prefixDefaultLocale: false, fallbackType: 'rewrite' },
  },
  integrations: [
    vue(),
    sitemap({
      i18n: { defaultLocale: 'en', locales: LANDING_LOCALES },
      // Locale copies of dynamic routes are missing from the build's page list.
      customPages: readdirSync(new URL('./src/content/guides', import.meta.url))
        .filter((file) => file.endsWith('.md'))
        .flatMap((file) =>
          TRANSLATED_LOCALES.map((path) => `https://moneymatter.app/${path}/guides/${file.slice(0, -3)}`),
        ),
      // Pages on the legal layout and /demo render <meta name="robots" content="noindex">.
      // Sitemaps must only contain canonical, indexable URLs (Google docs).
      filter: (page) => !['/privacy-policy', '/terms-of-use', '/support', '/demo'].some((path) => page.endsWith(path)),
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
    envDir: '../../',
    envPrefix: 'VITE_',
  },
});
