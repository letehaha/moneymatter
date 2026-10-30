/**
 * Shared i18n constants between frontend and backend
 */

export const SUPPORTED_LOCALES = {
  ENGLISH: 'en',
  UKRAINIAN: 'uk',
  SPANISH: 'es',
  GERMAN: 'de',
  FRENCH: 'fr',
  SLOVAK: 'sk',
  INDONESIAN: 'id',
  RUSSIAN: 'ru',
  BRAZILIAN_PORTUGUESE: 'pt-BR',
} as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[keyof typeof SUPPORTED_LOCALES];

export const DEFAULT_LOCALE: SupportedLocale = SUPPORTED_LOCALES.ENGLISH;

// Translated by volunteers on Crowdin rather than maintained in-house.
export const COMMUNITY_LOCALES: ReadonlySet<SupportedLocale> = new Set([
  SUPPORTED_LOCALES.SPANISH,
  SUPPORTED_LOCALES.INDONESIAN,
  SUPPORTED_LOCALES.RUSSIAN,
  SUPPORTED_LOCALES.SLOVAK,
  SUPPORTED_LOCALES.GERMAN,
  SUPPORTED_LOCALES.FRENCH,
  SUPPORTED_LOCALES.BRAZILIAN_PORTUGUESE,
]);

export const LOCALE_NAMES: Record<SupportedLocale, { native: string; english: string }> = {
  [SUPPORTED_LOCALES.ENGLISH]: {
    native: 'English',
    english: 'English',
  },
  [SUPPORTED_LOCALES.UKRAINIAN]: {
    native: 'Українська',
    english: 'Ukrainian',
  },
  [SUPPORTED_LOCALES.SPANISH]: {
    native: 'Español',
    english: 'Spanish',
  },
  [SUPPORTED_LOCALES.INDONESIAN]: {
    native: 'Bahasa',
    english: 'Indonesian',
  },
  [SUPPORTED_LOCALES.RUSSIAN]: {
    native: 'Русский',
    english: 'Russian',
  },
  [SUPPORTED_LOCALES.SLOVAK]: {
    native: 'Slovenčina',
    english: 'Slovak',
  },
  [SUPPORTED_LOCALES.GERMAN]: {
    native: 'Deutsch',
    english: 'German',
  },
  [SUPPORTED_LOCALES.FRENCH]: {
    native: 'Français',
    english: 'French',
  },
  [SUPPORTED_LOCALES.BRAZILIAN_PORTUGUESE]: {
    native: 'Português (Brasil)',
    english: 'Portuguese (Brazil)',
  },
};

/**
 * Check if a locale is supported
 */
export function isSupportedLocale(locale: string): locale is SupportedLocale {
  return Object.values(SUPPORTED_LOCALES).includes(locale as SupportedLocale);
}

/**
 * Get a valid locale, falling back to default if invalid
 */
export function getValidLocale(locale: string | undefined | null): SupportedLocale {
  if (locale && isSupportedLocale(locale)) {
    return locale;
  }
  return DEFAULT_LOCALE;
}

/**
 * Resolve a BCP 47 tag or Accept-Language header to a supported locale.
 * Each entry tries the full tag (`pt-BR`) before its base language (`en-US` → `en`).
 * Entries are tried in list order; `q=` weights are ignored.
 */
export function resolveLocale({ tag }: { tag: string | undefined | null }): SupportedLocale {
  const locales = Object.values(SUPPORTED_LOCALES);
  const findLocale = (code: string) => locales.find((locale) => locale.toLowerCase() === code);

  for (const entry of (tag ?? '').split(',')) {
    const code = entry.split(';')[0]!.trim().toLowerCase();
    const match = code && (findLocale(code) ?? findLocale(code.split('-')[0]!));
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}
