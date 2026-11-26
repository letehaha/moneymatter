import { type FireSettings } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { useSelfHostWithoutServerAiKeys } from '@tests/helpers/ai-test-env';
import { randomUUID } from 'crypto';
import omit from 'lodash/omit';

const SEEDED_FIRE: FireSettings = {
  annualSpendingOverride: 36000,
  monthlyContributionOverride: -1200,
  spendingExcludedCategoryIds: [randomUUID(), randomUUID()],
  includeVentures: true,
  includeVehicles: true,
  includeLoans: true,
  returnIndicatorId: 'world-stock',
  customReturnPct: null,
  inflationPct: 2.5,
  withdrawalRatePct: 3.5,
  leanMultiplier: 0.7,
  fatMultiplier: 1.5,
  baristaMonthlyIncome: 800,
  birthYear: 1990,
  coastTargetAge: 60,
  targetType: 'fat',
};

const STALE_FIRE: FireSettings = {
  ...SEEDED_FIRE,
  withdrawalRatePct: 4,
  birthYear: 1985,
  spendingExcludedCategoryIds: [],
};

const AMOUNT_KEYS = ['annualSpendingOverride', 'monthlyContributionOverride', 'baristaMonthlyIncome'] as const;

const seedFire = () => helpers.patchUserSettings({ raw: true, patch: { fire: SEEDED_FIRE } });

const readFire = async () => (await helpers.getUserSettings({ raw: true })).fire;

