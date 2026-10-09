import '@/styles/global.css';
import './registerServiceWorker';

import { installChunkReloadHandler } from '@/common/utils/chunk-reload-handler';
import { identifyCurrentTheme } from '@/common/utils/color-theme';
import { patchMetaViewportMaxScaleForiOS } from '@/common/utils/meta-viewport-max-scale';
import { getDateFnsLocale } from '@/composable/use-date-locale';
import { i18n, initializeLocale, loadChunks } from '@/i18n';
import { initPostHog, trackPageviews } from '@/lib/posthog';
import { queryClient } from '@/lib/query-client';
import { initSentry } from '@/lib/sentry';
import { router } from '@/routes';
import { store } from '@/stores/setup';
import type { SupportedLocale } from '@bt/shared/i18n/locales';
import { VueQueryPlugin } from '@tanstack/vue-query';
import { createHead } from '@unhead/vue/client';
import { setDefaultOptions } from 'date-fns';
import { createApp, watchEffect } from 'vue';

import App from './app.vue';

identifyCurrentTheme();
patchMetaViewportMaxScaleForiOS();
if (!import.meta.env.DEV) {
  installChunkReloadHandler({ router });
}

// Localizes every date-fns call that passes no explicit locale. The default is read at call
// time, so a value cached in a computed keeps the previous language until it recomputes.
watchEffect(() => setDefaultOptions({ locale: getDateFnsLocale() }), { flush: 'sync' });

// Initialize locale from localStorage/browser
const initialLocale = initializeLocale();

// Load common chunk for the initial locale (if not English, English is preloaded)
// The route guard will load page-specific chunks on navigation
const initI18n = async () => {
  if (initialLocale !== 'en') {
    // For non-English locales, load the common chunk
    await loadChunks({ locale: initialLocale, chunks: ['common'] });
    i18n.global.locale.value = initialLocale as SupportedLocale;
  }
};

// Initialize i18n before mounting
initI18n()
  .catch((err) => {
    console.warn('i18n initialization failed, using defaults:', err);
  })
  .finally(() => {
    const app = createApp(App);
    const head = createHead();

    // Initialize Sentry before mounting (must be early to catch errors)
    initSentry({ app, router });

    initPostHog();
    trackPageviews({ router });

    app.use(router);
    app.use(store);
    app.use(head);
    app.use(i18n); // Register vue-i18n plugin

    app.use(VueQueryPlugin, { queryClient });

    app.mount('#app');
  });
