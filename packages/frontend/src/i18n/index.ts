import { captureException } from '@/lib/sentry';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES as LOCALES,
  type SupportedLocale,
  isSupportedLocale,
  resolveLocale,
} from '@bt/shared/i18n/locales';
import { compile } from '@intlify/core-base';
import { type I18n, type MessageCompiler, type MessageFunction, createI18n } from 'vue-i18n';
import type { RouteLocationNormalized } from 'vue-router';

// Import common chunk synchronously for initial load (en only)
import enCommon from './locales/chunks/en/common.json';
import type { ChunkRegistry, I18nChunkName, LoadedChunksMap } from './types';

const SUPPORTED_LOCALES = Object.values(LOCALES);

// Track which chunks have been loaded per locale
const loadedChunks: LoadedChunksMap = new Map([['en', new Set<I18nChunkName>(['common'])]]);

// Built from the filesystem so new chunks are handled automatically
const chunkModules = import.meta.glob<{ default: Record<string, unknown> }>('./locales/chunks/*/**/*.json');

const chunkRegistry: ChunkRegistry = {};
for (const [path, loader] of Object.entries(chunkModules)) {
  const match = path.match(/^\.\/locales\/chunks\/([^/]+)\/(.+)\.json$/);
  if (!match) continue;
  const [, locale = '', chunk = ''] = match;
  (chunkRegistry[locale] ??= {})[chunk as I18nChunkName] = loader;
}

// A broken translation string (e.g. an unescaped "@", which vue-i18n reads as
// special syntax) throws while rendering and takes the whole page down. Catch
// that and show the raw text instead, so one bad string can't crash the app.
export const resilientMessageCompiler: MessageCompiler = (message, context) => {
  try {
    return compile(message, context);
  } catch (error) {
    const fallbackText = typeof message === 'string' ? message : context.key;

    console.warn(
      `[i18n] Failed to compile translation for key "${context.key}" (locale "${context.locale}"). ` +
        `Rendering its raw text as a fallback.`,
      error,
    );

    const renderRawText: MessageFunction = () => fallbackText;
    return renderRawText;
  }
};

const SLAVIC_PLURAL_INDEX: Record<string, number> = { one: 0, few: 1 };

// vue-i18n's default three-branch rule is [zero, one, many]; these locales are
// written [one, few, many]. Clamping covers keys with fewer branches than that,
// which would otherwise resolve to a branch vue-i18n throws on.
export const createSlavicPluralRule = ({ locale }: { locale: string }) => {
  const rules = new Intl.PluralRules(locale);
  return (choice: number, choicesLength: number) =>
    Math.min(SLAVIC_PLURAL_INDEX[rules.select(Math.abs(choice))] ?? 2, choicesLength - 1);
};

const SLAVIC_LOCALES = [LOCALES.UKRAINIAN, LOCALES.RUSSIAN, LOCALES.SLOVAK];

// Create i18n instance with common chunk pre-loaded
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const i18n: I18n<any, {}, {}, string, false> = createI18n<{}, string, false>({
  legacy: false,
  locale: DEFAULT_LOCALE,
  fallbackLocale: DEFAULT_LOCALE,
  messages: {
    en: enCommon,
  },
  messageCompiler: resilientMessageCompiler,
  pluralRules: Object.fromEntries(SLAVIC_LOCALES.map((locale) => [locale, createSlavicPluralRule({ locale })])),
  globalInjection: true,
  missingWarn: process.env.NODE_ENV === 'development',
  fallbackWarn: process.env.NODE_ENV === 'development',
});

/**
 * Load a specific chunk for a locale
 */
async function loadChunk({ locale, chunk }: { locale: string; chunk: I18nChunkName }): Promise<void> {
  // Create + store the per-locale Set synchronously (pre-await) so parallel
  // loadChunk calls share one reference; otherwise the last resolver overwrites
  // the others and the tracked Set loses chunks setLocale() then re-fetches.
  let localeChunks = loadedChunks.get(locale);
  if (!localeChunks) {
    localeChunks = new Set<I18nChunkName>();
    loadedChunks.set(locale, localeChunks);
  }

  // Skip if already loaded
  if (localeChunks.has(chunk)) {
    return;
  }

  // Validate locale
  if (!SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
    console.warn(`Locale "${locale}" is not supported.`);
    return;
  }

  const loader = chunkRegistry[locale]?.[chunk];
  if (!loader) {
    console.warn(`Chunk "${chunk}" not found for locale "${locale}".`);

    // A translated locale has no file for a chunk until Crowdin exports one, and the
    // paired English copy covers that on screen. Only a missing English source file
    // is an actual defect.
    if (locale === DEFAULT_LOCALE) {
      captureException({
        error: new Error(`i18n chunk "${chunk}" missing for locale "${locale}"`),
        context: { chunk, locale },
      });
    }
    return;
  }

  try {
    const messages = await loader();
    const payload = messages?.default;

    // A module that resolves without message content means the asset came back as
    // something other than the JSON chunk. Raised as an error so it takes the same
    // path as a failed fetch and the chunk stays retryable.
    if (!payload || typeof payload !== 'object') {
      throw new Error(`Chunk "${chunk}" for locale "${locale}" resolved without message content`);
    }

    // Merge into existing messages
    i18n.global.mergeLocaleMessage(locale as SupportedLocale, payload as Record<string, unknown>);

    // Track as loaded
    localeChunks.add(chunk);

    if (process.env.NODE_ENV === 'development') {
      console.log(`[i18n] Loaded chunk "${chunk}" for locale "${locale}"`);
    }
  } catch (error) {
    // Swallowed so one unreachable chunk can't break a route transition — the chunk stays
    // out of `localeChunks`, which is how callers (and `ensureChunkLoaded`) tell it failed.
    // Reported because the visible symptom is missing text on screen — raw dotted key
    // paths when it is the English copy that failed — which otherwise only ever shows
    // up in a console nobody is watching.
    console.error(`Failed to load chunk "${chunk}" for locale "${locale}":`, error);
    captureException({ error, context: { chunk, locale } });
  }
}

