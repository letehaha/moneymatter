import { SUPPORTED_LOCALES as LOCALES } from '@bt/shared/i18n/locales';
import { requestContext } from '@common/request-context';
import i18next from 'i18next';
import Backend from 'i18next-fs-backend';
import path from 'path';

export const SUPPORTED_LOCALES: string[] = Object.values(LOCALES);
const DEFAULT_LOCALE = 'en';

// Initialize i18next - store the promise to allow awaiting initialization
export const i18nextReady = i18next.use(Backend).init({
  // Language settings
  lng: DEFAULT_LOCALE,
  fallbackLng: DEFAULT_LOCALE,
  supportedLngs: SUPPORTED_LOCALES,
  preload: SUPPORTED_LOCALES, // Preload all languages at startup

  // Backend configuration - single file per language
  backend: {
    loadPath: path.join(__dirname, 'locales', '{{lng}}.json'),
    addPath: path.join(__dirname, 'locales', '{{lng}}.missing.json'),
  },

  // Performance & behavior
  cache: {
    enabled: true,
  },
  returnNull: false,
  returnEmptyString: false,
  returnObjects: false,

  // Interpolation
  interpolation: {
    escapeValue: false, // Not needed for server-side
  },

  // Development settings
  saveMissing: process.env.NODE_ENV === 'development',
  saveMissingTo: 'current',

  // Debugging
  debug: process.env.I18N_LOGGING === 'true',
});

export default i18next;

/**
 * Helper function to translate a key with optional variables
 * @param key - Translation key (e.g., 'auth.login.title')
 * @param variables - Optional variables for interpolation
 * @param locale - Optional locale override
 */
export function t({
  key,
  variables,
  locale,
}: {
  key: string;
  variables?: Record<string, unknown>;
  locale?: string;
}): string {
  // i18next's own language is process-wide, so a concurrent request would overwrite it mid-flight.
  return i18next.t(key, { ...variables, lng: locale ?? requestContext.getContext()?.locale });
}