const waitForOnboardingTasks = async ({ taskIds }: { taskIds: string[] }) => {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const { completedTasks } = await helpers.getOnboarding({ raw: true });
    if (taskIds.every((taskId) => completedTasks.includes(taskId))) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Onboarding tasks ${taskIds.join(', ')} were never marked complete`);
};

describe('FIRE settings integrity across settings writers', () => {
  it('stores the full seeded slice', async () => {
    await seedFire();

    expect(await readFire()).toStrictEqual(SEEDED_FIRE);
  });

  describe('PUT /user/settings', () => {
    it('ignores a stale fire copy', async () => {
      await seedFire();

      const response = await helpers.updateUserSettings({ settings: { locale: 'uk', fire: STALE_FIRE } });
      expect(response.statusCode).toBe(200);

      const fetched = await helpers.getUserSettings({ raw: true });
      expect(fetched.locale).toBe('uk');
      expect(fetched.fire).toStrictEqual(SEEDED_FIRE);
    });

    it('ignores a fire copy that fails validation', async () => {
      await seedFire();

      const response = await helpers.updateUserSettings({
        settings: { locale: 'uk', fire: { ...SEEDED_FIRE, withdrawalRatePct: 99 } },
      });
      expect(response.statusCode).toBe(200);

      const fetched = await helpers.getUserSettings({ raw: true });
      expect(fetched.locale).toBe('uk');
      expect(fetched.fire).toStrictEqual(SEEDED_FIRE);
    });

    it('keeps fire when the body has none', async () => {
      await seedFire();

      const response = await helpers.updateUserSettings({ settings: { locale: 'uk' } });
      expect(response.statusCode).toBe(200);

      expect(await readFire()).toStrictEqual(SEEDED_FIRE);
    });

    it('does not seed fire when it creates the settings row', async () => {
      const response = await helpers.updateUserSettings({ settings: { locale: 'uk', fire: STALE_FIRE } });
      expect(response.statusCode).toBe(200);

      const fetched = await helpers.getUserSettings({ raw: true });
      expect(fetched.locale).toBe('uk');
      expect(fetched.fire).toBeUndefined();
    });
  });

  describe('other settings writers', () => {
    it('keeps fire when other slices are patched', async () => {
      await seedFire();

      const patches = [
        { locale: 'uk' },
        { dashboard: { widgets: [{ widgetId: 'balance-trend', colSpan: 2, rowSpan: 1 }] } },
        { notifications: { watchlistAlerts: { push: false } } },
      ];
      for (const patch of patches) {
        const response = await helpers.patchUserSettings({ patch });
        expect({ patch, statusCode: response.statusCode }).toStrictEqual({ patch, statusCode: 200 });
      }

      expect(await readFire()).toStrictEqual(SEEDED_FIRE);
    });

    it('keeps fire when the onboarding state is updated', async () => {
      await seedFire();

      await helpers.updateOnboarding({ raw: true, onboardingState: { isDismissed: true } });

      expect(await readFire()).toStrictEqual(SEEDED_FIRE);
    });

    it('keeps fire when creating a category and a tag marks onboarding tasks complete', async () => {
      await seedFire();

      await helpers.addCustomCategory({ name: 'FIRE guard', color: '#000000', raw: true });
      await helpers.createTag({ payload: helpers.buildTagPayload(), raw: true });
      await waitForOnboardingTasks({ taskIds: ['create-category', 'create-tag'] });

      expect(await readFire()).toStrictEqual(SEEDED_FIRE);
    });

    it('converts only the override amounts when the base currency changes', async () => {
      await helpers.addUserCurrencies({ currencyCodes: ['USD'], raw: true });
      await seedFire();

      const status = await helpers.changeBaseCurrencyAndWait({ newCurrencyCode: 'USD' });
      helpers.expectBaseCurrencyChangeCompleted(status);

      const [oldBaseToUsd] = await helpers.getCurrenciesRates({ codes: [global.BASE_CURRENCY_CODE] });
      const rate = Number(oldBaseToUsd!.rate);

      const fire = await readFire();
      expect(omit(fire, AMOUNT_KEYS)).toStrictEqual(omit(SEEDED_FIRE, AMOUNT_KEYS));
      for (const key of AMOUNT_KEYS) {
        expect(fire?.[key]).toBeCloseTo(Math.round(SEEDED_FIRE[key]! * rate * 100) / 100, 2);
      }
    }, 30000);

    describe('AI settings', () => {
      useSelfHostWithoutServerAiKeys();

      it('keeps fire when an AI connection and custom instructions are saved', async () => {
        await seedFire();

        await helpers.createFirstConnection();
        const response = await helpers.setCustomInstructions({ instructions: 'Rent is a fixed cost' });
        expect(response.statusCode).toBe(200);

        expect(await readFire()).toStrictEqual(SEEDED_FIRE);
      });
    });
  });

  describe('PATCH /user/settings fire', () => {
    it('changes only the patched key', async () => {
      await seedFire();

      await helpers.patchUserSettings({ raw: true, patch: { fire: { withdrawalRatePct: 4 } } });

      expect(await readFire()).toStrictEqual({ ...SEEDED_FIRE, withdrawalRatePct: 4 });
    });

    it('treats an empty fire object as a no-op', async () => {
      await seedFire();

      await helpers.patchUserSettings({ raw: true, patch: { fire: {} } });

      expect(await readFire()).toStrictEqual(SEEDED_FIRE);
    });

    it('rejects a null or non-object fire and keeps the stored slice', async () => {
      await seedFire();

      for (const fire of [null, 'reset', 42, []]) {
        const response = await helpers.patchUserSettings({ patch: { fire } });
        expect({ fire, statusCode: response.statusCode }).toStrictEqual({
          fire,
          statusCode: ERROR_CODES.ValidationError,
        });
      }

      expect(await readFire()).toStrictEqual(SEEDED_FIRE);
    });

    it('rejects a patch with one invalid fire field and stores nothing from it', async () => {
      await seedFire();
      const before = await helpers.getUserSettings({ raw: true });

      const response = await helpers.patchUserSettings({
        patch: { locale: 'uk', fire: { withdrawalRatePct: 4, leanMultiplier: 1.2 } },
      });
      expect(response.statusCode).toBe(ERROR_CODES.ValidationError);

      expect(await helpers.getUserSettings({ raw: true })).toStrictEqual(before);
    });
  });

  it('keeps every fire update when PATCH, PUT and onboarding writes race', async () => {
    await seedFire();

    const withdrawalRates = Array.from({ length: 10 }, (_, index) => 4 + index * 0.25);
    const otherKeyUpdates: FireSettings = {
      inflationPct: 3,
      leanMultiplier: 0.6,
      fatMultiplier: 2,
      coastTargetAge: 55,
      includeVentures: false,
    };

    const responses = await Promise.all([
      ...withdrawalRates.flatMap((withdrawalRatePct, index) => [
        helpers.patchUserSettings({ patch: { fire: { withdrawalRatePct } } }),
        helpers.updateUserSettings({ settings: { locale: index % 2 ? 'uk' : 'en' } }),
        helpers.updateOnboarding({ onboardingState: { isDismissed: index % 2 === 0 } }),
      ]),
      ...Object.entries(otherKeyUpdates).map(([key, value]) =>
        helpers.patchUserSettings({ patch: { fire: { [key]: value } } }),
      ),
    ]);
    expect(responses.map(({ statusCode }) => statusCode)).toStrictEqual(responses.map(() => 200));

    const fire = await readFire();
    expect(withdrawalRates).toContain(fire?.withdrawalRatePct);
    expect(omit(fire, 'withdrawalRatePct')).toStrictEqual(
      omit({ ...SEEDED_FIRE, ...otherKeyUpdates }, 'withdrawalRatePct'),
    );
  });
});
