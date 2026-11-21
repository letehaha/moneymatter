import type { RecordId } from '@bt/shared/types';
import { BANK_PROVIDER_TYPE } from '@bt/shared/types';
import { Money } from '@common/types/money';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';
import { useSelfHost } from '@tests/helpers/self-host';
import { FixedTransaction, MOCK_IDENTIFICATION_HASH_1 } from '@tests/mocks/enablebanking/data';

useSelfHost();

/**
 * Duplicate reconciliation is a data-deleting path that reads every row on the account.
 * A planned row records money that has not moved, so it is never a duplicate of a bank
 * row and must stay outside both reconcile passes.
 */
describe('Enable Banking reconcile and planned transactions', () => {
  const IBAN = 'FI9999999999999999';
  const BOOKING_DATE = '2024-09-10';
  const PLAN_TIME = `${BOOKING_DATE}T00:00:00.000Z`;

  const BOOKED: FixedTransaction = {
    amount: '50.00',
    currency: 'EUR',
    isExpense: true,
    bookingDate: BOOKING_DATE,
    counterpartyIban: IBAN,
    entryReference: 'planned_reconcile_canonical',
  };

  beforeEach(() => {
    helpers.enablebanking.resetSessionCounter();
  });

  afterEach(() => {
    helpers.enablebanking.resetTransactionConfig();
  });

  async function setupConnectionWithAccount(): Promise<{ connectionId: string; accountId: RecordId }> {
    const connectResult = await helpers.bankDataProviders.connectProvider({
      providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
      credentials: helpers.enablebanking.mockCredentials(),
      raw: true,
    });
    const state = await helpers.enablebanking.getConnectionState(connectResult.connectionId);
    await helpers.makeRequest({
      method: 'post',
      url: '/bank-data-providers/enablebanking/oauth-callback',
      payload: { connectionId: connectResult.connectionId, code: helpers.enablebanking.mockAuthCode, state },
    });
    const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
      connectionId: connectResult.connectionId,
      accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
      raw: true,
    });
    return { connectionId: connectResult.connectionId, accountId: syncedAccounts[0]!.id };
  }

  const syncedRow = async ({ accountId }: { accountId: RecordId }) => {
    const row = await Transactions.findOne({ where: { accountId }, order: [['time', 'ASC']] });
    if (!row) throw new Error('Expected a synced row on the account');
    return row;
  };

  /**
   * A planned row carrying the counterparty IBAN of the bank row it coincides with.
   * Written straight onto the model because `externalData` has no API surface, mirroring
   * how the neighbouring reconcile suite seeds the population reconcile exists to clean.
   * Every scalar is cloned from the synced row so the pair lands in the same bucket and
   * clears every conflict gate — leaving `isPlanned` as the only reason to refuse deletion.
   */
  const insertPlannedOrphan = async ({ accountId }: { accountId: RecordId }) => {
    const reference = await syncedRow({ accountId });

    return Transactions.create({
      amount: Money.fromCents(reference.amount.toCents()),
      refAmount: Money.fromCents(reference.refAmount.toCents()),
      commissionRate: Money.zero(),
      refCommissionRate: Money.zero(),
      cashbackAmount: Money.zero(),
      accountId,
      userId: reference.userId,
      categoryId: reference.categoryId,
      note: null,
      time: reference.time,
      transactionType: reference.transactionType,
      paymentType: reference.paymentType,
      transferNature: reference.transferNature,
      accountType: reference.accountType,
      currencyCode: reference.currencyCode,
      refCurrencyCode: reference.refCurrencyCode,
      externalData: { creditorAccount: IBAN },
      isPlanned: true,
    });
  };

  it('leaves a plan that coincides with a synced row out of every reconcile pass', async () => {
    helpers.enablebanking.setFixedTransactions([BOOKED]);
    const { connectionId, accountId } = await setupConnectionWithAccount();

    const [plan] = await helpers.createPlannedTransaction({
      payload: { accountId, amount: 50, time: PLAN_TIME, note: 'Season ticket' },
      raw: true,
    });

    const result = await helpers.bankDataProviders.reconcileDuplicates({ connectionId, accountId, raw: true });

    expect(result.mergedCount).toBe(0);
    expect(result.skippedCount).toBe(0);
    // Planned rows never reach a bucket, so they can neither pair off nor be rejected.
    expect(result.consideredPairs).toBe(0);
    expect(result.unresolvedCount).toBe(0);

    const survivor = await helpers.getTransactionById({ id: plan.id, raw: true });
    expect(survivor).not.toBeNull();
    expect(survivor!.isPlanned).toBe(true);
    expect(survivor!.note).toBe('Season ticket');
  });

  it('refuses to destroy a plan that matches a booked row on amount, date and counterparty', async () => {
    helpers.enablebanking.setFixedTransactions([BOOKED]);
    const { connectionId, accountId } = await setupConnectionWithAccount();

    const canonical = await syncedRow({ accountId });
    const plan = await insertPlannedOrphan({ accountId });

    const result = await helpers.bankDataProviders.reconcileDuplicates({ connectionId, accountId, raw: true });

    expect(result.mergedCount).toBe(0);

    const survivor = await Transactions.findByPk(plan.id);
    expect(survivor).not.toBeNull();
    expect(survivor!.isPlanned).toBe(true);
    expect(await Transactions.findByPk(canonical.id)).not.toBeNull();
  });

  it('still reconciles a real duplicate while a plan sits in the same bucket', async () => {
    helpers.enablebanking.setFixedTransactions([BOOKED]);
    const { connectionId, accountId } = await setupConnectionWithAccount();

    const canonical = await syncedRow({ accountId });
    const [plan] = await helpers.createPlannedTransaction({
      payload: { accountId, amount: 50, time: PLAN_TIME, note: 'Season ticket' },
      raw: true,
    });
    const realOrphan = await Transactions.create({
      amount: Money.fromCents(canonical.amount.toCents()),
      refAmount: Money.fromCents(canonical.refAmount.toCents()),
      commissionRate: Money.zero(),
      refCommissionRate: Money.zero(),
      cashbackAmount: Money.zero(),
      accountId,
      userId: canonical.userId,
      categoryId: canonical.categoryId,
      note: null,
      time: canonical.time,
      transactionType: canonical.transactionType,
      paymentType: canonical.paymentType,
      transferNature: canonical.transferNature,
      accountType: canonical.accountType,
      currencyCode: canonical.currencyCode,
      refCurrencyCode: canonical.refCurrencyCode,
      externalData: { creditorAccount: IBAN },
    });

    const result = await helpers.bankDataProviders.reconcileDuplicates({ connectionId, accountId, raw: true });

    expect(result.mergedCount).toBe(1);
    expect(await Transactions.findByPk(realOrphan.id)).toBeNull();
    expect(await Transactions.findByPk(plan.id)).not.toBeNull();
    expect(await Transactions.findByPk(canonical.id)).not.toBeNull();
  });
});
