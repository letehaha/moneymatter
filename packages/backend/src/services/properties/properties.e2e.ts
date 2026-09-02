import {
  ACCOUNT_CATEGORIES,
  asDecimal,
  PROPERTY_TYPE,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import Properties from '@models/properties.model';
import { redisClient } from '@root/redis-client';
import { buildLockKey } from '@services/currencies/base-currency-lock';
import * as helpers from '@tests/helpers';
import { format, subDays, subYears } from 'date-fns';

function pastDateString({ yearsAgo }: { yearsAgo: number }): string {
  return format(subYears(new Date(), yearsAgo), 'yyyy-MM-dd');
}

// A house bought 4y ago for $300k at the default +3%/yr sits comfortably above
// purchase but below $400k, which the appreciation assertions below rely on.
function basePayload(overrides: Partial<Parameters<typeof helpers.createProperty>[0]> = {}) {
  return {
    name: '18 Maple Grove',
    currencyCode: 'USD',
    address: '18 Maple Grove',
    city: 'Portland',
    country: 'United States',
    propertyType: PROPERTY_TYPE.house,
    yearBuilt: 1998,
    purchasePrice: 300_000,
    purchaseDate: pastDateString({ yearsAgo: 4 }),
    ...overrides,
  };
}

describe('Properties', () => {
  describe('POST /properties', () => {
    it('creates a property with a system account above purchase price and exposes it in GET /accounts', async () => {
      const response = await helpers.createProperty({ ...basePayload(), raw: true });

      expect(response.id).toEqual(expect.any(String));
      expect(response.address).toBe('18 Maple Grove');
      expect(response.city).toBe('Portland');
      expect(response.country).toBe('United States');
      expect(response.propertyType).toBe(PROPERTY_TYPE.house);
      expect(response.yearBuilt).toBe(1998);
      expect(response.purchasePrice).toBe(300_000);
      // Default rate applies when the payload omits it.
      expect(response.annualAppreciationRatePct).toBe(3);
      expect(response.loanAccountId).toBeNull();

      expect(response.account).not.toBeNull();
      expect(response.account!.accountCategory).toBe(ACCOUNT_CATEGORIES.property);
      expect(response.account!.currentBalance).toBeGreaterThan(300_000);
      expect(response.account!.currentBalance).toBeLessThan(400_000);

      const accounts = await helpers.getAccounts();
      const found = accounts.find((a) => a.id === response.accountId);

      expect(found).toBeDefined();
      expect(found!.accountCategory).toBe(ACCOUNT_CATEGORIES.property);
      expect(Number(found!.currentBalance)).toBeCloseTo(response.account!.currentBalance, 2);
    });

    it('rejects a non-positive purchase price, a malformed purchase date and an out-of-range rate', async () => {
      const negativePrice = await helpers.createProperty({ ...basePayload({ purchasePrice: -1 }), raw: false });
      expect(negativePrice.statusCode).toBe(422);

      const badDate = await helpers.createProperty({ ...basePayload({ purchaseDate: '01-01-2020' }), raw: false });
      expect(badDate.statusCode).toBe(422);

      const absurdRate = await helpers.createProperty({
        ...basePayload({ annualAppreciationRatePct: 300 }),
        raw: false,
      });
      expect(absurdRate.statusCode).toBe(422);
    });

    it('rejects the generic accounts endpoint for the property category', async () => {
      const result = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ accountCategory: ACCOUNT_CATEGORIES.property }),
        raw: false,
      });

      expect(result.statusCode).toBe(422);
    });
  });

  describe('GET /properties', () => {
    it('returns an empty list without properties, then the user’s properties once created', async () => {
      expect(await helpers.getProperties({ raw: true })).toEqual([]);

      const created = await helpers.createProperty({ ...basePayload(), raw: true });
      const list = await helpers.getProperties({ raw: true });

      expect(list).toHaveLength(1);
      expect(list[0]!.id).toBe(created.id);
      expect(list[0]!.account).not.toBeNull();
    });
  });

  describe('GET /properties/:id', () => {
    it('returns 404 for an unknown id', async () => {
      const result = await helpers.getPropertyById({ id: generateRandomRecordId(), raw: false });
      expect(result.statusCode).toBe(404);
    });
  });

  describe('appreciation math', () => {
    it('grows faster at a higher rate over the same holding period', async () => {
      const slow = await helpers.createProperty({
        ...basePayload({ annualAppreciationRatePct: 1 }),
        raw: true,
      });
      const fast = await helpers.createProperty({
        ...basePayload({ annualAppreciationRatePct: 8 }),
        raw: true,
      });

      expect(fast.account!.currentBalance).toBeGreaterThan(slow.account!.currentBalance);
    });

    it('shrinks the value below purchase price when the rate is negative', async () => {
      const declining = await helpers.createProperty({
        ...basePayload({ annualAppreciationRatePct: -10 }),
        raw: true,
      });

      expect(declining.account!.currentBalance).toBeLessThan(300_000);
      expect(declining.account!.currentBalance).toBeGreaterThan(0);
    });

    it('holds the value flat at a zero rate', async () => {
      const flat = await helpers.createProperty({
        ...basePayload({ annualAppreciationRatePct: 0 }),
        raw: true,
      });

      expect(flat.account!.currentBalance).toBeCloseTo(300_000, 2);
    });
  });

  describe('PATCH /properties/:id', () => {
    it('updates metadata without recomputing the value (cache stamp stays)', async () => {
      const property = await helpers.createProperty({ ...basePayload(), raw: true });
      const before = await Properties.findByPk(property.id).then((p) => p!.valueLastComputedAt!.getTime());

      const updated = await helpers.updateProperty({
        id: property.id,
        notes: 'Roof replaced in 2022',
        city: 'Salem',
        raw: true,
      });

      expect(updated.notes).toBe('Roof replaced in 2022');
      expect(updated.city).toBe('Salem');

      const after = await Properties.findByPk(property.id).then((p) => p!.valueLastComputedAt!.getTime());
      expect(after).toBe(before);
    });

    it('force-refreshes the value when the appreciation rate changes', async () => {
      const property = await helpers.createProperty({
        ...basePayload({ annualAppreciationRatePct: 2 }),
        raw: true,
      });
      const originalValue = property.account!.currentBalance;

      const updated = await helpers.updateProperty({
        id: property.id,
        annualAppreciationRatePct: 9,
        raw: true,
      });

      expect(updated.annualAppreciationRatePct).toBe(9);
      expect(updated.account!.currentBalance).toBeGreaterThan(originalValue);
    });

    it('renames the underlying account when `name` is supplied', async () => {
      const property = await helpers.createProperty({ ...basePayload(), raw: true });

      await helpers.updateProperty({ id: property.id, name: 'Lakeside cabin', raw: true });

      const accounts = await helpers.getAccounts();
      expect(accounts.find((a) => a.id === property.accountId)!.name).toBe('Lakeside cabin');
    });
  });

  describe('mortgage link', () => {
    it('links a loan account on create and returns it inline', async () => {
      const loan = await helpers.createLoan({ payload: helpers.buildCreateLoanPayload(), raw: true });

      const property = await helpers.createProperty({
        ...basePayload({ loanAccountId: loan.id }),
        raw: true,
      });

      expect(property.loanAccountId).toBe(loan.id);

      const fromGet = await helpers.getPropertyById({ id: property.id, raw: true });
      expect(fromGet.loanAccount).not.toBeNull();
      expect(fromGet.loanAccount!.id).toBe(loan.id);
    });

    it('clears the link when loanAccountId is patched to null', async () => {
      const loan = await helpers.createLoan({ payload: helpers.buildCreateLoanPayload(), raw: true });
      const property = await helpers.createProperty({ ...basePayload({ loanAccountId: loan.id }), raw: true });

      const updated = await helpers.updateProperty({ id: property.id, loanAccountId: null, raw: true });

      expect(updated.loanAccountId).toBeNull();
      expect(updated.loanAccount).toBeNull();
    });

    it('rejects linking a non-loan account and an account that does not exist', async () => {
      const cashAccount = await helpers.createAccount({ raw: true });

      const wrongCategory = await helpers.createProperty({
        ...basePayload({ loanAccountId: cashAccount.id }),
        raw: false,
      });
      expect(wrongCategory.statusCode).toBe(422);

      const missing = await helpers.createProperty({
        ...basePayload({ loanAccountId: generateRandomRecordId() }),
        raw: false,
      });
      expect(missing.statusCode).toBe(422);
    });

    it('survives deletion of the linked loan by unlinking rather than cascading', async () => {
      const loan = await helpers.createLoan({ payload: helpers.buildCreateLoanPayload(), raw: true });
      const property = await helpers.createProperty({ ...basePayload({ loanAccountId: loan.id }), raw: true });

      await helpers.deleteLoan({ id: loan.id, raw: true });

      const survivor = await helpers.getPropertyById({ id: property.id, raw: true });
      expect(survivor.id).toBe(property.id);
      expect(survivor.loanAccountId).toBeNull();
    });
  });

  describe('Manual override via POST /accounts/:id/balance-adjustment', () => {
    it('creates a transfer_out_wallet income transaction when revaluing up, and an expense when revaluing down', async () => {
      const property = await helpers.createProperty({ ...basePayload(), raw: true });
      const currentValue = property.account!.currentBalance;

      const up = await helpers.overridePropertyValue({
        id: property.id,
        accountId: property.accountId,
        targetValue: currentValue + 50_000,
        note: 'Bank valuation',
      });

      expect(up.transaction).not.toBeNull();
      expect(up.transaction!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_out_wallet);
      expect(up.transaction!.transactionType).toBe(TRANSACTION_TYPES.income);
      expect(up.newBalance).toBeGreaterThan(currentValue);

      const afterUp = await helpers.getPropertyById({ id: property.id, raw: true });
      expect(afterUp.valueAnchor).toBeCloseTo(currentValue + 50_000, 2);
      expect(afterUp.valueAnchorDate).not.toBeNull();

      const down = await helpers.overridePropertyValue({
        id: property.id,
        accountId: property.accountId,
        targetValue: currentValue - 20_000,
      });

      expect(down.transaction!.transactionType).toBe(TRANSACTION_TYPES.expense);
    }, 30000);

    it('returns 404 when revaluing a property that does not exist', async () => {
      const result = await helpers.overridePropertyValue({
        id: generateRandomRecordId(),
        accountId: generateRandomRecordId(),
        targetValue: 100_000,
      });

      expect(result.statusCode).toBe(404);
    });

    it('rejects a negative target value', async () => {
      const property = await helpers.createProperty({ ...basePayload(), raw: true });

      const result = await helpers.overridePropertyValue({
        id: property.id,
        accountId: property.accountId,
        targetValue: -1,
      });
      expect(result.statusCode).toBe(422);
    });
  });

  describe('lazy 30-day cache', () => {
    it('keeps valueLastComputedAt on a list GET within the window and refreshes once it expires', async () => {
      // The cache applies to bulk/list reads (GET /properties, GET /accounts).
      // GET /properties/:id force-refreshes deliberately, so this test uses the
      // list endpoint to exercise the cache.
      const property = await helpers.createProperty({ ...basePayload(), raw: true });
      const first = await Properties.findByPk(property.id).then((p) => p!.valueLastComputedAt!.getTime());

      await helpers.getProperties({ raw: true });

      const second = await Properties.findByPk(property.id).then((p) => p!.valueLastComputedAt!.getTime());
      expect(second).toBe(first);

      // Backdate the cache stamp past the 30-day window to simulate staleness.
      await Properties.update({ valueLastComputedAt: subDays(new Date(), 40) }, { where: { id: property.id } });
      const stale = await Properties.findByPk(property.id).then((p) => p!.valueLastComputedAt!.getTime());

      await helpers.getProperties({ raw: true });

      const refreshed = await Properties.findByPk(property.id).then((p) => p!.valueLastComputedAt!.getTime());
      expect(refreshed).toBeGreaterThan(stale);
    }, 30000);
  });

  // GET /properties/:id force-refreshes the projected value on every read and
  // stamps `valueLastComputedAt`. The base-currency lock must suppress that
  // refresh (the recalc owns the ref* amounts), so the stored value — and its
  // `valueLastComputedAt` — stay frozen until the lock clears.
  describe('lazy refresh — base-currency lock', () => {
    it('skips the force-refresh while the lock is held, then refreshes once it clears', async () => {
      const property = await helpers.createProperty({ ...basePayload(), raw: true });
      const computedAtOnCreate = property.valueLastComputedAt;
      expect(computedAtOnCreate).toBeTruthy();

      const lockKey = buildLockKey(property.userId);
      await redisClient.set(lockKey, 'test-lock');

      const whileLocked = await helpers.getPropertyById({ id: property.id, raw: true });
      expect(whileLocked.valueLastComputedAt).toBe(computedAtOnCreate);

      await redisClient.del(lockKey);

      const afterUnlock = await helpers.getPropertyById({ id: property.id, raw: true });
      expect(new Date(afterUnlock.valueLastComputedAt!).getTime()).toBeGreaterThan(
        new Date(computedAtOnCreate!).getTime(),
      );
    });
  });

  describe('DELETE /properties/:id', () => {
    it('returns 404 for a non-existent id, and deletes the property with its underlying account', async () => {
      const missing = await helpers.deleteProperty({ id: generateRandomRecordId(), raw: false });
      expect(missing.statusCode).toBe(404);

      const property = await helpers.createProperty({ ...basePayload(), raw: true });
      await helpers.deleteProperty({ id: property.id, raw: true });

      const list = await helpers.getProperties({ raw: true });
      expect(list.find((p) => p.id === property.id)).toBeUndefined();

      const accounts = await helpers.getAccounts();
      expect(accounts.find((a) => a.id === property.accountId)).toBeUndefined();
    });
  });

  describe('Revaluation delete reconciliation', () => {
    it('clears the anchor back to purchase when the only revaluation is deleted', async () => {
      const property = await helpers.createProperty({ ...basePayload(), raw: true });
      const baseline = property.account!.currentBalance;

      const override = await helpers.overridePropertyValue({
        id: property.id,
        accountId: property.accountId,
        targetValue: baseline + 75_000,
      });

      await helpers.deleteTransaction({ id: override.transaction!.id });

      const row = await Properties.findByPk(property.id);
      expect(row!.valueAnchor).toBeNull();
      expect(row!.valueAnchorDate).toBeNull();

      const reloaded = await helpers.getPropertyById({ id: property.id, raw: true });
      expect(reloaded.account!.currentBalance).toBeCloseTo(baseline, 0);
    }, 30000);
    it('re-anchors to the prior revaluation when the latest one is deleted', async () => {
      const property = await helpers.createProperty({ ...basePayload(), raw: true });
      const baseline = property.account!.currentBalance;

      await helpers.overridePropertyValue({
        id: property.id,
        accountId: property.accountId,
        targetValue: baseline + 40_000,
        time: subDays(new Date(), 200),
      });
      const second = await helpers.overridePropertyValue({
        id: property.id,
        accountId: property.accountId,
        targetValue: baseline + 90_000,
      });

      await helpers.deleteTransaction({ id: second.transaction!.id });

      const row = await Properties.findByPk(property.id);
      expect(row!.valueAnchor).not.toBeNull();
      // The surviving anchor is the first revaluation, not the purchase price.
      expect(row!.valueAnchor!.toNumber()).toBeCloseTo(baseline + 40_000, -3);
    }, 30000);
  });

  describe('Property account write guards', () => {
    it('rejects plain expense and income transactions on a property account', async () => {
      const property = await helpers.createProperty({ ...basePayload(), raw: true });

      const expense = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: property.accountId,
          transactionType: TRANSACTION_TYPES.expense,
        }),
        raw: false,
      });
      expect(expense.statusCode).toBe(422);

      const income = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({
          accountId: property.accountId,
          transactionType: TRANSACTION_TYPES.income,
        }),
        raw: false,
      });
      expect(income.statusCode).toBe(422);
    });

    it('rejects the generic balance-adjustment endpoint and direct currentBalance writes', async () => {
      const property = await helpers.createProperty({ ...basePayload(), raw: true });

      const adjustment = await helpers.balanceAdjustment({
        id: property.accountId,
        payload: { targetBalance: asDecimal(500_000) },
        raw: false,
      });
      expect(adjustment.statusCode).toBe(200);

      const directWrite = await helpers.makeRequest({
        method: 'put',
        url: `/accounts/${property.accountId}`,
        payload: { currentBalance: 500_000 },
      });
      expect(directWrite.statusCode).toBe(422);
    });

    it('rejects flipping the account category into or out of `property`', async () => {
      const property = await helpers.createProperty({ ...basePayload(), raw: true });

      const flipOut = await helpers.updateAccount({
        id: property.accountId,
        payload: { accountCategory: ACCOUNT_CATEGORIES.general },
        raw: false,
      });
      expect(flipOut.statusCode).toBe(422);

      const cashAccount = await helpers.createAccount({ raw: true });
      const flipIn = await helpers.updateAccount({
        id: cashAccount.id,
        payload: { accountCategory: ACCOUNT_CATEGORIES.property },
        raw: false,
      });
      expect(flipIn.statusCode).toBe(422);
    });
  });
});
