import {
  API_ERROR_CODES,
  FEATURES,
  FIRE_HISTORY_BASELINE_MONTH,
  FIRE_HISTORY_MAX_ENTRIES,
  FIRE_LIMITS,
  FIRE_MAX_EXCLUDED_CATEGORIES,
  type FireSettingsSnapshot,
  PLANS,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import UserSettings, { type SettingsSchema } from '@models/user-settings.model';
import * as helpers from '@tests/helpers';
import type { ErrorResponse } from '@tests/helpers/common';
import { randomUUID } from 'crypto';
import { format, subMonths } from 'date-fns';

const DAY = 24 * 60 * 60 * 1000;

const CURRENT_MONTH = format(new Date(), 'yyyy-MM');

const storeFire = () => helpers.patchUserSettings({ raw: true, patch: { fire: { withdrawalRatePct: 4 } } });

const readHistory = async () => (await helpers.getUserSettings({ raw: true })).fireHistory;

// Arranges states no endpoint writes: a fire saved before history existed, or snapshots from past months.
const writeStoredSettings = async ({ settings }: { settings: Partial<SettingsSchema> }) => {
  const { id: userId } = await helpers.getUserInfo({ raw: true });
  await helpers.patchUserSettings({ raw: true, patch: { locale: 'en' } });
  const row = await UserSettings.findOne({ where: { userId } });
  await row!.update({ settings: { ...row!.settings, ...settings } });
};

describe('FIRE settings slice', () => {
  it('stores only the patched field under fire', async () => {
    await helpers.patchUserSettings({ raw: true, patch: { fire: { birthYear: 1990 } } });

    const fetched = await helpers.getUserSettings({ raw: true });
    expect(fetched.fire).toStrictEqual({ birthYear: 1990 });
  });

  it('clears a field with null and keeps its siblings', async () => {
    await helpers.patchUserSettings({
      raw: true,
      patch: { fire: { annualSpendingOverride: 36000, withdrawalRatePct: 3.5, includeLoans: true } },
    });

    await helpers.patchUserSettings({ raw: true, patch: { fire: { annualSpendingOverride: null } } });

    const fetched = await helpers.getUserSettings({ raw: true });
    expect(fetched.fire).toStrictEqual({ annualSpendingOverride: null, withdrawalRatePct: 3.5, includeLoans: true });
  });

  it('rejects out-of-range values and keeps the stored slice', async () => {
    await helpers.patchUserSettings({ raw: true, patch: { fire: { withdrawalRatePct: 4 } } });

    const invalidPatches = [
      { fire: { withdrawalRatePct: 0 } },
      { fire: { leanMultiplier: 1.2 } },
      {
        fire: {
          spendingExcludedCategoryIds: Array.from({ length: FIRE_MAX_EXCLUDED_CATEGORIES + 1 }, () => randomUUID()),
        },
      },
      { fire: { spendingExcludedCategoryIds: ['not-a-uuid'] } },
      { fire: { birthYear: 1990.5 } },
      { fire: { annualSpendingOverride: -1 } },
      { fire: { customReturnPct: FIRE_LIMITS.customReturnPct.max + 1 } },
      { fire: { returnIndicatorId: 'x'.repeat(65) } },
    ];
    for (const patch of invalidPatches) {
      const response = await helpers.patchUserSettings({ patch });
      expect({ patch, statusCode: response.statusCode }).toStrictEqual({
        patch,
        statusCode: ERROR_CODES.ValidationError,
      });
    }

    const fetched = await helpers.getUserSettings({ raw: true });
    expect(fetched.fire).toStrictEqual({ withdrawalRatePct: 4 });
  });

  it('patches other slices when the stored fire holds a value outside the current limits', async () => {
    await storeFire();
    const { id: userId } = await helpers.getUserInfo({ raw: true });
    // No endpoint writes an out-of-range fire, so a limit tightened after the save is simulated in the DB.
    const row = await UserSettings.findOne({ where: { userId } });
    await row!.update({ settings: { ...row!.settings, fire: { withdrawalRatePct: 99 } } });

    const response = await helpers.patchUserSettings({ patch: { locale: 'uk' } });
    expect(response.statusCode).toBe(200);

    const fetched = await helpers.getUserSettings({ raw: true });
    expect(fetched.locale).toBe('uk');
    expect(fetched.fire).toStrictEqual({ withdrawalRatePct: 99 });
  });

  it('saves the target type and keeps the other fire keys', async () => {
    await helpers.patchUserSettings({ raw: true, patch: { fire: { withdrawalRatePct: 3.5, birthYear: 1990 } } });

    await helpers.patchUserSettings({ raw: true, patch: { fire: { targetType: 'lean' } } });

    const fetched = await helpers.getUserSettings({ raw: true });
    expect(fetched.fire).toStrictEqual({ withdrawalRatePct: 3.5, birthYear: 1990, targetType: 'lean' });
  });

  it('rejects an unknown target type and changes nothing', async () => {
    await helpers.patchUserSettings({ raw: true, patch: { fire: { targetType: 'fat' } } });
    const before = await helpers.getUserSettings({ raw: true });

    for (const targetType of ['coast', 'x']) {
      const response = await helpers.patchUserSettings({ patch: { locale: 'uk', fire: { targetType } } });
      expect({ targetType, statusCode: response.statusCode }).toStrictEqual({
        targetType,
        statusCode: ERROR_CODES.ValidationError,
      });
    }

    expect(await helpers.getUserSettings({ raw: true })).toStrictEqual(before);
  });

  it('leaves dashboard widgets untouched', async () => {
    const widgets = [
      { widgetId: 'balance-trend', colSpan: 2, rowSpan: 1 },
      { widgetId: 'subscriptions-overview', colSpan: 1, rowSpan: 1 },
    ];
    await helpers.patchUserSettings({ raw: true, patch: { dashboard: { widgets } } });

    await helpers.patchUserSettings({ raw: true, patch: { fire: { coastTargetAge: 60 } } });

    const fetched = await helpers.getUserSettings({ raw: true });
    expect(fetched.dashboard?.widgets).toStrictEqual(widgets);
    expect(fetched.fire).toStrictEqual({ coastTargetAge: 60 });
  });

  it('converts the override amounts when the base currency changes', async () => {
    await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });

    await helpers.patchUserSettings({
      raw: true,
      patch: {
        fire: {
          annualSpendingOverride: 36000,
          monthlyContributionOverride: -1200,
          baristaMonthlyIncome: 800,
          withdrawalRatePct: 3.5,
        },
      },
    });

    const status = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: 'USD' });
    helpers.expectBaseCurrencyChangeCompleted(status);

    const [oldBaseToUsd] = await helpers.getCurrenciesRates({ codes: [global.BASE_CURRENCY_CODE] });
    const rate = Number(oldBaseToUsd!.rate);
    const convert = ({ amount }: { amount: number }) => Math.round(amount * rate * 100) / 100;

    const { fire } = await helpers.getUserSettings({ raw: true });
    expect(fire?.annualSpendingOverride).toBeCloseTo(convert({ amount: 36000 }), 2);
    expect(fire?.monthlyContributionOverride).toBeCloseTo(convert({ amount: -1200 }), 2);
    expect(fire?.baristaMonthlyIncome).toBeCloseTo(convert({ amount: 800 }), 2);
    expect(fire?.annualSpendingOverride).not.toBe(36000);
    expect(fire?.withdrawalRatePct).toBe(3.5);
  }, 30000);

  it('keeps a cleared override null and converts the set one when the base currency changes', async () => {
    await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
    await helpers.patchUserSettings({
      raw: true,
      patch: { fire: { annualSpendingOverride: null, baristaMonthlyIncome: 800 } },
    });

    const status = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: 'USD' });
    helpers.expectBaseCurrencyChangeCompleted(status);

    const [oldBaseToUsd] = await helpers.getCurrenciesRates({ codes: [global.BASE_CURRENCY_CODE] });
    const { fire } = await helpers.getUserSettings({ raw: true });
    expect(fire?.annualSpendingOverride).toBeNull();
    expect(fire?.baristaMonthlyIncome).toBeCloseTo(Math.round(800 * Number(oldBaseToUsd!.rate) * 100) / 100, 2);
  }, 30000);

  describe('history', () => {
    it('records a baseline and the current month on the first change, then overwrites the current month', async () => {
      await helpers.patchUserSettings({ raw: true, patch: { fire: { withdrawalRatePct: 4 } } });

      expect(await readHistory()).toStrictEqual([
        { month: FIRE_HISTORY_BASELINE_MONTH, fire: {} },
        { month: CURRENT_MONTH, fire: { withdrawalRatePct: 4 } },
      ]);

      await helpers.patchUserSettings({ raw: true, patch: { fire: { birthYear: 1990 } } });

      expect(await readHistory()).toStrictEqual([
        { month: FIRE_HISTORY_BASELINE_MONTH, fire: {} },
        { month: CURRENT_MONTH, fire: { withdrawalRatePct: 4, birthYear: 1990 } },
      ]);
    });

    it('stores the fire saved before history began as the baseline', async () => {
      await writeStoredSettings({ settings: { fire: { withdrawalRatePct: 4, paceAnchor: '2025-01' } } });

      await helpers.patchUserSettings({ raw: true, patch: { fire: { withdrawalRatePct: 3.5 } } });

      expect(await readHistory()).toStrictEqual([
        { month: FIRE_HISTORY_BASELINE_MONTH, fire: { withdrawalRatePct: 4 } },
        { month: CURRENT_MONTH, fire: { withdrawalRatePct: 3.5 } },
      ]);
    });

    it('appends after a past month and keeps the newest entries within the cap', async () => {
      const pastHistory: FireSettingsSnapshot[] = Array.from({ length: FIRE_HISTORY_MAX_ENTRIES }, (_, index) => ({
        month: format(subMonths(new Date(), FIRE_HISTORY_MAX_ENTRIES - index), 'yyyy-MM'),
        fire: { withdrawalRatePct: 4 },
      }));
      await writeStoredSettings({ settings: { fire: { withdrawalRatePct: 4 }, fireHistory: pastHistory } });

      await helpers.patchUserSettings({ raw: true, patch: { fire: { withdrawalRatePct: 3.5 } } });

      expect(await readHistory()).toStrictEqual([
        ...pastHistory.slice(1),
        { month: CURRENT_MONTH, fire: { withdrawalRatePct: 3.5 } },
      ]);
    });

    it('records nothing for a patch that leaves fire unchanged', async () => {
      await writeStoredSettings({ settings: { fire: { withdrawalRatePct: 4 } } });

      await helpers.patchUserSettings({ raw: true, patch: { locale: 'uk' } });
      await helpers.patchUserSettings({ raw: true, patch: { fire: {} } });
      await helpers.patchUserSettings({ raw: true, patch: { fire: { withdrawalRatePct: 4 } } });

      expect(await readHistory()).toBeUndefined();
    });

    it('stores paceAnchor and targetType on fire but never records them in history', async () => {
      await storeFire();
      const before = await readHistory();

      await helpers.patchUserSettings({ raw: true, patch: { fire: { paceAnchor: '2025-03', targetType: 'lean' } } });

      const fetched = await helpers.getUserSettings({ raw: true });
      expect(fetched.fire).toStrictEqual({ withdrawalRatePct: 4, paceAnchor: '2025-03', targetType: 'lean' });
      expect(fetched.fireHistory).toStrictEqual(before);

      await helpers.patchUserSettings({ raw: true, patch: { fire: { paceAnchor: '2025-04', birthYear: 1990 } } });

      expect((await readHistory())?.at(-1)).toStrictEqual({
        month: CURRENT_MONTH,
        fire: { withdrawalRatePct: 4, birthYear: 1990 },
      });
    });

    it('clears paceAnchor with null and rejects a malformed month', async () => {
      await helpers.patchUserSettings({ raw: true, patch: { fire: { paceAnchor: '2025-12' } } });

      for (const paceAnchor of ['2025-13', '2025-00', '2025-1', '25-01', '2025-01-01', 202501]) {
        const response = await helpers.patchUserSettings({ patch: { fire: { paceAnchor } } });
        expect({ paceAnchor, statusCode: response.statusCode }).toStrictEqual({
          paceAnchor,
          statusCode: ERROR_CODES.ValidationError,
        });
      }
      expect((await helpers.getUserSettings({ raw: true })).fire?.paceAnchor).toBe('2025-12');

      await helpers.patchUserSettings({ raw: true, patch: { fire: { paceAnchor: null } } });
      expect((await helpers.getUserSettings({ raw: true })).fire?.paceAnchor).toBeNull();
    });

    it('ignores fireHistory sent through PATCH and PUT', async () => {
      await storeFire();
      const before = await readHistory();
      const forged: FireSettingsSnapshot[] = [{ month: '2020-01', fire: { withdrawalRatePct: 9 } }];

      const patched = await helpers.patchUserSettings({ patch: { locale: 'uk', fireHistory: forged } });
      expect(patched.statusCode).toBe(200);
      const put = await helpers.updateUserSettings({ settings: { locale: 'en', fireHistory: forged } });
      expect(put.statusCode).toBe(200);

      const fetched = await helpers.getUserSettings({ raw: true });
      expect(fetched.locale).toBe('en');
      expect(fetched.fireHistory).toStrictEqual(before);
    });

    it('does not seed fireHistory when PUT creates the settings row', async () => {
      const forged: FireSettingsSnapshot[] = [{ month: '2020-01', fire: { withdrawalRatePct: 9 } }];

      const response = await helpers.updateUserSettings({ settings: { locale: 'uk', fireHistory: forged } });
      expect(response.statusCode).toBe(200);

      expect(await readHistory()).toBeUndefined();
    });

    it('converts the history amounts when the base currency changes, even with none on fire', async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      await writeStoredSettings({
        settings: {
          fire: { annualSpendingOverride: null, withdrawalRatePct: 4 },
          fireHistory: [
            { month: FIRE_HISTORY_BASELINE_MONTH, fire: {} },
            {
              month: '2025-01',
              fire: { annualSpendingOverride: 36000, monthlyContributionOverride: -1200, withdrawalRatePct: 3.5 },
            },
          ],
        },
      });

      const status = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: 'USD' });
      helpers.expectBaseCurrencyChangeCompleted(status);

      const [oldBaseToUsd] = await helpers.getCurrenciesRates({ codes: [global.BASE_CURRENCY_CODE] });
      const rate = Number(oldBaseToUsd!.rate);

      const { fire, fireHistory } = await helpers.getUserSettings({ raw: true });
      expect(fire).toStrictEqual({ annualSpendingOverride: null, withdrawalRatePct: 4 });
      expect(fireHistory?.[0]).toStrictEqual({ month: FIRE_HISTORY_BASELINE_MONTH, fire: {} });
      const converted = fireHistory?.[1]?.fire;
      expect(converted?.annualSpendingOverride).toBeCloseTo(Math.round(36000 * rate * 100) / 100, 2);
      expect(converted?.monthlyContributionOverride).toBeCloseTo(Math.round(-1200 * rate * 100) / 100, 2);
      expect(converted?.annualSpendingOverride).not.toBe(36000);
      expect(converted?.withdrawalRatePct).toBe(3.5);
    }, 30000);
  });

  describe('plan gating', () => {
    it.each([
      { label: 'an essential plan', billing: { plan: PLANS.essential } },
      { label: 'an ended account trial', billing: { trialEndsAt: new Date(Date.now() - DAY) } },
    ])('rejects a fire patch with 402 for $label and keeps the stored slice', async ({ billing }) => {
      await storeFire();
      await helpers.setUserBilling(billing);

      const response = await helpers.patchUserSettings({ patch: { fire: { withdrawalRatePct: 5 } } });
      expect(response.statusCode).toBe(ERROR_CODES.PaymentRequired);
      expect((response.body.response as unknown as ErrorResponse).code).toBe(API_ERROR_CODES.planRequired);

      expect((await helpers.getUserSettings({ raw: true })).fire).toStrictEqual({ withdrawalRatePct: 4 });
    });

    it('still patches other slices for a user without the feature', async () => {
      await helpers.setUserBilling({ plan: PLANS.essential });

      const response = await helpers.patchUserSettings({ patch: { locale: 'uk' } });
      expect(response.statusCode).toBe(200);
      expect((await helpers.getUserSettings({ raw: true })).locale).toBe('uk');
    });

    it.each([
      { label: 'without the feature', billing: { plan: PLANS.essential } },
      { label: 'on the plus plan', billing: { plan: PLANS.plus } },
    ])('ignores fire on PUT for a user $label', async ({ billing }) => {
      await storeFire();
      await helpers.setUserBilling(billing);

      const response = await helpers.updateUserSettings({
        settings: { locale: 'uk', fire: { withdrawalRatePct: 5, birthYear: 1990 } },
      });
      expect(response.statusCode).toBe(200);

      const fetched = await helpers.getUserSettings({ raw: true });
      expect(fetched.locale).toBe('uk');
      expect(fetched.fire).toStrictEqual({ withdrawalRatePct: 4 });
    });

    it('rejects a fire patch with 402 once the FIRE planner trial has elapsed', async () => {
      await helpers.setUserBilling({ plan: PLANS.essential });
      const { id: userId } = await helpers.getUserInfo({ raw: true });
      await helpers.startFeatureTrial({ feature: FEATURES.fire_planner, raw: true });
      await helpers.backdateFeatureTrial({ userId, feature: FEATURES.fire_planner });

      const response = await helpers.patchUserSettings({ patch: { fire: { withdrawalRatePct: 5 } } });
      expect(response.statusCode).toBe(ERROR_CODES.PaymentRequired);
      expect((response.body.response as unknown as ErrorResponse).code).toBe(API_ERROR_CODES.planRequired);
      expect((await helpers.getUserSettings({ raw: true })).fire).toBeUndefined();
    });

    it('accepts a fire patch during an active FIRE planner trial', async () => {
      await helpers.setUserBilling({ plan: PLANS.essential });
      await helpers.startFeatureTrial({ feature: FEATURES.fire_planner, raw: true });

      const response = await helpers.patchUserSettings({ patch: { fire: { withdrawalRatePct: 5 } } });
      expect(response.statusCode).toBe(200);
      expect((await helpers.getUserSettings({ raw: true })).fire).toStrictEqual({ withdrawalRatePct: 5 });
    });

    it('accepts a fire patch on the plus plan', async () => {
      await helpers.setUserBilling({ plan: PLANS.plus });

      const patched = await helpers.patchUserSettings({ patch: { fire: { withdrawalRatePct: 5 } } });
      expect(patched.statusCode).toBe(200);
      expect((await helpers.getUserSettings({ raw: true })).fire).toStrictEqual({ withdrawalRatePct: 5 });
    });
  });
});
