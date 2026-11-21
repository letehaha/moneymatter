import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { describe, expect, it, vi } from 'vitest';

import { formatIbanCompact, getAccountSecondaryMeta, resolveAccountVisual } from './account-visual';

vi.stubEnv('VITE_LOGO_DEV_TOKEN', 'test-token');

describe('resolveAccountVisual', () => {
  it('prefers institution logo when present', () => {
    expect(
      resolveAccountVisual({
        providerType: BANK_PROVIDER_TYPE.LUNCHFLOW,
        type: 'checking',
        currency: 'USD',
        metadata: { institutionLogo: 'https://example.com/logo.png' },
      }),
    ).toEqual({ kind: 'logo', src: 'https://example.com/logo.png' });
  });

  it('returns card gradient for known monobank card types', () => {
    const visual = resolveAccountVisual({
      providerType: BANK_PROVIDER_TYPE.MONOBANK,
      type: 'black',
      currency: 'UAH',
    });
    expect(visual.kind).toBe('card');
  });

  it('falls back to currency chip for unknown monobank card types', () => {
    expect(
      resolveAccountVisual({
        providerType: BANK_PROVIDER_TYPE.MONOBANK,
        type: 'someNewTier',
        currency: 'UAH',
      }),
    ).toEqual({ kind: 'currency', code: 'UAH' });
  });

  it('returns currency chip for providers without visuals', () => {
    expect(
      resolveAccountVisual({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        type: 'CACC',
        currency: 'eur',
      }),
    ).toEqual({ kind: 'currency', code: 'EUR' });
  });

  it('ignores empty logo strings', () => {
    expect(
      resolveAccountVisual({
        providerType: BANK_PROVIDER_TYPE.LUNCHFLOW,
        type: 'checking',
        currency: 'USD',
        metadata: { institutionLogo: '' },
      }).kind,
    ).toBe('currency');
  });

  it('derives a logo.dev image from the institution domain when no logo exists', () => {
    const visual = resolveAccountVisual({
      providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
      type: 'bank',
      currency: 'USD',
      metadata: { institutionDomain: 'vanguard.com' },
    });
    expect(visual).toMatchObject({ kind: 'favicon', code: 'USD' });
    expect((visual as { src: string }).src).toContain('https://img.logo.dev/vanguard.com');
  });

  it('falls back to the currency chip when no logo.dev token is configured', () => {
    vi.stubEnv('VITE_LOGO_DEV_TOKEN', '');
    expect(
      resolveAccountVisual({
        providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
        type: 'bank',
        currency: 'USD',
        metadata: { institutionDomain: 'vanguard.com' },
      }),
    ).toEqual({ kind: 'currency', code: 'USD' });
    vi.stubEnv('VITE_LOGO_DEV_TOKEN', 'test-token');
  });

  it('prefers an explicit logo over the domain favicon', () => {
    expect(
      resolveAccountVisual({
        providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
        type: 'bank',
        currency: 'USD',
        metadata: { institutionLogo: 'https://example.com/logo.png', institutionDomain: 'vanguard.com' },
      }),
    ).toEqual({ kind: 'logo', src: 'https://example.com/logo.png' });
  });

  it('never renders the no-currency sentinel as a chip code', () => {
    expect(
      resolveAccountVisual({
        providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
        type: 'bank',
        currency: 'XXX',
      }),
    ).toEqual({ kind: 'currency', code: '···' });

    expect(
      resolveAccountVisual({
        providerType: BANK_PROVIDER_TYPE.SIMPLEFIN,
        type: 'bank',
        currency: 'XXX',
        metadata: { institutionDomain: 'vanguard.com' },
      }),
    ).toMatchObject({ kind: 'favicon', code: '···' });
  });
});

describe('formatIbanCompact', () => {
  it('truncates long IBANs to head and tail groups', () => {
    expect(formatIbanCompact({ iban: 'UA213223130000026007233566001' })).toBe('UA21 3223 ··· 6001');
  });

  it('strips whitespace before measuring', () => {
    expect(formatIbanCompact({ iban: 'UA21 3223 1300 0002 6007 2335 6600 1' })).toBe('UA21 3223 ··· 6001');
  });

  it('returns short values as-is', () => {
    expect(formatIbanCompact({ iban: 'LT12345678' })).toBe('LT12345678');
  });
});

describe('getAccountSecondaryMeta', () => {
  it('extracts iban', () => {
    expect(getAccountSecondaryMeta({ metadata: { iban: 'UA21' } })).toEqual({ iban: 'UA21' });
  });

  it('drops missing iban', () => {
    expect(getAccountSecondaryMeta({ metadata: {} })).toEqual({ iban: null });
  });

  it('handles absent metadata', () => {
    expect(getAccountSecondaryMeta({})).toEqual({ iban: null });
  });
});
