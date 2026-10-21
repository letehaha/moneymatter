import type { RecordId } from '@bt/shared/types';
import {
  ACCOUNT_TYPES,
  BANK_PROVIDER_TYPE,
  PAYMENT_TYPES,
  TRANSACTION_TRANSFER_NATURE,
  TRANSACTION_TYPES,
} from '@bt/shared/types';
import { Money } from '@common/types/money';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import Transactions from '@models/transactions.model';
import * as helpers from '@tests/helpers';
import { useSelfHost } from '@tests/helpers/self-host';
import { FixedTransaction, MOCK_IDENTIFICATION_HASH_1 } from '@tests/mocks/enablebanking/data';

import { ReferenceNumberScheme } from './types';

useSelfHost();

/**
 * E2E tests for the Enable Banking transaction dedup improvements.
 *
 * Background: Enable Banking re-sends historical transactions on every sync.
 * Hash-based duplicate detection breaks when fields used in the hash mutate
 * across syncs (entry_reference appearing later, transaction_date being added,
 * etc.). These tests pin down the contract for four improvements:
 *
 *  1. Lookup by entry_reference: when a tx initially has no entry_reference
 *     and the bank populates it later, the existing row is matched (not duped)
 *     and its originalId is re-anchored to the canonical hash.
 *
 *  3. Window fuzzy match: when no entry_reference is ever returned and the
 *     selected date shifts between syncs (e.g. transaction_date appears later
 *     and outranks booking_date), a ±2-day fingerprint match prevents dupes.
 *
 *  4. Reconciliation: an explicit endpoint cleans up duplicate pairs that
 *     already exist in the DB from before #1 was deployed.
 *
 *  5. Pending upgrade: a card purchase first arrives as PDNG and is re-issued
 *     as BOOK with a fresh entry_reference and different text, so the stored
 *     pending row is upgraded in place instead of gaining a booked twin.
 */
