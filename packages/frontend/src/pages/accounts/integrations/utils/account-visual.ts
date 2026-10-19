import { getServiceLogoUrl } from '@/common/utils/logo-url';
import { BANK_PROVIDER_TYPE, NO_CURRENCY_CODE } from '@bt/shared/types';

/**
 * Physical card colors of Monobank's card lineup. Monobank's account `type` is a
 * closed enum, so unknown values simply fall through to the currency chip.
 */
const MONOBANK_CARD_GRADIENTS: Record<string, string> = {
  black: 'linear-gradient(135deg, #2b2b2e, #131315)',
  white: 'linear-gradient(135deg, #f2f2f0, #d4d4d1)',
  platinum: 'linear-gradient(135deg, #b9bcc4, #7c7f88)',
  iron: 'linear-gradient(135deg, #5a5e68, #2e3138)',
  fop: 'linear-gradient(135deg, #3f3f46, #1c1c20)',
  yellow: 'linear-gradient(135deg, #ffd23f, #f0a500)',
  eAid: 'linear-gradient(135deg, #4f86c6, #2a5d9e)',
  madeInUkraine: 'linear-gradient(180deg, #2b6cb8 50%, #e8c11c 50%)',
};

type AccountVisual =
  | { kind: 'logo'; src: string }
  | { kind: 'favicon'; src: string; code: string }
  | { kind: 'card'; gradient: string }
  | { kind: 'currency'; code: string };

export function resolveAccountVisual({
  providerType,
  type,
  currency,
  metadata,
}: {
  providerType: BANK_PROVIDER_TYPE | undefined;
  type: string;
  currency: string;
  metadata?: Record<string, unknown>;
}): AccountVisual {
  const code = currency.toUpperCase() === NO_CURRENCY_CODE ? '···' : currency.toUpperCase();

  const logo = metadata?.institutionLogo;
  if (typeof logo === 'string' && logo) return { kind: 'logo', src: logo };

  if (providerType === BANK_PROVIDER_TYPE.MONOBANK) {
    const gradient = MONOBANK_CARD_GRADIENTS[type];
    if (gradient) return { kind: 'card', gradient };
  }

  // Providers without logos (SimpleFIN) still report the institution's domain —
  // its logo.dev brand image stands in; `code` is the render fallback if it errors.
  const domain = metadata?.institutionDomain;
  if (typeof domain === 'string' && domain) {
    const src = getServiceLogoUrl({ domain });
    if (src) return { kind: 'favicon', src, code };
  }

  return { kind: 'currency', code };
}

export function formatIbanCompact({ iban }: { iban: string }): string {
  const compact = iban.replace(/\s+/g, '');
  if (compact.length <= 12) return compact;
  return `${compact.slice(0, 4)} ${compact.slice(4, 8)} ··· ${compact.slice(-4)}`;
}

export function getAccountSecondaryMeta({ metadata }: { metadata?: Record<string, unknown> }): {
  iban: string | null;
  creditLimitCents: number | null;
} {
  const iban = typeof metadata?.iban === 'string' && metadata.iban ? metadata.iban : null;
  const rawLimit = metadata?.creditLimit;
  const creditLimitCents = typeof rawLimit === 'number' && rawLimit > 0 ? rawLimit : null;
  return { iban, creditLimitCents };
}
