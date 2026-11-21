import { SUPPORTED_LOCALES } from '@bt/shared/i18n/locales';
import { describe, expect, it } from '@jest/globals';

import { ZodSettingsPatchSchema, ZodSettingsSchema } from './user-settings.model';

describe('ZodSettingsSchema – locale field', () => {
  it('accepts English locale', () => {
    const result = ZodSettingsSchema.safeParse({ locale: SUPPORTED_LOCALES.ENGLISH });
    expect(result.success).toBe(true);
  });

  it('accepts Ukrainian locale', () => {
    const result = ZodSettingsSchema.safeParse({ locale: SUPPORTED_LOCALES.UKRAINIAN });
    expect(result.success).toBe(true);
  });

  it.each(Object.values(SUPPORTED_LOCALES))('accepts every supported locale (%s)', (locale) => {
    const result = ZodSettingsSchema.safeParse({ locale });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.locale).toBe(locale);
  });

  it('rejects an unsupported locale', () => {
    const result = ZodSettingsSchema.safeParse({ locale: 'xx' });
    expect(result.success).toBe(false);
  });

  it('defaults to English when locale is omitted', () => {
    const result = ZodSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.locale).toBe(SUPPORTED_LOCALES.ENGLISH);
  });
});

describe('ZodSettingsPatchSchema – locale field', () => {
  it('accepts English locale', () => {
    const result = ZodSettingsPatchSchema.safeParse({ locale: SUPPORTED_LOCALES.ENGLISH });
    expect(result.success).toBe(true);
  });

  it('accepts Ukrainian locale', () => {
    const result = ZodSettingsPatchSchema.safeParse({ locale: SUPPORTED_LOCALES.UKRAINIAN });
    expect(result.success).toBe(true);
  });

  it.each(Object.values(SUPPORTED_LOCALES))('accepts every supported locale (%s)', (locale) => {
    const result = ZodSettingsPatchSchema.safeParse({ locale });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.locale).toBe(locale);
  });

  it('rejects an unsupported locale', () => {
    const result = ZodSettingsPatchSchema.safeParse({ locale: 'xx' });
    expect(result.success).toBe(false);
  });

  it('omits locale when not provided (patch schema has no default)', () => {
    const result = ZodSettingsPatchSchema.safeParse({});
    expect(result.success).toBe(true);
    // Patch schema intentionally has no default – absent locale stays undefined
    // so the deep-merge preserves the stored value instead of clobbering it
    if (result.success) expect(result.data.locale).toBeUndefined();
  });
});