/**
 * Load multiple chunks for a locale in parallel
 */
export async function loadChunks({ locale, chunks }: { locale: string; chunks: I18nChunkName[] }): Promise<void> {
  // Every non-en chunk is paired with its English copy. Crowdin exports lag new
  // source keys, so a translated chunk is routinely missing some (and a brand-new
  // chunk file may not exist for the locale at all). `fallbackLocale` can only
  // resolve those keys if the English messages for that same chunk are in the
  // store, and nothing else ever loads them — only `en/common` is preloaded.
  const locales = locale === DEFAULT_LOCALE ? [locale] : [locale, DEFAULT_LOCALE];

  await Promise.all(locales.flatMap((each) => chunks.map((chunk) => loadChunk({ locale: each, chunk }))));
}

// Per-chunk load promises keyed by chunk name. Used by components that can
// appear outside their owning route (e.g. dialogs opened from a global field)
// to dedupe concurrent ensure-calls across component instances. The locale
// dimension is intentionally omitted: setLocale() reloads every chunk already
// tracked in loadedChunks, so a resolved promise from a prior locale still
// reflects messages-present in the new locale.
const ensureChunkPromises = new Map<I18nChunkName, Promise<void>>();

/**
 * Ensure a chunk is loaded for the current locale. Subsequent calls reuse the
 * in-flight or resolved promise, so callers can invoke this on every mount
 * without worrying about duplicate network requests.
 */
export function ensureChunkLoaded(chunk: I18nChunkName): Promise<void> {
  let promise = ensureChunkPromises.get(chunk);
  if (!promise) {
    const locale = getCurrentLocale();
    // `loadChunk` reports failure by leaving the chunk out of `loadedChunks` rather than
    // rejecting. Dropping the cached promise in that case lets the next caller retry —
    // otherwise one flaky fetch leaves the tab rendering raw key paths for that chunk
    // until a full reload.
    promise = loadChunks({ locale, chunks: [chunk] }).then(() => {
      if (!loadedChunks.get(locale)?.has(chunk)) ensureChunkPromises.delete(chunk);
    });
    ensureChunkPromises.set(chunk, promise);
  }
  return promise;
}

/**
 * Load chunks required for a route (collects from route and all parent routes)
 */
export async function loadChunksForRoute({ route }: { route: RouteLocationNormalized }): Promise<void> {
  const locale = i18n.global.locale.value;
  const requiredChunks = new Set<I18nChunkName>();

  // Collect chunks from route and all matched (parent) routes
  for (const matched of route.matched) {
    const chunks = matched.meta?.i18nChunks;
    if (chunks) {
      chunks.forEach((chunk) => requiredChunks.add(chunk));
    }
  }

  if (requiredChunks.size > 0) {
    await loadChunks({ locale, chunks: Array.from(requiredChunks) });
  }
}

/**
 * Reload all loaded chunks when locale changes
 */
async function reloadChunksForLocale({ locale }: { locale: string }): Promise<void> {
  const currentLocale = i18n.global.locale.value;
  const currentChunks = loadedChunks.get(currentLocale);

  if (!currentChunks || currentChunks.size === 0) {
    // At minimum, load the common chunk
    await loadChunks({ locale, chunks: ['common'] });
    return;
  }

  // Load all previously loaded chunks for the new locale
  await loadChunks({ locale, chunks: Array.from(currentChunks) });
}

/**
 * Get current locale
 */
export function getCurrentLocale(): string {
  return i18n.global.locale.value;
}

/**
 * Set locale (will reload chunks if needed)
 */
export async function setLocale(locale: string): Promise<void> {
  if (!SUPPORTED_LOCALES.includes(locale as SupportedLocale)) {
    console.warn(`Locale "${locale}" is not supported.`);
    return;
  }

  // Reload all chunks for the new locale
  await reloadChunksForLocale({ locale });

  // Switch to the new locale
  i18n.global.locale.value = locale as SupportedLocale;

  // Persist to localStorage
  localStorage.setItem('preferred-locale', locale);
}

/**
 * Initialize locale from various sources
 * Priority: localStorage → browser → default
 */
export function initializeLocale(): string {
  const storedLocale = localStorage.getItem('preferred-locale');
  if (storedLocale && isSupportedLocale(storedLocale)) return storedLocale;

  return resolveLocale({ tag: navigator.languages.join(',') || navigator.language });
}