describe('Enable Banking dedup improvements (E2E)', () => {
  beforeEach(async () => {
    helpers.enablebanking.resetSessionCounter();
    await helpers.patchUserSettings({ patch: { importPendingBankTransactions: true }, raw: true });
  });

  afterEach(() => {
    helpers.enablebanking.resetTransactionConfig();
  });

  /**
   * Set up an active connection with one synced account.
   * Caller is expected to have already configured fixed transactions
   * (or accept the default auto-generated set).
   */
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
      payload: {
        connectionId: connectResult.connectionId,
        code: helpers.enablebanking.mockAuthCode,
        state,
      },
    });
    const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
      connectionId: connectResult.connectionId,
      accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
      raw: true,
    });
    return {
      connectionId: connectResult.connectionId,
      accountId: syncedAccounts[0]!.id,
    };
  }

  function listTransactions({ accountId }: { accountId: RecordId }) {
    return helpers.getTransactions({ accountIds: [accountId], raw: true });
  }

  /** externalData isn't exposed via the API — read it directly from the DB. */
  async function readExternalData({ id }: { id: RecordId }) {
    const row = await Transactions.findByPk(id);
    return (row!.externalData ?? {}) as {
      entryReference?: string | null;
      rawTransaction?: { status?: string };
    };
  }

  /** Reconcile gates on category equality, so several tests need a second category. */
  async function findCategoryOtherThan({ categoryId }: { categoryId: RecordId }): Promise<RecordId> {
    const categories = (await helpers.getCategoriesList()) as { id: RecordId }[];
    const other = categories.find((c) => c.id !== categoryId);
    if (!other) throw new Error('Expected the test user to have more than one category');
    return other.id;
  }

  /**
   * Writes a real (non-planned) row straight onto the model, which is the population
   * reconcile exists to clean up: the transactions API refuses hand-typed rows on a
   * bank-connected account, but every importer passes `accountType: system` without
   * checking the target, so imported rows still land here — as do rows predating the
   * rule. `accountType: system` is what makes the balance hooks move `currentBalance`,
   * matching what those importers produce.
   *
   * Currency and FX mirror an already-synced row on the account so the seeded row
   * converts to the base currency exactly like the row it duplicates.
   */
  async function insertRealRow({
    accountId,
    amount,
    time,
    categoryId,
    note,
    externalData,
  }: {
    accountId: RecordId;
    amount: number;
    time: string;
    categoryId?: RecordId;
    note?: string;
    externalData?: Record<string, unknown>;
  }) {
    const reference = await Transactions.findOne({ where: { accountId }, order: [['time', 'ASC']] });
    if (!reference) throw new Error('Expected a synced row on the account to mirror currency and FX from');

    return Transactions.create({
      amount: Money.fromDecimal(amount),
      refAmount: reference.refAmount!.multiply(amount).divide(reference.amount.toNumber()),
      commissionRate: Money.zero(),
      refCommissionRate: Money.zero(),
      cashbackAmount: Money.zero(),
      accountId,
      userId: reference.userId,
      categoryId: categoryId ?? reference.categoryId,
      note: note ?? null,
      time: new Date(time),
      transactionType: TRANSACTION_TYPES.expense,
      paymentType: PAYMENT_TYPES.bankTransfer,
      transferNature: TRANSACTION_TRANSFER_NATURE.not_transfer,
      accountType: ACCOUNT_TYPES.system,
      currencyCode: reference.currencyCode,
      refCurrencyCode: reference.refCurrencyCode,
      externalData: externalData ?? null,
    });
  }

  // ==========================================================================
  // #1 — Lookup by entry_reference when it appears in a later sync
  // ==========================================================================
  describe('#1 entry_reference appears in later sync', () => {
    it('does not duplicate a tx when entry_reference is populated on a later sync', async () => {
      const sharedAttributes: FixedTransaction = {
        amount: '42.50',
        currency: 'EUR',
        isExpense: true,
        bookingDate: '2024-03-15',
        valueDate: '2024-03-15',
        counterpartyIban: 'FI1111111111111111',
        remittanceInformation: ['Coffee shop purchase'],
      };

      // Sync 1: tx WITHOUT entry_reference (uses fallback hash)
      helpers.enablebanking.setFixedTransactions([{ ...sharedAttributes }]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const txAfterFirstSync = await listTransactions({ accountId });
      expect(txAfterFirstSync.length).toBe(1);
      const initialTx = txAfterFirstSync[0]!;
      expect((await readExternalData({ id: initialTx.id })).entryReference ?? null).toBeNull();
      const initialOriginalId = initialTx.originalId;

      // Sync 2: same logical tx, now WITH entry_reference (uses canonical hash)
      helpers.enablebanking.setFixedTransactions([{ ...sharedAttributes, entryReference: 'ref_appeared_later_001' }]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const txAfterSecondSync = await listTransactions({ accountId });
      expect(txAfterSecondSync.length).toBe(1);
      // Same DB row — not a duplicate
      expect(txAfterSecondSync[0]!.id).toBe(initialTx.id);
      expect((await readExternalData({ id: txAfterSecondSync[0]!.id })).entryReference).toBe('ref_appeared_later_001');
      // originalId is re-anchored to canonical entry_reference hash
      expect(txAfterSecondSync[0]!.originalId).not.toBe(initialOriginalId);
    });

    it('remains idempotent across many subsequent syncs once entry_reference is anchored', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '10.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-04-02',
          counterpartyIban: 'FI3333333333333333',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      // Now bank populates entry_reference and we run sync many times
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '10.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-04-02',
          counterpartyIban: 'FI3333333333333333',
          entryReference: 'stable_ref_xyz',
        },
      ]);

      for (let i = 0; i < 4; i++) {
        await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });
        const txs = await listTransactions({ accountId });
        expect(txs.length).toBe(1);
      }
    });

    it('does not collapse two genuinely different txs that share an account but have different entry_references', async () => {
      // Two distinct transactions, both with entry_reference, on the same day
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '5.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-05-10',
          counterpartyIban: 'FI4444444444444444',
          entryReference: 'distinct_a',
        },
        {
          amount: '5.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-05-10',
          counterpartyIban: 'FI4444444444444444',
          entryReference: 'distinct_b',
        },
      ]);
      const { accountId } = await setupConnectionWithAccount();

      const txs = await listTransactions({ accountId });
      expect(txs.length).toBe(2);
    });
  });

  // ==========================================================================
  // #3 — Window fuzzy match (no entry_reference, date shifts)
  // ==========================================================================
  describe('#3 window-based fuzzy match', () => {
    it('does not duplicate when transaction_date appears later and shifts the date used in the hash', async () => {
      // Sync 1: only booking_date, no entry_reference
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '99.99',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-06-20',
          counterpartyIban: 'FI5555555555555555',
          remittanceInformation: ['Service fee'],
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      const txAfterFirstSync = await listTransactions({ accountId });
      expect(txAfterFirstSync.length).toBe(1);

      // Sync 2: transaction_date now also populated (a different date ~1 day earlier).
      // Under the priority-based date selection, this would change the hash and
      // create a duplicate without the fuzzy fallback.
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '99.99',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-06-20',
          transactionDate: '2024-06-19',
          counterpartyIban: 'FI5555555555555555',
          remittanceInformation: ['Service fee'],
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const txAfterSecondSync = await listTransactions({ accountId });
      expect(txAfterSecondSync.length).toBe(1);
    });

    it('still creates a new transaction when the candidate is outside the ±2 day window', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '12.34',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-07-01',
          counterpartyIban: 'FI6666666666666666',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      expect((await listTransactions({ accountId })).length).toBe(1);

      // A genuinely different transaction with the same amount/counterparty
      // but more than two weeks away — must NOT be matched by the fuzzy fallback.
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '12.34',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-07-01',
          counterpartyIban: 'FI6666666666666666',
        },
        {
          amount: '12.34',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-07-20',
          counterpartyIban: 'FI6666666666666666',
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const txs = await listTransactions({ accountId });
      expect(txs.length).toBe(2);
    });

    it('does not match when counterparty IBAN differs (avoids over-collapsing recurring same-amount payments to different parties)', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '5.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-08-01',
          counterpartyIban: 'FI7777777777777777',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      // Same amount and date but different counterparty — should be a separate tx.
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '5.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-08-01',
          counterpartyIban: 'FI7777777777777777',
        },
        {
          amount: '5.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-08-01',
          counterpartyIban: 'FI8888888888888888',
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const txs = await listTransactions({ accountId });
      expect(txs.length).toBe(2);
    });
  });

  // ==========================================================================
  // #4 — One-time reconciliation of pre-existing duplicates
  // ==========================================================================
  describe('#4 reconciliation of existing duplicates', () => {
    /**
     * A plain expense duplicating the synced row, carrying the counterparty IBAN
     * that reconcile's gate reads. Its category mirrors the synced row so reconcile
     * sees an unedited duplicate.
     */
    async function insertManualOrphan({
      accountId,
      amount,
      time,
      counterpartyIban,
    }: {
      accountId: RecordId;
      amount: number;
      time: string;
      counterpartyIban?: string;
    }) {
      return insertRealRow({
        accountId,
        amount,
        time,
        externalData: counterpartyIban ? { creditorAccount: counterpartyIban } : undefined,
      });
    }

    it('merges a duplicate pair where one has entry_reference and the other does not', async () => {
      // Step 1: bank-synced canonical tx (with entry_reference)
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '50.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-09-10',
          counterpartyIban: 'FI9999999999999999',
          entryReference: 'canonical_ref_001',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const txsAfterSync = await listTransactions({ accountId });
      expect(txsAfterSync.length).toBe(1);
      const canonicalTx = txsAfterSync[0]!;
      expect((await readExternalData({ id: canonicalTx.id })).entryReference).toBe('canonical_ref_001');

      // Step 2: an orphan with the same fingerprint and IBAN but no entry_reference.
      const orphan = await insertManualOrphan({
        accountId,
        amount: 50.0,
        time: new Date('2024-09-10').toISOString(),
        counterpartyIban: 'FI9999999999999999',
      });
      expect((await listTransactions({ accountId })).length).toBe(2);

      // Step 3: trigger reconciliation
      const reconcileResult = await helpers.bankDataProviders.reconcileDuplicates({
        connectionId,
        accountId,
        raw: true,
      });

      expect(reconcileResult.mergedCount).toBe(1);
      expect(reconcileResult.skippedCount).toBe(0);

      // Step 4: only the canonical row remains
      const finalTxs = await listTransactions({ accountId });
      expect(finalTxs.length).toBe(1);
      expect(finalTxs[0]!.id).toBe(canonicalTx.id);
      expect(finalTxs.find((t: { id: string }) => t.id === orphan.id)).toBeUndefined();
    });

    it('does not merge orphans that have child relations (tags) — preserves user data', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '75.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-10-05',
          counterpartyIban: 'FI1010101010101010',
          entryReference: 'canonical_ref_002',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      const orphan = await insertManualOrphan({
        accountId,
        amount: 75.0,
        time: new Date('2024-10-05').toISOString(),
        counterpartyIban: 'FI1010101010101010',
      });

      // Attach a tag to the orphan — this makes it unsafe to delete
      const tag = await helpers.createTag({
        payload: { name: `protect-${Date.now()}`, color: '#3b82f6' },
        raw: true,
      });
      await helpers.addTransactionsToTag({
        tagId: tag.id,
        transactionIds: [orphan.id],
      });

      const reconcileResult = await helpers.bankDataProviders.reconcileDuplicates({
        connectionId,
        accountId,
        raw: true,
      });

      expect(reconcileResult.mergedCount).toBe(0);
      expect(reconcileResult.skippedCount).toBe(1);

      const finalTxs = await listTransactions({ accountId });
      expect(finalTxs.length).toBe(2); // orphan was preserved
    });

    it('is idempotent — running reconciliation twice has no extra effect', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '11.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-11-01',
          counterpartyIban: 'FI2020202020202020',
          entryReference: 'idem_ref',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      await insertManualOrphan({
        accountId,
        amount: 11.0,
        time: new Date('2024-11-01').toISOString(),
        counterpartyIban: 'FI2020202020202020',
      });

      const r1 = await helpers.bankDataProviders.reconcileDuplicates({ connectionId, accountId, raw: true });
      expect(r1.mergedCount).toBe(1);

      const r2 = await helpers.bankDataProviders.reconcileDuplicates({ connectionId, accountId, raw: true });
      expect(r2.mergedCount).toBe(0);
      expect(r2.skippedCount).toBe(0);

      const finalTxs = await listTransactions({ accountId });
      expect(finalTxs.length).toBe(1);
    });

    it('does not merge an orphan that has no counterparty IBAN — manual entries are not auto-collapsed', async () => {
      // Bank-synced canonical with IBAN
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '20.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-12-01',
          counterpartyIban: 'FI3030303030303030',
          entryReference: 'no_iban_canonical',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      // Orphan with no IBAN — could be an unrelated manual cash expense that
      // happens to share amount/currency/type. Must not be merged.
      await insertManualOrphan({
        accountId,
        amount: 20.0,
        time: new Date('2024-12-01').toISOString(),
      });

      const result = await helpers.bankDataProviders.reconcileDuplicates({ connectionId, accountId, raw: true });

      expect(result.mergedCount).toBe(0);
      // The IBAN gate short-circuits before the safety check, so the orphan
      // is not even counted as a candidate — it is simply ignored.
      expect(result.skippedCount).toBe(0);
      expect((await listTransactions({ accountId })).length).toBe(2);
    });

    it('does not merge an orphan whose counterparty IBAN differs from the canonical', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '30.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-12-05',
          counterpartyIban: 'FI4040404040404040',
          entryReference: 'diff_iban_canonical',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      await insertManualOrphan({
        accountId,
        amount: 30.0,
        time: new Date('2024-12-05').toISOString(),
        counterpartyIban: 'FI5050505050505050',
      });

      const result = await helpers.bankDataProviders.reconcileDuplicates({ connectionId, accountId, raw: true });

      expect(result.mergedCount).toBe(0);
      expect(result.skippedCount).toBe(0);
      expect((await listTransactions({ accountId })).length).toBe(2);
    });

    it('does not merge an orphan whose user-edited note diverges from the canonical', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '60.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-12-10',
          counterpartyIban: 'FI6060606060606060',
          entryReference: 'note_canonical',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const orphan = await insertManualOrphan({
        accountId,
        amount: 60.0,
        time: new Date('2024-12-10').toISOString(),
        counterpartyIban: 'FI6060606060606060',
      });
      // User annotated the orphan — destroying it would silently lose the note.
      await helpers.updateTransaction({
        id: orphan.id,
        payload: { note: 'Coffee with Tom' },
      });

      const result = await helpers.bankDataProviders.reconcileDuplicates({ connectionId, accountId, raw: true });

      expect(result.mergedCount).toBe(0);
      expect(result.skippedCount).toBe(1);
      expect((await listTransactions({ accountId })).length).toBe(2);
    });

    it('does not merge an orphan whose user-edited categoryId diverges from the canonical', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '70.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-12-15',
          counterpartyIban: 'FI7070707070707070',
          entryReference: 'cat_canonical',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const canonicalRows = await listTransactions({ accountId });
      const otherCategoryId = await findCategoryOtherThan({ categoryId: canonicalRows[0]!.categoryId });

      const orphan = await insertManualOrphan({
        accountId,
        amount: 70.0,
        time: new Date('2024-12-15').toISOString(),
        counterpartyIban: 'FI7070707070707070',
      });
      await helpers.updateTransaction({
        id: orphan.id,
        payload: { categoryId: otherCategoryId },
      });

      const result = await helpers.bankDataProviders.reconcileDuplicates({ connectionId, accountId, raw: true });

      expect(result.mergedCount).toBe(0);
      expect(result.skippedCount).toBe(1);
      expect((await listTransactions({ accountId })).length).toBe(2);
    });
  });

  // ==========================================================================
  // #5 — pending (PDNG) rows upgraded in place by their booked re-issue
  // ==========================================================================
  describe('#5 pending → booked', () => {
    /** Card purchases carry no counterparty IBAN, so the pending tier is their only match path. */
    const CARD_PENDING = { currency: 'EUR', isExpense: true, counterpartyIban: null, status: 'PDNG' } as const;
    const CARD_BOOKED = { currency: 'EUR', isExpense: true, counterpartyIban: null, status: 'BOOK' } as const;

    /**
     * Fabricates a pending row sitting next to its already-booked twin. Live sync
     * prevents that shape, so it has to be built by hand — and it is exactly the
     * pollution reconcile exists to clean up.
     */
    async function insertPendingOrphan({
      accountId,
      amount,
      time,
      categoryId,
      remittanceInformation,
      note,
      counterpartyIban,
      entryReference,
    }: {
      accountId: RecordId;
      amount: number;
      time: string;
      categoryId: RecordId;
      remittanceInformation: string[];
      note?: string;
      counterpartyIban?: string;
      entryReference?: string;
    }) {
      return insertRealRow({
        accountId,
        amount,
        time,
        categoryId,
        note: note ?? remittanceInformation.join(' '),
        externalData: {
          isExpense: true,
          ...(counterpartyIban ? { creditorAccount: counterpartyIban } : {}),
          ...(entryReference ? { entryReference } : {}),
          rawTransaction: { status: 'PDNG', remittance_information: remittanceInformation },
        },
      });
    }

    it('upgrades the stored pending row in place when the bank re-issues it as booked', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_PENDING,
          amount: '18.40',
          transactionDate: '2025-01-10',
          remittanceInformation: ['CARD PURCHASE PENDING'],
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const afterPendingSync = await listTransactions({ accountId });
      expect(afterPendingSync.length).toBe(1);
      const pendingTx = afterPendingSync[0]!;
      expect((await readExternalData({ id: pendingTx.id })).rawTransaction?.status).toBe('PDNG');

      // The user categorizes and annotates the row days before the bank books it.
      const userCategoryId = await findCategoryOtherThan({ categoryId: pendingTx.categoryId });
      await helpers.updateTransaction({
        id: pendingTx.id,
        payload: { note: 'Lunch with Ann', categoryId: userCategoryId },
      });

      // Booked re-issue: fresh entry_reference, different text, and no
      // transaction_date so the date jumps to booking_date three days later.
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_BOOKED,
          amount: '18.40',
          bookingDate: '2025-01-13',
          remittanceInformation: ['CARD PURCHASE COFFEE HOUSE'],
          entryReference: 'booked_ref_001',
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const afterBookedSync = await listTransactions({ accountId });
      expect(afterBookedSync.length).toBe(1);
      const upgraded = afterBookedSync[0]!;
      expect(upgraded.id).toBe(pendingTx.id);
      expect(upgraded.note).toBe('Lunch with Ann');
      expect(upgraded.categoryId).toBe(userCategoryId);
      expect(upgraded.originalId).not.toBe(pendingTx.originalId);
      // The pending row sat on transaction_date; booking_date appearing must move it.
      expect(new Date(upgraded.time).toISOString().slice(0, 10)).toBe('2025-01-13');
      expect(new Date(upgraded.time).getTime()).not.toBe(new Date(pendingTx.time).getTime());

      const externalData = await readExternalData({ id: upgraded.id });
      expect(externalData.rawTransaction?.status).toBe('BOOK');
      expect(externalData.entryReference).toBe('booked_ref_001');
    });

    it('upgrades a pending row carrying an entry_reference when its booked copy arrives under a different reference', async () => {
      // Some ASPSPs stamp different entry_references on the pending
      // authorisation and its booked copy: tier 1 and the reference-derived
      // hash both miss, so the pending tier is the only path left.
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_PENDING,
          amount: '647.31',
          transactionDate: '2025-03-02',
          remittanceInformation: ['LIDL254STHLMAKALLA STOCKHOLM'],
          entryReference: 'pending_ref_647',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const afterPendingSync = await listTransactions({ accountId });
      expect(afterPendingSync.length).toBe(1);
      const pendingTx = afterPendingSync[0]!;
      expect((await readExternalData({ id: pendingTx.id })).rawTransaction?.status).toBe('PDNG');
      expect((await readExternalData({ id: pendingTx.id })).entryReference).toBe('pending_ref_647');

      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_BOOKED,
          amount: '647.31',
          bookingDate: '2025-03-03',
          remittanceInformation: ['LIDL254STHLMAKALLA K5529 Kortköp/uttag'],
          entryReference: 'booked_ref_647',
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const afterBookedSync = await listTransactions({ accountId });
      expect(afterBookedSync.length).toBe(1);
      const upgraded = afterBookedSync[0]!;
      expect(upgraded.id).toBe(pendingTx.id);

      const externalData = await readExternalData({ id: upgraded.id });
      expect(externalData.rawTransaction?.status).toBe('BOOK');
      expect(externalData.entryReference).toBe('booked_ref_647');
    });

    it('does not let a reference-less booked copy consume a pending row that carries an entry_reference', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_PENDING,
          amount: '77.15',
          transactionDate: '2025-04-10',
          remittanceInformation: ['PENDING WITH REFERENCE'],
          entryReference: 'pending_ref_X',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const afterPendingSync = await listTransactions({ accountId });
      expect(afterPendingSync.length).toBe(1);
      const pendingTx = afterPendingSync[0]!;
      expect((await readExternalData({ id: pendingTx.id })).entryReference).toBe('pending_ref_X');

      // No entry_reference on the incoming payload means tier 1 never ran, so the
      // stored reference was never compared. Consuming the row would be a guess.
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_BOOKED,
          amount: '77.15',
          bookingDate: '2025-04-11',
          remittanceInformation: ['BOOKED WITHOUT REFERENCE'],
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const finalRows = await listTransactions({ accountId });
      expect(finalRows.length).toBe(2);
      const stillPending = await readExternalData({ id: pendingTx.id });
      expect(stillPending.rawTransaction?.status).toBe('PDNG');
      expect(stillPending.entryReference).toBe('pending_ref_X');
    });

    it('pairs a booked re-issue with its nearest pending row, not the first candidate', async () => {
      helpers.enablebanking.setFixedTransactions([
        { ...CARD_PENDING, amount: '25.00', transactionDate: '2025-02-03', remittanceInformation: ['PENDING EARLY'] },
        { ...CARD_PENDING, amount: '25.00', transactionDate: '2025-02-05', remittanceInformation: ['PENDING LATE'] },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const pendingRows = await listTransactions({ accountId });
      expect(pendingRows.length).toBe(2);
      const pendingEarly = pendingRows.find((t) => t.note === 'PENDING EARLY')!;
      const pendingLate = pendingRows.find((t) => t.note === 'PENDING LATE')!;
      expect(pendingEarly).toBeDefined();
      expect(pendingLate).toBeDefined();

      // A single booked re-issue, one day from the later pending row and three
      // from the earlier one. Taking the first candidate would pick the wrong row.
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_BOOKED,
          amount: '25.00',
          bookingDate: '2025-02-06',
          entryReference: 'booked_late',
          remittanceInformation: ['BOOKED LATE'],
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const afterFirstBooked = await listTransactions({ accountId });
      expect(afterFirstBooked.length).toBe(2);
      const upgradedLate = await readExternalData({ id: pendingLate.id });
      expect(upgradedLate.rawTransaction?.status).toBe('BOOK');
      expect(upgradedLate.entryReference).toBe('booked_late');
      expect(afterFirstBooked.find((t) => t.id === pendingLate.id)!.note).toBe('BOOKED LATE');

      const untouchedEarly = await readExternalData({ id: pendingEarly.id });
      expect(untouchedEarly.rawTransaction?.status).toBe('PDNG');
      expect(untouchedEarly.entryReference ?? null).toBeNull();

      // The earlier pending row is only consumed once its own booked copy lands.
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_BOOKED,
          amount: '25.00',
          bookingDate: '2025-02-03',
          entryReference: 'booked_early',
          remittanceInformation: ['BOOKED EARLY'],
        },
        {
          ...CARD_BOOKED,
          amount: '25.00',
          bookingDate: '2025-02-06',
          entryReference: 'booked_late',
          remittanceInformation: ['BOOKED LATE'],
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const finalRows = await listTransactions({ accountId });
      expect(finalRows.length).toBe(2);
      const upgradedEarly = await readExternalData({ id: pendingEarly.id });
      expect(upgradedEarly.rawTransaction?.status).toBe('BOOK');
      expect(upgradedEarly.entryReference).toBe('booked_early');
    });

    it('collapses a pending and a booked copy that arrive in the same batch', async () => {
      // The booked copy is listed first: the sync has to process the pending one
      // ahead of it, or the pending copy lands as a second row.
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_BOOKED,
          amount: '14.20',
          bookingDate: '2025-09-02',
          remittanceInformation: ['SAME BATCH BOOKED'],
          entryReference: 'same_batch_ref',
        },
        {
          ...CARD_PENDING,
          amount: '14.20',
          transactionDate: '2025-09-02',
          remittanceInformation: ['SAME BATCH PENDING'],
        },
      ]);
      const { accountId } = await setupConnectionWithAccount();

      const rows = await listTransactions({ accountId });
      expect(rows.length).toBe(1);
      expect(rows[0]!.note).toBe('SAME BATCH BOOKED');
      const externalData = await readExternalData({ id: rows[0]!.id });
      expect(externalData.rawTransaction?.status).toBe('BOOK');
      expect(externalData.entryReference).toBe('same_batch_ref');
    });

    it('ignores a pending payload the bank keeps re-sending after the row was booked', async () => {
      const pendingPayload: FixedTransaction = {
        ...CARD_PENDING,
        amount: '21.00',
        transactionDate: '2025-10-05',
        remittanceInformation: ['RESENT PENDING'],
      };
      helpers.enablebanking.setFixedTransactions([pendingPayload]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const afterPendingSync = await listTransactions({ accountId });
      expect(afterPendingSync.length).toBe(1);
      const pendingTx = afterPendingSync[0]!;

      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_BOOKED,
          amount: '21.00',
          bookingDate: '2025-10-06',
          remittanceInformation: ['RESENT BOOKED'],
          entryReference: 'resent_booked_ref',
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });
      expect((await listTransactions({ accountId })).length).toBe(1);

      // Banks keep serving the pending copy for days after booking it. It must
      // resolve back to the upgraded row instead of re-creating the pending one.
      helpers.enablebanking.setFixedTransactions([pendingPayload]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const finalRows = await listTransactions({ accountId });
      expect(finalRows.length).toBe(1);
      expect(finalRows[0]!.id).toBe(pendingTx.id);
      expect(finalRows[0]!.note).toBe('RESENT BOOKED');
      const externalData = await readExternalData({ id: pendingTx.id });
      expect(externalData.rawTransaction?.status).toBe('BOOK');
      expect(externalData.entryReference).toBe('resent_booked_ref');
    });

    it('lets a booked transfer carrying a counterparty IBAN adopt an IBAN-less pending row when no IBAN-matching one exists', async () => {
      // Issue #643, pair 1: the ASPSP omits the creditor IBAN on the pending payload
      // and only fills it in at booking, while stamping a fresh entry_reference.
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_PENDING,
          amount: '3000.00',
          transactionDate: '2025-03-03',
          remittanceInformation: ['TRANSFER PENDING'],
          entryReference: '2025-03-01-21.09.41.987193',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const afterPendingSync = await listTransactions({ accountId });
      expect(afterPendingSync.length).toBe(1);
      const pendingTx = afterPendingSync[0]!;

      helpers.enablebanking.setFixedTransactions([
        {
          amount: '3000.00',
          currency: 'EUR',
          isExpense: true,
          status: 'BOOK',
          bookingDate: '2025-03-03',
          counterpartyIban: 'DE89370400440532013000',
          entryReference: '2025-03-03-09.17.04.263432',
          remittanceInformation: ['TRANSFER BOOKED'],
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const finalRows = await listTransactions({ accountId });
      expect(finalRows.length).toBe(1);
      expect(finalRows[0]!.id).toBe(pendingTx.id);
      const externalData = await readExternalData({ id: pendingTx.id });
      expect(externalData.rawTransaction?.status).toBe('BOOK');
      expect(externalData.entryReference).toBe('2025-03-03-09.17.04.263432');
    });

    it('does not let a booked transfer adopt an IBAN-less pending row dated more than five days earlier', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_PENDING,
          amount: '64.00',
          transactionDate: '2025-03-01',
          remittanceInformation: ['CARD PURCHASE PENDING'],
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      const pendingTx = (await listTransactions({ accountId }))[0]!;

      helpers.enablebanking.setFixedTransactions([
        {
          amount: '64.00',
          currency: 'EUR',
          isExpense: true,
          status: 'BOOK',
          bookingDate: '2025-03-07',
          counterpartyIban: 'FI1414141414141414',
          entryReference: 'sepa_late_ref',
          remittanceInformation: ['SEPA TRANSFER BOOKED'],
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      expect((await listTransactions({ accountId })).length).toBe(2);
      expect((await readExternalData({ id: pendingTx.id })).rawTransaction?.status).toBe('PDNG');
    });

    it('prefers a pending row carrying the booked copy IBAN over an IBAN-less one', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_PENDING,
          amount: '31.00',
          transactionDate: '2025-03-03',
          remittanceInformation: ['CARD PURCHASE PENDING'],
        },
        {
          amount: '31.00',
          currency: 'EUR',
          isExpense: true,
          status: 'PDNG',
          transactionDate: '2025-03-02',
          counterpartyIban: 'FI1212121212121212',
          remittanceInformation: ['SEPA TRANSFER PENDING'],
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const afterPendingSync = await listTransactions({ accountId });
      expect(afterPendingSync.length).toBe(2);
      const cardPending = afterPendingSync.find((t) => t.note?.includes('CARD'))!;
      const sepaPending = afterPendingSync.find((t) => t.note?.includes('SEPA'))!;

      // The card pending is nearer by date; the IBAN match must still win.
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '31.00',
          currency: 'EUR',
          isExpense: true,
          status: 'BOOK',
          bookingDate: '2025-03-04',
          counterpartyIban: 'FI1212121212121212',
          entryReference: 'sepa_booked_ref',
          remittanceInformation: ['SEPA TRANSFER BOOKED'],
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const finalRows = await listTransactions({ accountId });
      expect(finalRows.length).toBe(2);
      expect((await readExternalData({ id: sepaPending.id })).rawTransaction?.status).toBe('BOOK');
      expect((await readExternalData({ id: cardPending.id })).rawTransaction?.status).toBe('PDNG');
    });

    it('upgrades a pending row that books ten days later under a fresh entry_reference', async () => {
      // Issue #643, pair 2: a transfer sat as PDNG for ten days before booking.
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '12145.00',
          currency: 'EUR',
          isExpense: true,
          status: 'PDNG',
          transactionDate: '2025-04-04',
          counterpartyIban: 'LU280019400644750000',
          entryReference: '2025-04-04-16.59.21.512952',
          remittanceInformation: ['TRANSFER PENDING'],
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const afterPendingSync = await listTransactions({ accountId });
      expect(afterPendingSync.length).toBe(1);
      const pendingTx = afterPendingSync[0]!;

      helpers.enablebanking.setFixedTransactions([
        {
          amount: '12145.00',
          currency: 'EUR',
          isExpense: true,
          status: 'BOOK',
          bookingDate: '2025-04-14',
          counterpartyIban: 'LU280019400644750000',
          entryReference: '2025-04-14-00.07.34.957039',
          remittanceInformation: ['TRANSFER BOOKED'],
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const finalRows = await listTransactions({ accountId });
      expect(finalRows.length).toBe(1);
      expect(finalRows[0]!.id).toBe(pendingTx.id);
      expect((await readExternalData({ id: pendingTx.id })).rawTransaction?.status).toBe('BOOK');
    });

    it('reconcile folds an IBAN-less pending row into a booked row that carries an IBAN', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '37.00',
          currency: 'EUR',
          isExpense: true,
          status: 'BOOK',
          bookingDate: '2025-03-21',
          counterpartyIban: 'FI1313131313131313',
          entryReference: 'sepa_reconcile_ref',
          remittanceInformation: ['SEPA TRANSFER BOOKED'],
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const canonicalRows = await listTransactions({ accountId });
      expect(canonicalRows.length).toBe(1);
      const canonical = canonicalRows[0]!;

      await insertPendingOrphan({
        accountId,
        amount: 37,
        time: new Date('2025-03-20').toISOString(),
        categoryId: canonical.categoryId,
        remittanceInformation: ['CARD PURCHASE PENDING'],
      });

      const result = await helpers.bankDataProviders.reconcileDuplicates({ connectionId, accountId, raw: true });
      expect(result.mergedCount).toBe(1);

      const finalTxs = await listTransactions({ accountId });
      expect(finalTxs.length).toBe(1);
      expect(finalTxs[0]!.id).toBe(canonical.id);
    });

    it('does not upgrade a pending row dated more than two days after the booked copy', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_PENDING,
          amount: '42.00',
          transactionDate: '2025-04-20',
          remittanceInformation: ['LATER CARD PURCHASE PENDING'],
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      const pendingTx = (await listTransactions({ accountId }))[0]!;

      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_BOOKED,
          amount: '42.00',
          bookingDate: '2025-04-14',
          remittanceInformation: ['EARLIER CARD PURCHASE BOOKED'],
          entryReference: 'earlier_booked_ref',
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      expect((await listTransactions({ accountId })).length).toBe(2);
      expect((await readExternalData({ id: pendingTx.id })).rawTransaction?.status).toBe('PDNG');
    });

    it('reconcile keeps a pending row carrying an entry_reference next to a reference-less booked row', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_BOOKED,
          amount: '58.00',
          bookingDate: '2025-04-12',
          remittanceInformation: ['BOOKED WITHOUT REFERENCE'],
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      const canonical = (await listTransactions({ accountId }))[0]!;

      await insertPendingOrphan({
        accountId,
        amount: 58,
        time: new Date('2025-04-10').toISOString(),
        categoryId: canonical.categoryId,
        remittanceInformation: ['PENDING WITH REFERENCE'],
        entryReference: 'pending_ref_58',
      });

      const result = await helpers.bankDataProviders.reconcileDuplicates({ connectionId, accountId, raw: true });
      expect(result.mergedCount).toBe(0);
      expect((await listTransactions({ accountId })).length).toBe(2);
    });

    it('reconcile keeps an IBAN-less pending row dated more than five days before a booked row that carries an IBAN', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '73.00',
          currency: 'EUR',
          isExpense: true,
          status: 'BOOK',
          bookingDate: '2025-03-27',
          counterpartyIban: 'FI1515151515151515',
          entryReference: 'sepa_reconcile_late_ref',
          remittanceInformation: ['SEPA TRANSFER BOOKED'],
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      const canonical = (await listTransactions({ accountId }))[0]!;

      await insertPendingOrphan({
        accountId,
        amount: 73,
        time: new Date('2025-03-21').toISOString(),
        categoryId: canonical.categoryId,
        remittanceInformation: ['CARD PURCHASE PENDING'],
      });

      const result = await helpers.bankDataProviders.reconcileDuplicates({ connectionId, accountId, raw: true });
      expect(result.mergedCount).toBe(0);
      expect((await listTransactions({ accountId })).length).toBe(2);
    });

    it('reconcile folds a pending row carrying its own entry_reference into the booked copy that arrived ten days later', async () => {
      // Issue #643 cleanup: both leftover pending rows carry per-payload
      // entry_references, so reconcile has to treat them as orphans anyway.
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '12145.00',
          currency: 'EUR',
          isExpense: true,
          status: 'BOOK',
          bookingDate: '2025-04-14',
          counterpartyIban: 'LU280019400644750000',
          entryReference: '2025-04-14-00.07.34.957039',
          remittanceInformation: ['TRANSFER BOOKED'],
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const canonicalRows = await listTransactions({ accountId });
      expect(canonicalRows.length).toBe(1);
      const canonical = canonicalRows[0]!;

      await insertPendingOrphan({
        accountId,
        amount: 12145,
        time: new Date('2025-04-04').toISOString(),
        categoryId: canonical.categoryId,
        remittanceInformation: ['TRANSFER PENDING'],
        counterpartyIban: 'LU280019400644750000',
        entryReference: '2025-04-04-16.59.21.512952',
      });
      expect((await listTransactions({ accountId })).length).toBe(2);

      const result = await helpers.bankDataProviders.reconcileDuplicates({ connectionId, accountId, raw: true });
      expect(result.mergedCount).toBe(1);

      const finalTxs = await listTransactions({ accountId });
      expect(finalTxs.length).toBe(1);
      expect(finalTxs[0]!.id).toBe(canonical.id);
    });

    it('leaves the upgraded row untouched when the same booked payload is synced again', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_PENDING,
          amount: '33.00',
          transactionDate: '2025-03-11',
          remittanceInformation: ['PENDING IDEMPOTENT'],
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_BOOKED,
          amount: '33.00',
          bookingDate: '2025-03-12',
          remittanceInformation: ['BOOKED IDEMPOTENT'],
          entryReference: 'idempotent_booked_ref',
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const afterFirstBookedSync = await listTransactions({ accountId });
      expect(afterFirstBookedSync.length).toBe(1);
      const upgraded = afterFirstBookedSync[0]!;
      // The row still carried the sync-generated pending text, so the upgrade
      // replaces it with the booked one.
      expect(upgraded.note).toBe('BOOKED IDEMPOTENT');

      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const afterSecondBookedSync = await listTransactions({ accountId });
      expect(afterSecondBookedSync.length).toBe(1);
      expect(afterSecondBookedSync[0]!.id).toBe(upgraded.id);
      expect(afterSecondBookedSync[0]!.originalId).toBe(upgraded.originalId);
      expect(afterSecondBookedSync[0]!.note).toBe('BOOKED IDEMPOTENT');
      expect((await readExternalData({ id: upgraded.id })).entryReference).toBe('idempotent_booked_ref');
    });

    it('keeps both rows when the amount changes between pending and booked', async () => {
      // Known limitation: exact-amount equality is a match precondition, so tips,
      // fuel pre-authorisations and FX settlements still leave a duplicate behind.
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_PENDING,
          amount: '50.00',
          transactionDate: '2025-04-01',
          remittanceInformation: ['RESTAURANT PENDING'],
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      expect((await listTransactions({ accountId })).length).toBe(1);

      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_BOOKED,
          amount: '55.00',
          bookingDate: '2025-04-02',
          remittanceInformation: ['RESTAURANT BOOKED'],
          entryReference: 'tip_added_ref',
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      expect((await listTransactions({ accountId })).length).toBe(2);
    });

    it('reconcile collapses an existing pending/booked pair and moves the pending row edits onto the booked one', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_BOOKED,
          amount: '40.00',
          bookingDate: '2025-05-10',
          remittanceInformation: ['CARD PURCHASE BOOKED'],
          entryReference: 'reconcile_booked_ref',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const canonicalRows = await listTransactions({ accountId });
      expect(canonicalRows.length).toBe(1);
      const canonical = canonicalRows[0]!;

      const userCategoryId = await findCategoryOtherThan({ categoryId: canonical.categoryId });

      const balanceWithCanonicalOnly = Number((await helpers.getAccount({ id: accountId, raw: true })).currentBalance);

      await insertPendingOrphan({
        accountId,
        amount: 40,
        time: new Date('2025-05-08').toISOString(),
        categoryId: userCategoryId,
        remittanceInformation: ['CARD PURCHASE PENDING'],
        note: 'Dinner with Ann',
      });
      expect((await listTransactions({ accountId })).length).toBe(2);
      expect(Number((await helpers.getAccount({ id: accountId, raw: true })).currentBalance)).toBe(
        balanceWithCanonicalOnly - 40,
      );

      const result = await helpers.bankDataProviders.reconcileDuplicates({ connectionId, accountId, raw: true });
      expect(result.mergedCount).toBe(1);
      expect(result.skippedCount).toBe(0);

      const finalTxs = await listTransactions({ accountId });
      expect(finalTxs.length).toBe(1);
      expect(finalTxs[0]!.id).toBe(canonical.id);
      expect(finalTxs[0]!.note).toBe('Dinner with Ann');
      expect(finalTxs[0]!.categoryId).toBe(userCategoryId);
      // Deleting the duplicate must credit its amount back, or the account drifts
      // by the orphan's amount every time reconcile runs.
      expect(Number((await helpers.getAccount({ id: accountId, raw: true })).currentBalance)).toBe(
        balanceWithCanonicalOnly,
      );
    });

    it('reconcile does not let a cancelled row act as the survivor for a real pending one', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_BOOKED,
          amount: '55.00',
          bookingDate: '2025-07-10',
          remittanceInformation: ['UNRELATED BOOKED'],
          entryReference: 'cancelled_guard_unrelated',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      const categoryId = (await listTransactions({ accountId }))[0]!.categoryId;

      // A cancelled authorisation the bank still returns, reference and all. Live
      // sync can't produce this shape, so the payload is written onto the row.
      const cancelled = await insertRealRow({
        accountId,
        amount: 60,
        categoryId,
        time: new Date('2025-07-20').toISOString(),
        note: 'CARD PURCHASE',
        externalData: {
          isExpense: true,
          entryReference: 'cancelled_guard_ref',
          rawTransaction: { status: 'CNCL', remittance_information: ['CARD PURCHASE'] },
        },
      });

      // Same amount, same category, same note, two days earlier — every merge gate
      // passes, so only the status keeps this row alive.
      const pending = await insertPendingOrphan({
        accountId,
        amount: 60,
        categoryId,
        time: new Date('2025-07-18').toISOString(),
        remittanceInformation: ['CARD PURCHASE'],
      });

      const result = await helpers.bankDataProviders.reconcileDuplicates({ connectionId, accountId, raw: true });

      expect(result.mergedCount).toBe(0);
      const remainingIds = (await listTransactions({ accountId })).map((tx) => tx.id);
      expect(remainingIds).toContain(pending.id);
      expect(remainingIds).toContain(cancelled.id);
    });

    it('reconcile skips a pending duplicate that carries dependent data', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_BOOKED,
          amount: '45.00',
          bookingDate: '2025-06-10',
          remittanceInformation: ['TAGGED PURCHASE BOOKED'],
          entryReference: 'reconcile_tagged_ref',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const canonicalRows = await listTransactions({ accountId });
      const canonical = canonicalRows[0]!;

      const orphan = await insertPendingOrphan({
        accountId,
        amount: 45,
        time: new Date('2025-06-09').toISOString(),
        categoryId: canonical.categoryId,
        remittanceInformation: ['TAGGED PURCHASE PENDING'],
      });

      const tag = await helpers.createTag({
        payload: { name: `pending-protect-${Date.now()}`, color: '#3b82f6' },
        raw: true,
      });
      await helpers.addTransactionsToTag({ tagId: tag.id, transactionIds: [orphan.id] });

      const result = await helpers.bankDataProviders.reconcileDuplicates({ connectionId, accountId, raw: true });
      expect(result.mergedCount).toBe(0);
      expect(result.skippedCount).toBe(1);

      const finalTxs = await listTransactions({ accountId });
      expect(finalTxs.length).toBe(2);
    });

    it('flips a stored pending row to booked even when the fallback hash is unchanged', async () => {
      // A pending row that already carries booking_date: the booked re-issue keeps
      // every hashed field, so tier (2) matches with nothing else to update. Only
      // the status refresh distinguishes it from a no-op sync.
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_PENDING,
          amount: '27.00',
          bookingDate: '2025-07-04',
          remittanceInformation: ['SUPERMARKET'],
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const afterPendingSync = await listTransactions({ accountId });
      expect(afterPendingSync.length).toBe(1);
      const pendingTx = afterPendingSync[0]!;
      expect((await readExternalData({ id: pendingTx.id })).rawTransaction?.status).toBe('PDNG');

      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_BOOKED,
          amount: '27.00',
          bookingDate: '2025-07-04',
          remittanceInformation: ['SUPERMARKET'],
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const afterBookedSync = await listTransactions({ accountId });
      expect(afterBookedSync.length).toBe(1);
      expect(afterBookedSync[0]!.id).toBe(pendingTx.id);
      expect((await readExternalData({ id: pendingTx.id })).rawTransaction?.status).toBe('BOOK');

      // An unrelated purchase of the same amount two days later. It only stays its
      // own row because the first row left the pending pool.
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_BOOKED,
          amount: '27.00',
          bookingDate: '2025-07-06',
          remittanceInformation: ['PHARMACY'],
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      expect((await listTransactions({ accountId })).length).toBe(2);
    });

    it('does not upgrade a pending row from an OTHR re-issue', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_PENDING,
          amount: '19.00',
          transactionDate: '2025-08-05',
          remittanceInformation: ['OTHR PENDING'],
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      expect((await listTransactions({ accountId })).length).toBe(1);

      // OTHR is neither booked nor pending — only BOOK is allowed to consume a
      // pending row, so this stays a separate transaction.
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD_PENDING,
          status: 'OTHR',
          amount: '19.00',
          transactionDate: '2025-08-06',
          remittanceInformation: ['OTHR REISSUE'],
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      expect((await listTransactions({ accountId })).length).toBe(2);
    });
  });

  // ==========================================================================
  // #6 — cancelled / rejected / scheduled payloads, and HOLD as pre-booking
  // ==========================================================================
  describe('#6 terminal and future statuses', () => {
    const CARD = { currency: 'EUR', isExpense: true, counterpartyIban: null } as const;

    /**
     * `writeBankBalanceWithHistory` re-pins `currentBalance` to the bank's figure at
     * the end of every sync, so these assertions pin that removing a row leaves the
     * account on that figure — they cannot observe a per-row cents delta.
     */
    function readBalance({ accountId }: { accountId: RecordId }) {
      return helpers.getAccount({ id: accountId, raw: true }).then((a) => Number(a.currentBalance));
    }

    it('never creates a ledger row for a cancelled, rejected or scheduled payload', async () => {
      helpers.enablebanking.setFixedTransactions([
        { ...CARD, status: 'CNCL', amount: '11.00', bookingDate: '2025-11-01', remittanceInformation: ['CANCELLED'] },
        { ...CARD, status: 'RJCT', amount: '12.00', bookingDate: '2025-11-02', remittanceInformation: ['REJECTED'] },
        { ...CARD, status: 'SCHD', amount: '13.00', bookingDate: '2025-11-03', remittanceInformation: ['SCHEDULED'] },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      expect(await listTransactions({ accountId })).toEqual([]);

      // The same batch on a second sync must stay just as inert.
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });
      expect(await listTransactions({ accountId })).toEqual([]);
    });

    it('removes a stored pending row when the bank cancels it', async () => {
      const payload: FixedTransaction = {
        ...CARD,
        status: 'PDNG',
        amount: '23.00',
        transactionDate: '2025-11-05',
        remittanceInformation: ['CANCELLED LATER'],
      };
      helpers.enablebanking.setFixedTransactions([payload]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const pendingRows = await listTransactions({ accountId });
      expect(pendingRows.length).toBe(1);
      const pendingTx = pendingRows[0]!;
      const balanceWithPending = await readBalance({ accountId });

      helpers.enablebanking.setFixedTransactions([{ ...payload, status: 'CNCL' }]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      expect(await listTransactions({ accountId })).toEqual([]);
      expect(await Transactions.findByPk(pendingTx.id)).toBeNull();
      expect(await readBalance({ accountId })).toBe(balanceWithPending);
    });

    it('removes a stored pending row when the bank rejects it', async () => {
      const payload: FixedTransaction = {
        ...CARD,
        status: 'PDNG',
        amount: '24.00',
        transactionDate: '2025-11-08',
        remittanceInformation: ['REJECTED LATER'],
      };
      helpers.enablebanking.setFixedTransactions([payload]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      const pendingTx = (await listTransactions({ accountId }))[0]!;
      const balanceWithPending = await readBalance({ accountId });

      helpers.enablebanking.setFixedTransactions([{ ...payload, status: 'RJCT' }]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      expect(await Transactions.findByPk(pendingTx.id)).toBeNull();
      expect(await readBalance({ accountId })).toBe(balanceWithPending);
    });

    it('keeps a cancelled pending row that carries dependent data', async () => {
      const payload: FixedTransaction = {
        ...CARD,
        status: 'PDNG',
        amount: '26.00',
        transactionDate: '2025-11-12',
        remittanceInformation: ['TAGGED PENDING'],
      };
      helpers.enablebanking.setFixedTransactions([payload]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const pendingTx = (await listTransactions({ accountId }))[0]!;
      const tag = await helpers.createTag({
        payload: { name: `cancel-protect-${Date.now()}`, color: '#3b82f6' },
        raw: true,
      });
      await helpers.addTransactionsToTag({ tagId: tag.id, transactionIds: [pendingTx.id] });
      const balanceWithPending = await readBalance({ accountId });

      helpers.enablebanking.setFixedTransactions([{ ...payload, status: 'CNCL' }]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const finalRows = await listTransactions({ accountId });
      expect(finalRows.length).toBe(1);
      expect(finalRows[0]!.id).toBe(pendingTx.id);
      // The cancelled payload must not be merged onto the row it failed to remove.
      expect((await readExternalData({ id: pendingTx.id })).rawTransaction?.status).toBe('PDNG');
      expect(await readBalance({ accountId })).toBe(balanceWithPending);
    });

    it('leaves a settled row alone when a cancellation matches it', async () => {
      const payload: FixedTransaction = {
        ...CARD,
        status: 'BOOK',
        amount: '28.00',
        bookingDate: '2025-11-15',
        entryReference: 'booked_then_cancelled',
        remittanceInformation: ['BOOKED PURCHASE'],
      };
      helpers.enablebanking.setFixedTransactions([payload]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      const bookedTx = (await listTransactions({ accountId }))[0]!;

      helpers.enablebanking.setFixedTransactions([{ ...payload, status: 'CNCL' }]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const finalRows = await listTransactions({ accountId });
      expect(finalRows.length).toBe(1);
      expect(finalRows[0]!.id).toBe(bookedTx.id);
      expect((await readExternalData({ id: bookedTx.id })).rawTransaction?.status).toBe('BOOK');
    });

    it('upgrades a stored HOLD row in place when it books', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD,
          status: 'HOLD',
          amount: '29.00',
          transactionDate: '2025-12-01',
          remittanceInformation: ['HOLD AUTHORISATION'],
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const heldRows = await listTransactions({ accountId });
      expect(heldRows.length).toBe(1);
      const heldTx = heldRows[0]!;
      expect((await readExternalData({ id: heldTx.id })).rawTransaction?.status).toBe('HOLD');

      // Fresh reference, different text and a date two days on: only the
      // pre-booking candidate pool can connect this to the held row.
      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD,
          status: 'BOOK',
          amount: '29.00',
          bookingDate: '2025-12-03',
          entryReference: 'hold_booked_ref',
          remittanceInformation: ['HOLD SETTLED'],
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const finalRows = await listTransactions({ accountId });
      expect(finalRows.length).toBe(1);
      expect(finalRows[0]!.id).toBe(heldTx.id);
      const externalData = await readExternalData({ id: heldTx.id });
      expect(externalData.rawTransaction?.status).toBe('BOOK');
      expect(externalData.entryReference).toBe('hold_booked_ref');
    });

    it('does not let a re-sent HOLD payload overwrite the booked row it became', async () => {
      const holdPayload: FixedTransaction = {
        ...CARD,
        status: 'HOLD',
        amount: '32.00',
        transactionDate: '2025-12-10',
        remittanceInformation: ['HOLD RESENT'],
      };
      helpers.enablebanking.setFixedTransactions([holdPayload]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      const heldTx = (await listTransactions({ accountId }))[0]!;

      helpers.enablebanking.setFixedTransactions([
        {
          ...CARD,
          status: 'BOOK',
          amount: '32.00',
          bookingDate: '2025-12-11',
          entryReference: 'hold_resent_ref',
          remittanceInformation: ['HOLD RESENT BOOKED'],
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      helpers.enablebanking.setFixedTransactions([holdPayload]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const finalRows = await listTransactions({ accountId });
      expect(finalRows.length).toBe(1);
      expect(finalRows[0]!.id).toBe(heldTx.id);
      expect(finalRows[0]!.note).toBe('HOLD RESENT BOOKED');
      expect((await readExternalData({ id: heldTx.id })).rawTransaction?.status).toBe('BOOK');
    });
  });

  // ==========================================================================
  // #7 — the window the incremental sync asks the bank for
  // ==========================================================================
  describe('#7 incremental fetch window', () => {
    it('never asks the bank for a date_from in the future', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          currency: 'EUR',
          isExpense: true,
          amount: '30.00',
          bookingDate: '2026-01-15',
          remittanceInformation: ['GROCERIES'],
          entryReference: 'window_anchor_ref',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      const syncedTx = (await listTransactions({ accountId }))[0]!;

      // A real row dated past today — an imported entry, or a bank row whose value_date
      // runs ahead. The anchor is MAX(time) over every real row, so this alone pushes it
      // past today. A planned row would not: the anchor query filters those out.
      const future = new Date(Date.now() + 45 * 24 * 60 * 60 * 1000);
      await insertRealRow({
        accountId,
        amount: 20,
        time: future.toISOString(),
        categoryId: syncedTx.categoryId,
        note: 'FUTURE VALUE DATE',
      });

      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const requested = helpers.enablebanking.lastTransactionsQuery();
      const today = new Date().toISOString().split('T')[0]!;
      expect(requested).not.toBeNull();
      expect(requested!.dateFrom).toBe(today);
      expect(requested!.dateFrom! <= requested!.dateTo!).toBe(true);
    });

    it('asks for the longest available history on the initial sync only', async () => {
      const { connectionId, accountId } = await setupConnectionWithAccount();
      expect(helpers.enablebanking.lastTransactionsQuery()!.strategy).toBe('longest');

      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });
      expect(helpers.enablebanking.lastTransactionsQuery()!.strategy).toBeNull();
    });
  });

  // ==========================================================================
  // #8 — account unlink → reconnect
  // ==========================================================================
  describe('#8 unlink → reconnect dedup', () => {
    it('does not duplicate reference-less transactions after account unlink → reconnect', async () => {
      // Unlink nulls originalId on every row (preserving it only in
      // externalData.originalSource.originalId). A reference-less, IBAN-less row
      // — the "Prel" card-purchase shape — then has no surviving match key
      // except that snapshot.
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '43.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-03-15',
          counterpartyIban: null,
          remittanceInformation: ['Prel card purchase'],
        },
        {
          amount: '250.00',
          currency: 'EUR',
          isExpense: false,
          bookingDate: '2024-03-15',
          counterpartyIban: null,
          entryReference: 'ref_reconnect_control',
        },
      ]);
      const { accountId } = await setupConnectionWithAccount();

      const txsBefore = await listTransactions({ accountId });
      expect(txsBefore.length).toBe(2);

      await helpers.unlinkAccountFromBankConnection({ id: String(accountId), raw: true });

      // Reconnect through a brand-new connection, same bank account.
      const reconnectResult = await helpers.bankDataProviders.connectProvider({
        providerType: BANK_PROVIDER_TYPE.ENABLE_BANKING,
        credentials: helpers.enablebanking.mockCredentials(),
        raw: true,
      });
      const state = await helpers.enablebanking.getConnectionState(reconnectResult.connectionId);
      await helpers.makeRequest({
        method: 'post',
        url: '/bank-data-providers/enablebanking/oauth-callback',
        payload: {
          connectionId: reconnectResult.connectionId,
          code: helpers.enablebanking.mockAuthCode,
          state,
        },
      });
      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: reconnectResult.connectionId,
        accountExternalIds: [MOCK_IDENTIFICATION_HASH_1],
        raw: true,
      });

      // The disconnected account row is re-linked, not recreated
      expect(syncedAccounts[0]!.id).toBe(accountId);

      const txsAfter = await listTransactions({ accountId });
      expect(txsAfter.length).toBe(2);

      // Matched rows get originalId restored so future syncs use the fast path
      for (const tx of txsAfter) {
        expect(tx.originalId).not.toBeNull();
      }
    });
  });

  // ==========================================================================
  // #9 — structured reference number
  // ==========================================================================
  describe('#9 reference_number', () => {
    it('stores reference_number as externalReference', async () => {
      helpers.enablebanking.setFixedTransactions([
        {
          amount: '120.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-09-01',
          entryReference: 'reference_structured',
          remittanceInformation: ['Invoice structured'],
          referenceNumber: { identification: 'RF18539007547034', scheme_name: ReferenceNumberScheme.SCOR },
        },
        {
          amount: '35.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-09-02',
          entryReference: 'reference_flattened',
          remittanceInformation: ['Invoice flattened'],
          referenceNumber: '  1234561  ',
        },
        {
          amount: '18.00',
          currency: 'EUR',
          isExpense: true,
          bookingDate: '2024-09-03',
          entryReference: 'reference_absent',
          remittanceInformation: ['No reference'],
        },
      ]);
      const { accountId } = await setupConnectionWithAccount();

      const byNote = new Map((await listTransactions({ accountId })).map((tx) => [tx.note, tx]));

      expect(byNote.get('Invoice structured')!.externalReference).toBe('RF18539007547034');
      expect(byNote.get('Invoice flattened')!.externalReference).toBe('1234561');
      expect(byNote.get('No reference')!.externalReference).toBeNull();
    });

    it('backfills externalReference when the booked re-issue is the first payload carrying it', async () => {
      const card = { currency: 'EUR', isExpense: true, counterpartyIban: null, amount: '42.00' } as const;
      helpers.enablebanking.setFixedTransactions([
        { ...card, status: 'PDNG', transactionDate: '2025-02-10', remittanceInformation: ['CARD PENDING'] },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      const pendingTx = (await listTransactions({ accountId }))[0]!;
      expect(pendingTx.externalReference).toBeNull();

      helpers.enablebanking.setFixedTransactions([
        {
          ...card,
          status: 'BOOK',
          bookingDate: '2025-02-12',
          remittanceInformation: ['CARD BOOKED'],
          entryReference: 'booked_ref_042',
          referenceNumber: 'RF7100042',
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const rows = await listTransactions({ accountId });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(pendingTx.id);
      expect(rows[0]!.externalReference).toBe('RF7100042');
    });
  });

  // ==========================================================================
  // #10 — pending and booked copies disagree on direction
  // ==========================================================================
  describe('#10 direction flag disagrees between pending and booked', () => {
    /**
     * A bankgiro fee paid out of the account. The pending payload keeps the parties
     * of an outgoing payment but flags it CRDT; the booked copy flags it DBIT.
     */
    const FEE: FixedTransaction = {
      amount: '140.00',
      currency: 'EUR',
      isExpense: true,
      counterpartyBban: '58628082',
      transactionDate: '2025-05-28',
      remittanceInformation: ['58628082 AKADEMIKERNAS A-KASSA'],
    };

    it('switches the row to the booked direction when the booked copy keeps the entry_reference', async () => {
      helpers.enablebanking.setFixedTransactions([
        { ...FEE, status: 'PDNG', creditDebitIndicator: 'CRDT', entryReference: 'fee_ref_0528' },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();

      const [pendingTx] = await listTransactions({ accountId });
      expect(pendingTx!.transactionType).toBe(TRANSACTION_TYPES.income);

      helpers.enablebanking.setFixedTransactions([
        { ...FEE, status: 'BOOK', bookingDate: '2025-05-28', entryReference: 'fee_ref_0528' },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const rows = await listTransactions({ accountId });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(pendingTx!.id);
      expect(rows[0]!.transactionType).toBe(TRANSACTION_TYPES.expense);
      expect((await readExternalData({ id: pendingTx!.id })).rawTransaction?.status).toBe('BOOK');
    });

    it('adopts a pending row with the opposite direction when the booked copy has a fresh reference and the same counterparty account', async () => {
      helpers.enablebanking.setFixedTransactions([
        { ...FEE, status: 'PDNG', creditDebitIndicator: 'CRDT', entryReference: '0671844781' },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      const [pendingTx] = await listTransactions({ accountId });
      expect(pendingTx!.transactionType).toBe(TRANSACTION_TYPES.income);

      helpers.enablebanking.setFixedTransactions([
        {
          ...FEE,
          status: 'BOOK',
          bookingDate: '2025-05-28',
          remittanceInformation: ['30189278', '58628082 AKADEMIKERNAS A-'],
          entryReference: '00000007989816749',
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const rows = await listTransactions({ accountId });
      expect(rows).toHaveLength(1);
      expect(rows[0]!.id).toBe(pendingTx!.id);
      expect(rows[0]!.transactionType).toBe(TRANSACTION_TYPES.expense);
      const externalData = await readExternalData({ id: pendingTx!.id });
      expect(externalData.rawTransaction?.status).toBe('BOOK');
      expect(externalData.entryReference).toBe('00000007989816749');
    });

    it('keeps a pending purchase and a same-amount booked refund from that merchant apart', async () => {
      const merchant = { amount: '140.00', currency: 'EUR', counterpartyIban: 'SE4550000000058249997' } as const;
      helpers.enablebanking.setFixedTransactions([
        {
          ...merchant,
          isExpense: true,
          status: 'PDNG',
          transactionDate: '2025-06-10',
          remittanceInformation: ['WEBSHOP ORDER'],
          entryReference: 'purchase_ref',
        },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      const [pendingTx] = await listTransactions({ accountId });

      helpers.enablebanking.setFixedTransactions([
        {
          ...merchant,
          isExpense: false,
          status: 'BOOK',
          bookingDate: '2025-06-11',
          remittanceInformation: ['WEBSHOP REFUND'],
          entryReference: 'refund_ref',
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const rows = await listTransactions({ accountId });
      expect(rows).toHaveLength(2);
      const pendingAfter = rows.find((row) => row.id === pendingTx!.id)!;
      expect(pendingAfter.transactionType).toBe(TRANSACTION_TYPES.expense);
      expect((await readExternalData({ id: pendingTx!.id })).rawTransaction?.status).toBe('PDNG');
    });

    it('keeps a mirrored-direction pending row dated more than two days before the booked copy', async () => {
      helpers.enablebanking.setFixedTransactions([
        { ...FEE, status: 'PDNG', creditDebitIndicator: 'CRDT', entryReference: 'early_pending_ref' },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      const [pendingTx] = await listTransactions({ accountId });

      helpers.enablebanking.setFixedTransactions([
        {
          ...FEE,
          transactionDate: undefined,
          status: 'BOOK',
          bookingDate: '2025-06-01',
          entryReference: 'late_booked_ref',
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const rows = await listTransactions({ accountId });
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.id === pendingTx!.id)!.transactionType).toBe(TRANSACTION_TYPES.income);
    });

    it('keeps a mirrored-direction pending row when the booked copy names a different counterparty account', async () => {
      helpers.enablebanking.setFixedTransactions([
        { ...FEE, status: 'PDNG', creditDebitIndicator: 'CRDT', entryReference: 'fee_pending_ref' },
      ]);
      const { connectionId, accountId } = await setupConnectionWithAccount();
      const [pendingTx] = await listTransactions({ accountId });

      helpers.enablebanking.setFixedTransactions([
        {
          ...FEE,
          counterpartyBban: '11112222',
          status: 'BOOK',
          bookingDate: '2025-05-28',
          entryReference: 'other_payee_ref',
        },
      ]);
      await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });

      const rows = await listTransactions({ accountId });
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.id === pendingTx!.id)!.transactionType).toBe(TRANSACTION_TYPES.income);
    });
  });
});
