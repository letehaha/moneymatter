import { logger } from '@js/utils/logger';

// Single source of truth for env vars whose configured/unset state the app
// branches on
export enum EnvVar {
  RESEND_API_KEY = 'RESEND_API_KEY',
  GOOGLE_CLIENT_ID = 'GOOGLE_CLIENT_ID',
  GOOGLE_CLIENT_SECRET = 'GOOGLE_CLIENT_SECRET',
  GITHUB_CLIENT_ID = 'GITHUB_CLIENT_ID',
  GITHUB_CLIENT_SECRET = 'GITHUB_CLIENT_SECRET',
  BETTER_AUTH_SECRET = 'BETTER_AUTH_SECRET',
  COINGECKO_API_KEY = 'COINGECKO_API_KEY',
  LOGO_DEV_SECRET_KEY = 'LOGO_DEV_SECRET_KEY',
  TYPESAFE_API_KEY = 'TYPESAFE_API_KEY',
}

// Catches values still set to the .env.template default (e.g. `your-resend-api-key`,
// `your_github_secret`). Treating those as "set" was the original self-host bug –
// email verification got enabled, OAuth providers looked configured, and the user
// only discovered it after signup silently broke.
const PLACEHOLDER_PATTERN = /^your[-_]/i;

interface EnvRule {
  // Reject values shorter than this. Currently only signing secrets care.
  minLength?: number;
}

const RULES: Partial<Record<EnvVar, EnvRule>> = {
  // better-auth requires a 32+ char secret to sign sessions/tokens. Shorter
  // values would compile but degrade signature strength.
  [EnvVar.BETTER_AUTH_SECRET]: { minLength: 32 },
};

// Warn once per (name, value) pair. A flag checked from many places (e.g. the
// Resend client constructed at module load AND a route guard) would otherwise
// log the same message repeatedly.
const warnedKeys = new Set<string>();
const warnOnce = (name: EnvVar, value: string, reason: string): void => {
  const key = `${name}:${value}`;
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  logger.warn(`[env] ${name}="${value}" – ${reason}. Treating as unset.`);
};

/**
 * True when the env var holds a real, usable value.
 *
 * False for: undefined, empty string, .env.template placeholders (`your-...`),
 * and values failing per-key rules (e.g. minimum length).
 *
 * Prefer this over `Boolean(process.env.X)` for any flag gating a feature –
 * placeholder detection only runs here.
 */
export function isEnvConfigured(name: EnvVar, value: string | undefined): boolean {
  if (value === undefined || value === '') return false;

  if (PLACEHOLDER_PATTERN.test(value)) {
    warnOnce(name, value, 'looks like a .env.template placeholder');
    return false;
  }

  const rule = RULES[name];
  if (rule?.minLength !== undefined && value.length < rule.minLength) {
    warnOnce(name, value, `must be at least ${rule.minLength} characters`);
    return false;
  }

  return true;
}

// Playwright e2e runs against dev and preview backends; preview has NODE_ENV=production, hence the flag.
export const isTestSeedingEnabled = (): boolean =>
  process.env.NODE_ENV === 'test' ||
  process.env.NODE_ENV === 'development' ||
  process.env.ENABLE_TEST_SEEDING_ENDPOINTS === 'true';
