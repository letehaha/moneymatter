import {
  ACCOUNT_CATEGORIES,
  asDecimal,
  DEPRECIATION_PRESET,
  SHARE_PERMISSIONS,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
  VEHICLE_CLASS,
} from '@bt/shared/types';
import { generateRandomRecordId } from '@common/lib/record-id-helpers';
import { describe, expect, it } from '@jest/globals';
import Vehicles from '@models/vehicles.model';
import { redisClient } from '@root/redis-client';
import { buildLockKey } from '@services/currencies/base-currency-lock';
import * as helpers from '@tests/helpers';
import { format, subDays, subYears } from 'date-fns';

function todayString(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

function pastDateString({ yearsAgo }: { yearsAgo: number }): string {
  return format(subYears(new Date(), yearsAgo), 'yyyy-MM-dd');
}

// A sedan bought 3y ago for $25k sits well below $18k on the default curve, so an
// override to $18k always moves the value UP — relied on by the positive control.
function basePayload(overrides: Partial<Parameters<typeof helpers.createVehicle>[0]> = {}) {
  return {
    name: 'Toyota Camry 2020',
    currencyCode: 'USD',
    make: 'Toyota',
    model: 'Camry',
    year: 2020,
    vehicleClass: VEHICLE_CLASS.sedan,
    purchasePrice: 25000,
    purchaseDate: pastDateString({ yearsAgo: 3 }),
    ...overrides,
  };
}

function createVehicleAccount() {
  return helpers.createVehicle({ ...basePayload(), raw: true });
}

describe('Vehicles', () => {
  describe('POST /vehicles', () => {
    it('creates a vehicle with a system account below purchase price and exposes it in GET /accounts', async () => {
      const response = await helpers.createVehicle({ ...basePayload(), raw: true });

      expect(response).toBeDefined();
      expect(response.id).toEqual(expect.any(String));
      expect(response.make).toBe('Toyota');
      expect(response.model).toBe('Camry');
      expect(response.year).toBe(2020);
      expect(response.vehicleClass).toBe(VEHICLE_CLASS.sedan);
      expect(response.purchasePrice).toBe(25000);
      expect(response.depreciationPreset).toBe(DEPRECIATION_PRESET.classDefault);
      expect(response.salvageFloorPct).toBe(10);

      expect(response.account).not.toBeNull();
      expect(response.account!.accountCategory).toBe(ACCOUNT_CATEGORIES.vehicle);
      expect(response.account!.currentBalance).toBeLessThan(25000);
      expect(response.account!.currentBalance).toBeGreaterThan(10000);

      const accounts = await helpers.getAccounts();
      const found = accounts.find((a) => a.id === response.accountId);

      expect(found).toBeDefined();
      expect(found!.accountCategory).toBe(ACCOUNT_CATEGORIES.vehicle);
      expect(Number(found!.currentBalance)).toBeCloseTo(response.account!.currentBalance, 2);
    });

    it('rejects negative purchase price, out-of-range year, and custom preset without customAnnualRatePct', async () => {
      const negativePrice = await helpers.createVehicle({
        ...basePayload({ purchasePrice: -100 }),
        raw: false,
      });
      expect(negativePrice.statusCode).toBe(422);

      const badYear = await helpers.createVehicle({
        ...basePayload({ year: 1800 }),
        raw: false,
      });
      expect(badYear.statusCode).toBe(422);

      const customWithoutRate = await helpers.createVehicle({
        ...basePayload({
          depreciationPreset: DEPRECIATION_PRESET.custom,
          customAnnualRatePct: null,
        }),
        raw: false,
      });
      expect(customWithoutRate.statusCode).toBe(422);
    });
  });

  describe('GET /vehicles', () => {
    it('returns an empty list without vehicles, then the user’s vehicles once created', async () => {
      const emptyList = await helpers.getVehicles({ raw: true });
      expect(emptyList).toEqual([]);

      await helpers.createVehicle({ ...basePayload(), raw: true });
      await helpers.createVehicle({
        ...basePayload({ name: 'Truck', make: 'Ford', model: 'F-150', vehicleClass: VEHICLE_CLASS.truck }),
        raw: true,
      });

      const list = await helpers.getVehicles({ raw: true });
      expect(list.length).toBe(2);
    });
  });

  describe('depreciation math', () => {
    it('luxury depreciates faster than sedan over Y1 with same purchase price/date', async () => {
      const sedan = await helpers.createVehicle({
        ...basePayload({ vehicleClass: VEHICLE_CLASS.sedan, purchaseDate: pastDateString({ yearsAgo: 1 }) }),
        raw: true,
      });
      const luxury = await helpers.createVehicle({
        ...basePayload({
          name: 'Lux',
          make: 'BMW',
          model: '7 Series',
          vehicleClass: VEHICLE_CLASS.luxury,
          purchaseDate: pastDateString({ yearsAgo: 1 }),
        }),
        raw: true,
      });

      expect(luxury.account!.currentBalance).toBeLessThan(sedan.account!.currentBalance);
    });

    it('custom flat rate is applied compounded year-over-year', async () => {
      const vehicle = await helpers.createVehicle({
        ...basePayload({
          purchasePrice: 10000,
          purchaseDate: pastDateString({ yearsAgo: 2 }),
          depreciationPreset: DEPRECIATION_PRESET.custom,
          customAnnualRatePct: 10,
        }),
        raw: true,
      });

      // 10000 * 0.9 * 0.9 = 8100 (allow small partial-year + rounding drift)
      expect(vehicle.account!.currentBalance).toBeGreaterThan(7500);
      expect(vehicle.account!.currentBalance).toBeLessThan(8200);
    });

    it('honors the salvage floor when depreciation would otherwise undercut it', async () => {
      const vehicle = await helpers.createVehicle({
        ...basePayload({
          purchasePrice: 20000,
          purchaseDate: pastDateString({ yearsAgo: 30 }),
          // 50%/yr custom rate crashes the value past the floor within a few
          // years — exercises the floor-clamping branch rather than the curve.
          depreciationPreset: DEPRECIATION_PRESET.custom,
          customAnnualRatePct: 50,
          salvageFloorPct: 30,
        }),
        raw: true,
      });

      // Floor: 20000 * 0.30 = 6000
      expect(vehicle.account!.currentBalance).toBe(6000);
    });
  });

  describe('PATCH /vehicles/:id', () => {
    it('updates currentMileage without retriggering value recompute (cache stays)', async () => {
      const vehicle = await helpers.createVehicle({ ...basePayload(), raw: true });

      const initialComputedAt = await Vehicles.findByPk(vehicle.id).then((v) => v?.valueLastComputedAt);
      expect(initialComputedAt).toBeDefined();

      const updated = await helpers.updateVehicle({
        id: vehicle.id,
        currentMileage: 65000,
        raw: true,
      });

      expect(updated.currentMileage).toBe(65000);
      // cache stamp unchanged
      const after = await Vehicles.findByPk(vehicle.id).then((v) => v?.valueLastComputedAt);
      expect(after?.getTime()).toBe(initialComputedAt?.getTime());
    });

    it('force-refreshes value when curve params change', async () => {
      const vehicle = await helpers.createVehicle({ ...basePayload(), raw: true });
      const initialBalance = vehicle.account!.currentBalance;

      const updated = await helpers.updateVehicle({
        id: vehicle.id,
        depreciationPreset: DEPRECIATION_PRESET.fast,
        raw: true,
      });

      expect(updated.account!.currentBalance).toBeLessThan(initialBalance);
    });
  });

  describe('request body validation', () => {
    it('rejects a create body that breaks a field rule, and keeps the vehicle list empty', async () => {
      const invalid: Record<string, unknown>[] = [
        { purchasePrice: 0 },
        { currencyCode: 'USD1' },
        { currencyCode: 'ZZZ' },
        { name: '' },
        { make: '' },
        { model: '' },
        { year: new Date().getFullYear() + 2 },
        { vehicleClass: 'spaceship' },
        { purchaseDate: '2024/01/15' },
        { depreciationPreset: 'turbo' },
        { customAnnualRatePct: 101 },
        { salvageFloorPct: -1 },
        { salvageFloorPct: 101 },
        { currentMileage: -1 },
        { currentMileage: 1.5 },
      ];

      for (const patch of invalid) {
        const response = await helpers.createVehicle({
          ...(basePayload() as Parameters<typeof helpers.createVehicle>[0]),
          ...patch,
          raw: false,
        });
        expect([patch, response.statusCode]).toEqual([patch, 422]);
      }

      expect(await helpers.getVehicles({ raw: true })).toEqual([]);
    });

    it('accepts a create body with every optional field, a null trim and a custom rate', async () => {
      const vehicle = await helpers.createVehicle({
        ...basePayload({
          trim: 'XSE',
          depreciationPreset: DEPRECIATION_PRESET.custom,
          customAnnualRatePct: 12.5,
          salvageFloorPct: 20,
          currentMileage: 42000,
        }),
        raw: true,
      });

      expect(vehicle.trim).toBe('XSE');
      expect(vehicle.customAnnualRatePct).toBe(12.5);
      expect(vehicle.salvageFloorPct).toBe(20);
      expect(vehicle.currentMileage).toBe(42000);
    });

    it('rejects an update body that breaks a field rule, and leaves the vehicle unchanged', async () => {
      const vehicle = await helpers.createVehicle({ ...basePayload(), raw: true });

      const invalid: Record<string, unknown>[] = [
        { name: '' },
        { make: '' },
        { year: 1800 },
        { year: new Date().getFullYear() + 2 },
        { vehicleClass: 'spaceship' },
        { depreciationPreset: 'turbo' },
        { customAnnualRatePct: -1 },
        { salvageFloorPct: 101 },
        { currentMileage: -5 },
        { depreciationPreset: DEPRECIATION_PRESET.custom },
      ];

      for (const patch of invalid) {
        const response = await helpers.updateVehicle({ id: vehicle.id, ...patch, raw: false });
        expect([patch, response.statusCode]).toEqual([patch, 422]);
      }

      const after = await helpers.getVehicleById({ id: vehicle.id, raw: true });
      expect(after.make).toBe(vehicle.make);
      expect(after.year).toBe(vehicle.year);
      expect(after.account!.name).toBe(vehicle.account!.name);
    });

    it('updates the editable fields, renames the account and clears nullable ones', async () => {
      const vehicle = await helpers.createVehicle({ ...basePayload({ trim: 'LE', currentMileage: 1000 }), raw: true });

      const updated = await helpers.updateVehicle({
        id: vehicle.id,
        name: 'Family car',
        trim: null,
        currentMileage: null,
        salvageFloorPct: 15,
        raw: true,
      });

      expect(updated.account!.name).toBe('Family car');
      expect(updated.trim).toBeNull();
      expect(updated.currentMileage).toBeNull();
      expect(updated.salvageFloorPct).toBe(15);
      expect(updated.purchasePrice).toBe(vehicle.purchasePrice);
    });
  });

  describe('Manual override via POST /accounts/:id/balance-adjustment', () => {
    it('creates a transfer_out_wallet income transaction when overriding above current value, and an expense when overriding below', async () => {
      const vehicle = await helpers.createVehicle({ ...basePayload(), raw: true });
      const previousBalance = vehicle.account!.currentBalance;
      const newValue = previousBalance + 5000;

      const response = await helpers.overrideVehicleValue({
        id: vehicle.id,
        accountId: vehicle.accountId,
        targetValue: newValue,
        note: 'Got an appraisal',
      });

      expect(response.transaction).not.toBeNull();
      expect(response.transaction!.transactionType).toBe(TRANSACTION_TYPES.income);
      expect(response.transaction!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.transfer_out_wallet);
      expect(response.newBalance).toBeCloseTo(newValue, 2);
      expect(response.vehicle!.valueAnchor).toBeCloseTo(newValue, 2);
      expect(response.vehicle!.valueAnchorDate).toBe(todayString());
      expect(response.vehicle!.account!.currentBalance).toBeCloseTo(newValue, 2);

      const belowResponse = await helpers.overrideVehicleValue({
        id: vehicle.id,
        accountId: vehicle.accountId,
        targetValue: response.newBalance - 1000,
      });

      expect(belowResponse.transaction!.transactionType).toBe(TRANSACTION_TYPES.expense);
    }, 30000);
  });

  describe('lazy 7-day cache', () => {
    it('keeps valueLastComputedAt on a list GET within 7 days and refreshes it once the window expires', async () => {
      // The 7-day cache applies to bulk/list reads (GET /vehicles, GET /accounts).
      // GET /vehicles/:id force-refreshes deliberately, so this test deliberately
      // uses the list endpoint to exercise the cache.
      const vehicle = await helpers.createVehicle({ ...basePayload(), raw: true });
      const first = await Vehicles.findByPk(vehicle.id).then((v) => v!.valueLastComputedAt!.getTime());

      await helpers.getVehicles({ raw: true });

      const second = await Vehicles.findByPk(vehicle.id).then((v) => v!.valueLastComputedAt!.getTime());
      expect(second).toBe(first);

      // Backdate the cache stamp to 10 days ago to simulate staleness.
      await Vehicles.update({ valueLastComputedAt: subDays(new Date(), 10) }, { where: { id: vehicle.id } });
      const stale = await Vehicles.findByPk(vehicle.id).then((v) => v!.valueLastComputedAt!.getTime());

      await helpers.getVehicles({ raw: true });

      const refreshed = await Vehicles.findByPk(vehicle.id).then((v) => v!.valueLastComputedAt!.getTime());
      expect(refreshed).toBeGreaterThan(stale);
    }, 30000);
  });

  // GET /vehicles/:id force-refreshes the depreciated value on every read and
  // stamps `valueLastComputedAt`. The base-currency lock must suppress that
  // refresh (the recalc owns the ref* amounts), so the stored value — and its
  // `valueLastComputedAt` — stay frozen until the lock clears.
  describe('lazy refresh — base-currency lock', () => {
    it('skips the force-refresh while the lock is held, then refreshes once it clears', async () => {
      const vehicle = await createVehicleAccount();

      const computedAtOnCreate = vehicle.valueLastComputedAt;
      expect(computedAtOnCreate).toBeTruthy();

      const lockKey = buildLockKey(vehicle.userId);
      await redisClient.set(lockKey, 'test-lock');

      // Locked: the detail read must NOT recompute, so `valueLastComputedAt` stays
      // exactly at creation time (a refresh would have advanced it).
      const whileLocked = await helpers.getVehicleById({ id: vehicle.id, raw: true });
      expect(whileLocked.valueLastComputedAt).toBe(computedAtOnCreate);

      await redisClient.del(lockKey);

      // Unlocked: the force-refresh runs again and advances `valueLastComputedAt`.
      const afterUnlock = await helpers.getVehicleById({ id: vehicle.id, raw: true });
      expect(afterUnlock.valueLastComputedAt).not.toBe(computedAtOnCreate);
      expect(new Date(afterUnlock.valueLastComputedAt!).getTime()).toBeGreaterThan(
        new Date(computedAtOnCreate!).getTime(),
      );
    });
  });

  describe('DELETE /vehicles/:id', () => {
    it('returns 404 for a non-existent id, and deletes the vehicle with its underlying account', async () => {
      const missing = await helpers.deleteVehicle({ id: generateRandomRecordId(), raw: false });
      expect(missing.statusCode).toBe(404);

      const vehicle = await helpers.createVehicle({ ...basePayload(), raw: true });
      await helpers.deleteVehicle({ id: vehicle.id, raw: true });

      const list = await helpers.getVehicles({ raw: true });
      expect(list.find((v) => v.id === vehicle.id)).toBeUndefined();

      const accounts = await helpers.getAccounts();
      expect(accounts.find((a) => a.id === vehicle.accountId)).toBeUndefined();
    });
  });

  describe('Household sharing', () => {
    it('lets a household recipient read the owner vehicle but not update or delete it; outsiders get 404', async () => {
      const vehicle = await createVehicleAccount();
      const { id: ownerUserId } = await helpers.getUserInfo({ raw: true });

      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      const outsider = await helpers.provisionSecondUserWithBaseCurrency();

      const invitation = await helpers.createHouseholdInvitation({
        ownerUserId,
        inviteeEmail: recipient.email,
        permission: SHARE_PERMISSIONS.write,
      });
      await helpers.asUser({
        cookies: recipient.cookies,
        fn: () => helpers.acceptShareInvitation({ token: invitation.token, raw: true }),
      });

      const stale = subDays(new Date(), 10);
      await Vehicles.update({ valueLastComputedAt: stale }, { where: { id: vehicle.id } });

      await helpers.asUser({
        cookies: recipient.cookies,
        fn: async () => {
          const list = await helpers.getVehicles({ raw: true });
          expect(list.map((v) => v.id)).toEqual([vehicle.id]);
          const refreshedAt = await Vehicles.findByPk(vehicle.id).then((v) => v!.valueLastComputedAt!.getTime());
          expect(refreshedAt).toBeGreaterThan(stale.getTime());

          const detail = await helpers.getVehicleById({ id: vehicle.id, raw: false });
          expect(detail.statusCode).toBe(200);
          expect(helpers.extractResponse(detail).accountId).toBe(vehicle.accountId);

          const patch = await helpers.updateVehicle({ id: vehicle.id, currentMileage: 1, raw: false });
          expect(patch.statusCode).toBe(404);

          const del = await helpers.deleteVehicle({ id: vehicle.id, raw: false });
          expect(del.statusCode).toBe(404);
        },
      });

      await helpers.asUser({
        cookies: outsider.cookies,
        fn: async () => {
          expect(await helpers.getVehicles({ raw: true })).toEqual([]);

          const detail = await helpers.getVehicleById({ id: vehicle.id, raw: false });
          expect(detail.statusCode).toBe(404);
        },
      });

      const ownerView = await helpers.getVehicleById({ id: vehicle.id, raw: true });
      expect(ownerView.currentMileage).toBeNull();
    });
  });

  describe('Override delete reconciliation', () => {
    it('clears the anchor back to purchase when the only override is deleted', async () => {
      // Create vehicle (no overrides yet) → anchor null. Override once → anchor
      // set. Delete that override tx → anchor must go back to null, and the
      // current balance must match the pure depreciation-curve value from purchase.
      const vehicle = await helpers.createVehicle({ ...basePayload(), raw: true });
      const baselineBalance = vehicle.account!.currentBalance;
      const purchasePrice = vehicle.purchasePrice;

      const override = await helpers.overrideVehicleValue({
        id: vehicle.id,
        accountId: vehicle.accountId,
        targetValue: baselineBalance + 4000,
      });

      expect(override.vehicle!.valueAnchor).not.toBeNull();
      expect(override.transaction).not.toBeNull();
      const overrideTxId = override.transaction!.id;

      const deleteResponse = await helpers.makeRequest({
        method: 'delete',
        url: `/transactions/${overrideTxId}`,
      });
      expect(deleteResponse.statusCode).toBe(200);

      const refreshed = await helpers.getVehicleById({ id: vehicle.id, raw: true });

      expect(refreshed.valueAnchor).toBeNull();
      expect(refreshed.valueAnchorDate).toBeNull();
      // Curve-derived value is less than purchase price (the vehicle was purchased
      // 3 years ago in basePayload). It should match the pre-override baseline
      // since no other state changed and we're back on the pure curve.
      expect(refreshed.account!.currentBalance).toBeLessThan(purchasePrice);
      expect(refreshed.account!.currentBalance).toBeCloseTo(baselineBalance, 0);
    });

    it('re-anchors to the prior override when the latest override is deleted', async () => {
      // Two overrides at distinct effective times. Delete the LATEST → anchor
      // must reconstruct to the prior override's (value, date), not zero out
      // and not stick with the deleted value.
      const vehicle = await helpers.createVehicle({ ...basePayload(), raw: true });
      const baseBalance = vehicle.account!.currentBalance;

      const olderTime = subDays(new Date(), 5);
      const olderOverride = await helpers.overrideVehicleValue({
        id: vehicle.id,
        accountId: vehicle.accountId,
        targetValue: baseBalance + 2000,
        time: olderTime,
      });
      expect(olderOverride.transaction).not.toBeNull();
      const olderAnchorValue = olderOverride.vehicle!.valueAnchor!;
      const olderAnchorDate = olderOverride.vehicle!.valueAnchorDate!;
      // Sanity: backdated override re-anchored to the older date, not today.
      expect(olderAnchorDate).toBe(format(olderTime, 'yyyy-MM-dd'));

      // Make the latest override happen now — anchor flips to today.
      const newerOverride = await helpers.overrideVehicleValue({
        id: vehicle.id,
        accountId: vehicle.accountId,
        targetValue: baseBalance + 6000,
      });
      expect(newerOverride.transaction).not.toBeNull();
      expect(newerOverride.vehicle!.valueAnchorDate).toBe(format(new Date(), 'yyyy-MM-dd'));

      const newerTxId = newerOverride.transaction!.id;
      const deleteResponse = await helpers.makeRequest({
        method: 'delete',
        url: `/transactions/${newerTxId}`,
      });
      expect(deleteResponse.statusCode).toBe(200);

      const refreshed = await helpers.getVehicleById({ id: vehicle.id, raw: true });

      // After deleting the latest override, the reconstruction should collapse
      // back to the prior override's anchor point. The value tolerance is
      // generous: reconstruct walks the curve from purchase to the prior
      // override's date and adds the signed tx amount, which can differ by a
      // few days of depreciation from the value the override recorded live
      // (which used today's account balance as its baseline).
      expect(refreshed.valueAnchor).not.toBeNull();
      expect(refreshed.valueAnchorDate).toBe(olderAnchorDate);
      // ±$200 covers a few days of curve drift on any vehicle under $100k.
      expect(Math.abs(refreshed.valueAnchor! - olderAnchorValue)).toBeLessThan(200);
      // And the reconstructed anchor must NOT equal the deleted newer override's value.
      expect(refreshed.valueAnchor!).toBeLessThan(baseBalance + 6000 - 100);
    });

    // NOTE: the "deleting a non-override tx on a vehicle account" case is no longer
    // testable — the model invariant (enforceVehicleAccountInvariant) forbids creating
    // any non-`transfer_out_wallet` transaction on a vehicle account, so the reconcile
    // hook's transferNature short-circuit can never be reached via the API. The
    // rejection itself is covered by the write guards below.

    it('does not crash when deleting a balance-adjustment override on a non-vehicle account', async () => {
      // The hook checks `accountCategory === vehicle` and short-circuits otherwise.
      // Create a regular account, do a balance adjustment (which creates a
      // transfer_out_wallet tx), then delete that tx — the AfterDestroy hook
      // must not throw or attempt to reconcile a non-existent vehicle.
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({ initialBalance: 1000 }),
        raw: true,
      });

      const adjustment = await helpers.balanceAdjustment({
        id: account.id,
        payload: { targetBalance: asDecimal(1500) },
        raw: true,
      });
      expect(adjustment.transaction).not.toBeNull();
      const adjustmentTxId = adjustment.transaction!.id;

      const deleteResponse = await helpers.makeRequest({
        method: 'delete',
        url: `/transactions/${adjustmentTxId}`,
      });

      // The reconciliation hook must short-circuit cleanly — no 500.
      expect(deleteResponse.statusCode).toBe(200);

      // And the account itself still loads (balance reverts to pre-adjustment).
      const accountAfter = await helpers.getAccount({ id: account.id, raw: true });
      expect(accountAfter).toBeDefined();
    });
  });

  describe('Vehicle account write guards', () => {
    describe('Transaction-creation invariant (model hook)', () => {
      it('rejects plain expense/income, transfers in and out, and account→portfolio transfers on a vehicle account', async () => {
        const vehicle = await createVehicleAccount();
        const normalAccount = await helpers.createAccount({ raw: true });
        const portfolio = await helpers.createPortfolio({ raw: true });

        const expense = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: vehicle.accountId,
            transactionType: TRANSACTION_TYPES.expense,
          }),
          raw: false,
        });

        expect(expense.statusCode).toBe(422);
        // Vehicle creation records no transaction, so a clean rollback leaves none.
        expect((await helpers.getTransactions({ raw: true })).length).toBe(0);

        const income = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({
            accountId: vehicle.accountId,
            transactionType: TRANSACTION_TYPES.income,
          }),
          raw: false,
        });

        expect(income.statusCode).toBe(422);
        expect((await helpers.getTransactions({ raw: true })).length).toBe(0);

        const transferIn = await helpers.createTransaction({
          payload: {
            ...helpers.buildTransactionPayload({ accountId: normalAccount.id }),
            transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
            destinationAmount: 1000,
            destinationAccountId: vehicle.accountId,
          },
          raw: false,
        });

        expect(transferIn.statusCode).toBe(422);
        // The whole transfer must roll back — the source account keeps no orphaned leg.
        expect((await helpers.getTransactions({ raw: true })).length).toBe(0);

        const transferOut = await helpers.createTransaction({
          payload: {
            ...helpers.buildTransactionPayload({ accountId: vehicle.accountId }),
            transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
            destinationAmount: 1000,
            destinationAccountId: normalAccount.id,
          },
          raw: false,
        });

        expect(transferOut.statusCode).toBe(422);
        expect((await helpers.getTransactions({ raw: true })).length).toBe(0);

        const toPortfolio = await helpers.accountToPortfolioTransfer({
          portfolioId: portfolio.id,
          payload: {
            accountId: vehicle.accountId,
            amount: '500',
            date: todayString(),
          },
          raw: false,
        });

        expect(toPortfolio.statusCode).toBe(422);
        expect((await helpers.getTransactions({ raw: true })).length).toBe(0);
      }, 30000);
    });

    describe('Transaction-update invariant (model hook @BeforeUpdate)', () => {
      it('rejects moving an existing transaction onto a vehicle account', async () => {
        const vehicle = await createVehicleAccount();
        const normalAccount = await helpers.createAccount({ raw: true });

        // A legit expense lives on a normal account...
        const [tx] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({ accountId: normalAccount.id }),
          raw: true,
        });

        // ...editing it to point at the vehicle account must trip @BeforeUpdate.
        // This is the one bypass the frontend picker-exclusion can't cover, so the
        // model hook is the only thing standing between it and a corrupted anchor.
        const response = await helpers.updateTransaction({
          id: tx.id,
          payload: { accountId: vehicle.accountId },
          raw: false,
        });

        expect(response.statusCode).toBe(422);

        // The update must roll back fully — the tx still belongs to the original
        // account, not the vehicle (no partial move).
        const txs = await helpers.getTransactions({ raw: true });
        expect(txs.length).toBe(1);
        expect(txs[0]!.accountId).toBe(normalAccount.id);
      });
    });

    describe('Generic service guards', () => {
      it('re-anchors on balance-adjustment but rejects direct currentBalance writes on a vehicle account', async () => {
        const vehicle = await createVehicleAccount();
        const before = vehicle.account!.currentBalance;

        const adjustment = await helpers.balanceAdjustment({
          id: vehicle.accountId,
          payload: { targetBalance: asDecimal(18000) },
          raw: false,
        });
        expect(adjustment.statusCode).toBe(200);

        // Same-day override re-anchors to 18000 with no elapsed depreciation, so the
        // value lands at the target and is strictly above the pre-override curve value.
        const afterAdjustment = await helpers.getVehicleById({ id: vehicle.id, raw: true });
        expect(afterAdjustment.valueAnchor).toBeCloseTo(18000, 2);
        expect(afterAdjustment.account!.currentBalance).toBeGreaterThan(before);
        expect(afterAdjustment.account!.currentBalance).toBeLessThanOrEqual(18000);
        expect(afterAdjustment.account!.currentBalance).toBeGreaterThan(17000);

        const directWrite = await helpers.makeRequest({
          method: 'put',
          url: `/accounts/${vehicle.accountId}`,
          payload: { currentBalance: 30000 },
        });

        expect(directWrite.statusCode).toBe(422);

        const afterDirectWrite = await helpers.getVehicleById({ id: vehicle.id, raw: true });
        expect(afterDirectWrite.account!.currentBalance).toBe(afterAdjustment.account!.currentBalance);
        expect(afterDirectWrite.valueAnchor).toBe(afterAdjustment.valueAnchor);
      }, 30000);

      it('rejects a negative target on a vehicle account without side effects', async () => {
        const vehicle = await createVehicleAccount();

        const adjustment = await helpers.balanceAdjustment({
          id: vehicle.accountId,
          payload: { targetBalance: asDecimal(-100) },
          raw: false,
        });
        expect(adjustment.statusCode).toBe(422);

        const txs = await helpers.getTransactions({ raw: true });
        expect(txs.length).toBe(0);
        const after = await helpers.getVehicleById({ id: vehicle.id, raw: true });
        expect(after.valueAnchor).toBe(vehicle.valueAnchor);
      });
    });

    describe('Sanctioned paths still work (positive controls)', () => {
      it('leaves income, expense and transfers on normal accounts unaffected', async () => {
        const accountA = await helpers.createAccount({ raw: true });
        const accountB = await helpers.createAccount({ raw: true });

        const expense = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({ accountId: accountA.id }),
          raw: false,
        });
        expect(expense.statusCode).toBe(200);

        const transfer = await helpers.createTransaction({
          payload: {
            ...helpers.buildTransactionPayload({ accountId: accountA.id }),
            transferNature: TRANSACTION_TRANSFER_NATURE.common_transfer,
            destinationAmount: 1000,
            destinationAccountId: accountB.id,
          },
          raw: false,
        });
        expect(transfer.statusCode).toBe(200);
      });
    });
  });
});
