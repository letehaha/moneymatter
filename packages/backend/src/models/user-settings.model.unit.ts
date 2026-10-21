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
    const result = ZodSettingsSchema.safeParse({ locale: 'fr' });
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
    const result = ZodSettingsPatchSchema.safeParse({ locale: 'fr' });
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

describe('ZodSettingsSchema – notifications push groups', () => {
  it('accepts a partial push-group save without enabled and types', () => {
    const result = ZodSettingsSchema.safeParse({ notifications: { push: { groups: { reminders: false } } } });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notifications).toStrictEqual({ push: { groups: { reminders: false } } });
    }
  });

  it('accepts a stored notifications object without enabled and types', () => {
    expect(ZodSettingsSchema.safeParse({ notifications: {} }).success).toBe(true);
    expect(ZodSettingsSchema.safeParse({ notifications: { push: {} } }).success).toBe(true);
  });

  it('still accepts the legacy enabled and types keys next to push groups', () => {
    const result = ZodSettingsSchema.safeParse({
      notifications: {
        enabled: true,
        types: { tracker_alert: false },
        push: { groups: { releases: true } },
      },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notifications?.enabled).toBe(true);
      expect(result.data.notifications?.types?.tracker_alert).toBe(false);
      expect(result.data.notifications?.push?.groups?.releases).toBe(true);
    }
  });

  it('does not inject defaults for groups the user never set', () => {
    const result = ZodSettingsSchema.safeParse({ notifications: { push: { groups: {} } } });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.notifications?.push?.groups).toStrictEqual({});
  });

  it('rejects an unknown-typed group value', () => {
    expect(ZodSettingsSchema.safeParse({ notifications: { push: { groups: { reminders: 'yes' } } } }).success).toBe(
      false,
    );
  });
});

describe('ZodSettingsPatchSchema – notifications push groups', () => {
  it('accepts a single group and adds no defaults', () => {
    const result = ZodSettingsPatchSchema.safeParse({ notifications: { push: { groups: { releases: true } } } });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toStrictEqual({ notifications: { push: { groups: { releases: true } } } });
    }
  });

  it('accepts every group', () => {
    const groups = { reminders: true, bankSync: false, sharing: true, system: false, releases: true };
    const result = ZodSettingsPatchSchema.safeParse({ notifications: { push: { groups } } });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.notifications?.push?.groups).toStrictEqual(groups);
  });
});
