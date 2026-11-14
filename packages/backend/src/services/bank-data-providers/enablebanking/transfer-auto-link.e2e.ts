import type { RecordId } from '@bt/shared/types';
import { ACCOUNT_TYPES, BANK_PROVIDER_TYPE, TRANSACTION_TRANSFER_NATURE, TRANSACTION_TYPES } from '@bt/shared/types';
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { DOMAIN_EVENTS, type TransactionsSyncedPayload, eventBus } from '@root/services/common/event-bus';
import type { HistoryItem } from '@services/bank-data-providers/walutomat/api-client';
import * as helpers from '@tests/helpers';
import { useSelfHost } from '@tests/helpers/self-host';
import {
  FixedTransaction,
  MOCK_IDENTIFICATION_HASH_1,
  MOCK_IDENTIFICATION_HASH_2,
} from '@tests/mocks/enablebanking/data';
import { getWalutomatBalancesMock, getWalutomatHistoryMock } from '@tests/mocks/walutomat/mock-api';

useSelfHost();

describe('Enable Banking transfer auto-linking (E2E)', () => {
  beforeEach(() => {
    helpers.enablebanking.resetSessionCounter();
  });

  afterEach(() => {
    helpers.enablebanking.resetTransactionConfig();
  });

  // Must match the mocked account details for HASH_1 / HASH_2 (both EUR).
  const MAIN_ACCOUNT_IBAN = 'FI1234567890123456';
  const SAVINGS_ACCOUNT_IBAN = 'FI9876543210987654';

  /** Connects with no transactions so each leg can be synced separately afterwards. */
  async function setupTwoAccounts(): Promise<{
    connectionId: string;
    mainAccountId: RecordId;
    savingsAccountId: RecordId;
  }> {
    helpers.enablebanking.setFixedTransactions([]);

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
      accountExternalIds: [MOCK_IDENTIFICATION_HASH_1, MOCK_IDENTIFICATION_HASH_2],
      raw: true,
    });

    const main = syncedAccounts.find((a) => a.externalId === MOCK_IDENTIFICATION_HASH_1);
    const savings = syncedAccounts.find((a) => a.externalId === MOCK_IDENTIFICATION_HASH_2);
    if (!main || !savings) throw new Error('Expected both mock accounts to be connected');

    return {
      connectionId: connectResult.connectionId,
      mainAccountId: main.id,
      savingsAccountId: savings.id,
    };
  }

  async function syncAccountWith({
    connectionId,
    accountId,
    transactions,
  }: {
    connectionId: string;
    accountId: RecordId;
    transactions: FixedTransaction[];
  }) {
    helpers.enablebanking.setFixedTransactions(transactions);
    await helpers.bankDataProviders.syncTransactionsForAccount({ connectionId, accountId, raw: true });
  }

  function listTransactions({ accountId }: { accountId: RecordId }) {
    return helpers.getTransactions({ accountIds: [accountId], raw: true });
  }

  const expenseLeg = (overrides: Partial<FixedTransaction> = {}): FixedTransaction => ({
    amount: '150.00',
    currency: 'EUR',
    isExpense: true,
    bookingDate: '2024-03-15',
    valueDate: '2024-03-15',
    entryReference: 'transfer_out_001',
    counterpartyIban: SAVINGS_ACCOUNT_IBAN,
    remittanceInformation: ['OWN TRANSFER'],
    ...overrides,
  });

  const incomeLeg = (overrides: Partial<FixedTransaction> = {}): FixedTransaction => ({
    amount: '150.00',
    currency: 'EUR',
    isExpense: false,
    bookingDate: '2024-03-15',
    valueDate: '2024-03-15',
    entryReference: 'transfer_in_001',
    counterpartyIban: MAIN_ACCOUNT_IBAN,
    remittanceInformation: ['OWN TRANSFER-IN'],
    ...overrides,
  });

  /** Manual account in the same currency as the mocked bank accounts, so its rows can be candidates. */
  async function createManualAccount(): Promise<RecordId> {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({
        name: 'Cash wallet',
        type: ACCOUNT_TYPES.system,
        currencyCode: 'EUR',
      }),
      raw: true,
    });

    return account.id;
  }

  function createManualExpense({
    accountId,
    amount = 150,
    note = 'MOVED TO SAVINGS',
  }: {
    accountId: RecordId;
    amount?: number;
    note?: string;
  }) {
    return helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId,
        amount,
        note,
        transactionType: TRANSACTION_TYPES.expense,
        time: new Date('2024-03-15T10:00:00.000Z').toISOString(),
      }),
      raw: true,
    });
  }

  it('links a transfer pair confirmed by counterparty IBANs', async () => {
    const { connectionId, mainAccountId, savingsAccountId } = await setupTwoAccounts();

    await syncAccountWith({ connectionId, accountId: mainAccountId, transactions: [expenseLeg()] });
    await syncAccountWith({ connectionId, accountId: savingsAccountId, transactions: [incomeLeg()] });

    const [mainTx] = await listTransactions({ accountId: mainAccountId });
    const [savingsTx] = await listTransactions({ accountId: savingsAccountId });

    expect(mainTx!.transactionType).toBe(TRANSACTION_TYPES.expense);
    expect(mainTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
    expect(savingsTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);

    expect(mainTx!.transferId).toBeTruthy();
    expect(mainTx!.transferId).toBe(savingsTx!.transferId);
  });

  it('links an unambiguous pair even without counterparty IBANs', async () => {
    const { connectionId, mainAccountId, savingsAccountId } = await setupTwoAccounts();

    await syncAccountWith({
      connectionId,
      accountId: mainAccountId,
      transactions: [expenseLeg({ counterpartyIban: null })],
    });
    await syncAccountWith({
      connectionId,
      accountId: savingsAccountId,
      transactions: [incomeLeg({ counterpartyIban: null })],
    });

    const [mainTx] = await listTransactions({ accountId: mainAccountId });
    const [savingsTx] = await listTransactions({ accountId: savingsAccountId });

    expect(mainTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
    expect(savingsTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
  });

  it('does not link when two same-amount candidates make the pairing ambiguous', async () => {
    const { connectionId, mainAccountId, savingsAccountId } = await setupTwoAccounts();

    await syncAccountWith({
      connectionId,
      accountId: mainAccountId,
      transactions: [
        expenseLeg({ counterpartyIban: null, entryReference: 'ambiguous_a' }),
        expenseLeg({ counterpartyIban: null, entryReference: 'ambiguous_b' }),
      ],
    });
    await syncAccountWith({
      connectionId,
      accountId: savingsAccountId,
      transactions: [incomeLeg({ counterpartyIban: null })],
    });

    const mainTxs = await listTransactions({ accountId: mainAccountId });
    const savingsTxs = await listTransactions({ accountId: savingsAccountId });

    expect(mainTxs.length).toBe(2);
    for (const tx of [...mainTxs, ...savingsTxs]) {
      expect(tx.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
    }
  });

  it('does not link when a counterparty IBAN contradicts the other account', async () => {
    const { connectionId, mainAccountId, savingsAccountId } = await setupTwoAccounts();

    await syncAccountWith({
      connectionId,
      accountId: mainAccountId,
      transactions: [expenseLeg({ counterpartyIban: 'DE89370400440532013000' })],
    });
    await syncAccountWith({
      connectionId,
      accountId: savingsAccountId,
      transactions: [incomeLeg({ counterpartyIban: null })],
    });

    const [mainTx] = await listTransactions({ accountId: mainAccountId });
    const [savingsTx] = await listTransactions({ accountId: savingsAccountId });

    expect(mainTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
    expect(savingsTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
  });

  it('does not link transactions outside the date window', async () => {
    const { connectionId, mainAccountId, savingsAccountId } = await setupTwoAccounts();

    await syncAccountWith({
      connectionId,
      accountId: mainAccountId,
      transactions: [expenseLeg({ bookingDate: '2024-03-01', valueDate: '2024-03-01' })],
    });
    await syncAccountWith({
      connectionId,
      accountId: savingsAccountId,
      transactions: [incomeLeg({ bookingDate: '2024-03-10', valueDate: '2024-03-10' })],
    });

    const [mainTx] = await listTransactions({ accountId: mainAccountId });
    const [savingsTx] = await listTransactions({ accountId: savingsAccountId });

    expect(mainTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
    expect(savingsTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
  });

  it('links legs sitting exactly on the edge of the date window', async () => {
    const { connectionId, mainAccountId, savingsAccountId } = await setupTwoAccounts();

    await syncAccountWith({
      connectionId,
      accountId: mainAccountId,
      transactions: [expenseLeg({ bookingDate: '2024-03-12', valueDate: '2024-03-12' })],
    });
    await syncAccountWith({
      connectionId,
      accountId: savingsAccountId,
      transactions: [incomeLeg({ bookingDate: '2024-03-15', valueDate: '2024-03-15' })],
    });

    const [mainTx] = await listTransactions({ accountId: mainAccountId });
    const [savingsTx] = await listTransactions({ accountId: savingsAccountId });

    expect(mainTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
    expect(savingsTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
    expect(mainTx!.transferId).toBe(savingsTx!.transferId);
  });

  it('does not link when one IBAN confirms two equally plausible expenses', async () => {
    const { connectionId, mainAccountId, savingsAccountId } = await setupTwoAccounts();

    await syncAccountWith({
      connectionId,
      accountId: mainAccountId,
      transactions: [
        expenseLeg({ counterpartyIban: null, entryReference: 'confirmed_ambiguous_a' }),
        expenseLeg({ counterpartyIban: null, entryReference: 'confirmed_ambiguous_b' }),
      ],
    });
    await syncAccountWith({
      connectionId,
      accountId: savingsAccountId,
      transactions: [incomeLeg({ counterpartyIban: MAIN_ACCOUNT_IBAN })],
    });

    const mainTxs = await listTransactions({ accountId: mainAccountId });
    const savingsTxs = await listTransactions({ accountId: savingsAccountId });

    expect(mainTxs.length).toBe(2);
    for (const tx of [...mainTxs, ...savingsTxs]) {
      expect(tx.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
    }
  });

  it('skips pending rows and links them once they become booked', async () => {
    await helpers.patchUserSettings({ patch: { importPendingBankTransactions: true }, raw: true });
    const { connectionId, mainAccountId, savingsAccountId } = await setupTwoAccounts();

    await syncAccountWith({ connectionId, accountId: mainAccountId, transactions: [expenseLeg()] });
    await syncAccountWith({
      connectionId,
      accountId: savingsAccountId,
      transactions: [incomeLeg({ status: 'PDNG' })],
    });

    let [savingsTx] = await listTransactions({ accountId: savingsAccountId });
    expect(savingsTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);

    await syncAccountWith({
      connectionId,
      accountId: savingsAccountId,
      transactions: [incomeLeg({ status: 'BOOK' })],
    });

    const savingsTxs = await listTransactions({ accountId: savingsAccountId });
    expect(savingsTxs.length).toBe(1);
    [savingsTx] = savingsTxs;
    const [mainTx] = await listTransactions({ accountId: mainAccountId });

    expect(savingsTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
    expect(mainTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
    expect(mainTx!.transferId).toBeTruthy();
    expect(mainTx!.transferId).toBe(savingsTx!.transferId);
  });

  it('keeps auto-linked legs out of the synced-transactions event', async () => {
    const { connectionId, mainAccountId, savingsAccountId } = await setupTwoAccounts();

    await syncAccountWith({ connectionId, accountId: mainAccountId, transactions: [expenseLeg()] });

    const emitted: TransactionsSyncedPayload[] = [];
    const collect = (payload: TransactionsSyncedPayload) => emitted.push(payload);
    eventBus.on(DOMAIN_EVENTS.TRANSACTIONS_SYNCED, collect);

    try {
      await syncAccountWith({
        connectionId,
        accountId: savingsAccountId,
        transactions: [
          incomeLeg(),
          expenseLeg({
            amount: '42.10',
            entryReference: 'unrelated_grocery_001',
            counterpartyIban: null,
            remittanceInformation: ['GROCERY STORE'],
          }),
        ],
      });
    } finally {
      eventBus.off(DOMAIN_EVENTS.TRANSACTIONS_SYNCED, collect);
    }

    const [mainTx] = await listTransactions({ accountId: mainAccountId });
    const savingsTxs = await listTransactions({ accountId: savingsAccountId });
    const linkedLeg = savingsTxs.find((tx) => tx.transferNature === TRANSACTION_TRANSFER_NATURE.common_transfer);
    const unrelatedTx = savingsTxs.find((tx) => tx.transferNature === TRANSACTION_TRANSFER_NATURE.not_transfer);

    expect(linkedLeg).toBeDefined();
    expect(unrelatedTx).toBeDefined();
    expect(mainTx!.transferId).toBe(linkedLeg!.transferId);

    const emittedIds = emitted.flatMap((payload) => payload.transactionIds);
    expect(emittedIds).toContain(unrelatedTx!.id);
    expect(emittedIds).not.toContain(linkedLeg!.id);
    expect(emittedIds).not.toContain(mainTx!.id);
  });

  it('does not re-link a pair the user unlinked', async () => {
    const { connectionId, mainAccountId, savingsAccountId } = await setupTwoAccounts();

    await syncAccountWith({ connectionId, accountId: mainAccountId, transactions: [expenseLeg()] });
    await syncAccountWith({ connectionId, accountId: savingsAccountId, transactions: [incomeLeg()] });

    const [linkedMainTx] = await listTransactions({ accountId: mainAccountId });
    expect(linkedMainTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);

    await helpers.unlinkTransferTransactions({ transferIds: [linkedMainTx!.transferId!], raw: true });

    await syncAccountWith({
      connectionId,
      accountId: mainAccountId,
      transactions: [
        expenseLeg(),
        expenseLeg({
          amount: '42.10',
          bookingDate: '2024-03-16',
          valueDate: '2024-03-16',
          entryReference: 'unrelated_grocery_001',
          counterpartyIban: null,
          remittanceInformation: ['GROCERY STORE'],
        }),
      ],
    });

    const mainTxs = await listTransactions({ accountId: mainAccountId });
    const savingsTxs = await listTransactions({ accountId: savingsAccountId });

    expect(mainTxs.length).toBe(2);
    expect(savingsTxs.length).toBe(1);
    for (const tx of [...mainTxs, ...savingsTxs]) {
      expect(tx.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
    }
  });

  describe('manual accounts as candidates', () => {
    it('does not link a manual row when the setting is off', async () => {
      const { connectionId, savingsAccountId } = await setupTwoAccounts();
      const manualAccountId = await createManualAccount();
      await createManualExpense({ accountId: manualAccountId });

      await syncAccountWith({
        connectionId,
        accountId: savingsAccountId,
        transactions: [incomeLeg({ counterpartyIban: null })],
      });

      const [manualTx] = await listTransactions({ accountId: manualAccountId });
      const [savingsTx] = await listTransactions({ accountId: savingsAccountId });

      expect(manualTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
      expect(savingsTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
    });

    it('links a manual row to the synced leg when the setting is on', async () => {
      const { connectionId, savingsAccountId } = await setupTwoAccounts();
      const manualAccountId = await createManualAccount();
      await createManualExpense({ accountId: manualAccountId });
      await helpers.patchUserSettings({ patch: { matchTransfersWithManualAccounts: true }, raw: true });

      await syncAccountWith({
        connectionId,
        accountId: savingsAccountId,
        transactions: [incomeLeg({ counterpartyIban: null })],
      });

      const [manualTx] = await listTransactions({ accountId: manualAccountId });
      const [savingsTx] = await listTransactions({ accountId: savingsAccountId });

      expect(manualTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
      expect(savingsTx!.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.common_transfer);
      expect(manualTx!.transferId).toBeTruthy();
      expect(manualTx!.transferId).toBe(savingsTx!.transferId);
    });

    it('does not link when two manual rows of the same amount compete', async () => {
      const { connectionId, savingsAccountId } = await setupTwoAccounts();
      const manualAccountId = await createManualAccount();
      await createManualExpense({ accountId: manualAccountId, note: 'MOVED TO SAVINGS A' });
      await createManualExpense({ accountId: manualAccountId, note: 'MOVED TO SAVINGS B' });
      await helpers.patchUserSettings({ patch: { matchTransfersWithManualAccounts: true }, raw: true });

      await syncAccountWith({
        connectionId,
        accountId: savingsAccountId,
        transactions: [incomeLeg({ counterpartyIban: null })],
      });

      const manualTxs = await listTransactions({ accountId: manualAccountId });
      const savingsTxs = await listTransactions({ accountId: savingsAccountId });

      expect(manualTxs.length).toBe(2);
      for (const tx of [...manualTxs, ...savingsTxs]) {
        expect(tx.transferNature).toBe(TRANSACTION_TRANSFER_NATURE.not_transfer);
      }
    });
  });

  describe('Walutomat legs', () => {
    const WALUTOMAT_IBAN = 'PL82102040270000130207676648';

    function walutomatItem({
      operationType,
      amount,
      ownIbanKey,
      ownIban,
      transactionId,
    }: {
      operationType: 'PAYIN' | 'PAYOUT';
      amount: string;
      ownIbanKey: 'sourceAccount' | 'destinationAccount';
      ownIban: string;
      transactionId: string;
    }): HistoryItem {
      return {
        historyItemId: Number(transactionId.replace(/\D/g, '')),
        transactionId,
        ts: '2024-03-15T13:48:20.949Z',
        operationAmount: operationType === 'PAYIN' ? amount : `-${amount}`,
        balanceAfter: '0.00',
        currency: 'EUR',
        operationType,
        operationDetailedType: operationType,
        operationDetails: [{ key: ownIbanKey, value: ownIban }],
      };
    }

    it('links Walutomat PAYIN/PAYOUT to bank legs that sync after Walutomat', async () => {
      const { connectionId, mainAccountId, savingsAccountId } = await setupTwoAccounts();

      const { connectionId: walutomatConnectionId } = await helpers.walutomat.pair();
      global.mswMockServer.use(
        getWalutomatHistoryMock({
          response: [
            walutomatItem({
              operationType: 'PAYIN',
              amount: '3000.00',
              ownIbanKey: 'sourceAccount',
              ownIban: MAIN_ACCOUNT_IBAN,
              transactionId: 'payin-1',
            }),
            walutomatItem({
              operationType: 'PAYOUT',
              amount: '2637.65',
              ownIbanKey: 'destinationAccount',
              ownIban: SAVINGS_ACCOUNT_IBAN,
              transactionId: 'payout-2',
            }),
          ],
        }),
        getWalutomatBalancesMock(),
      );
      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: walutomatConnectionId,
        accountExternalIds: ['wallet-eur'],
        raw: true,
      });

      await syncAccountWith({
        connectionId,
        accountId: mainAccountId,
        transactions: [expenseLeg({ amount: '3000.00', counterpartyIban: WALUTOMAT_IBAN })],
      });
      const emitted: TransactionsSyncedPayload[] = [];
      const collect = (payload: TransactionsSyncedPayload) => emitted.push(payload);
      eventBus.on(DOMAIN_EVENTS.TRANSACTIONS_SYNCED, collect);
      try {
        await syncAccountWith({
          connectionId,
          accountId: savingsAccountId,
          transactions: [incomeLeg({ amount: '2637.65', counterpartyIban: WALUTOMAT_IBAN })],
        });
      } finally {
        eventBus.off(DOMAIN_EVENTS.TRANSACTIONS_SYNCED, collect);
      }

      const walutomatTxs = await listTransactions({ accountId: syncedAccounts[0]!.id });
      const payin = walutomatTxs.find((tx) => tx.transactionType === TRANSACTION_TYPES.income);
      const payout = walutomatTxs.find((tx) => tx.transactionType === TRANSACTION_TYPES.expense);
      const [mainTx] = await listTransactions({ accountId: mainAccountId });
      const [savingsTx] = await listTransactions({ accountId: savingsAccountId });

      expect(mainTx!.transferId).toBeTruthy();
      expect(mainTx!.transferId).toBe(payin!.transferId);
      expect(savingsTx!.transferId).toBeTruthy();
      expect(savingsTx!.transferId).toBe(payout!.transferId);
      expect(emitted.flatMap((payload) => payload.transactionIds)).not.toContain(savingsTx!.id);
    });

    async function connectWalutomatWithPayin(): Promise<RecordId> {
      const { connectionId: walutomatConnectionId } = await helpers.walutomat.pair();
      global.mswMockServer.use(
        getWalutomatHistoryMock({
          response: [
            walutomatItem({
              operationType: 'PAYIN',
              amount: '3000.00',
              ownIbanKey: 'sourceAccount',
              ownIban: MAIN_ACCOUNT_IBAN,
              transactionId: 'payin-1',
            }),
          ],
        }),
        getWalutomatBalancesMock(),
      );
      const { syncedAccounts } = await helpers.bankDataProviders.connectSelectedAccounts({
        connectionId: walutomatConnectionId,
        accountExternalIds: ['wallet-eur'],
        raw: true,
      });

      return syncedAccounts[0]!.id;
    }

    it('does not link a freshly synced bank leg while older same-amount rows also fit', async () => {
      const { connectionId, mainAccountId } = await setupTwoAccounts();
      const olderLegs = [
        expenseLeg({ amount: '3000.00', counterpartyIban: WALUTOMAT_IBAN, entryReference: 'walutomat_out_a' }),
        expenseLeg({ amount: '3000.00', counterpartyIban: WALUTOMAT_IBAN, entryReference: 'walutomat_out_b' }),
      ];
      await syncAccountWith({ connectionId, accountId: mainAccountId, transactions: olderLegs });

      const walutomatAccountId = await connectWalutomatWithPayin();

      await syncAccountWith({
        connectionId,
        accountId: mainAccountId,
        transactions: [
          ...olderLegs,
          expenseLeg({ amount: '3000.00', counterpartyIban: WALUTOMAT_IBAN, entryReference: 'walutomat_out_c' }),
        ],
      });

      const [payin] = await listTransactions({ accountId: walutomatAccountId });
      const mainTxs = await listTransactions({ accountId: mainAccountId });

      expect(mainTxs.length).toBe(3);
      for (const tx of [payin!, ...mainTxs]) {
        expect(tx.transferId).toBeNull();
      }
    });

    it('does not re-link a Walutomat pair the user unlinked', async () => {
      const { connectionId, mainAccountId } = await setupTwoAccounts();
      const walutomatAccountId = await connectWalutomatWithPayin();
      const bankLeg = expenseLeg({ amount: '3000.00', counterpartyIban: WALUTOMAT_IBAN });

      await syncAccountWith({ connectionId, accountId: mainAccountId, transactions: [bankLeg] });

      const [linkedMainTx] = await listTransactions({ accountId: mainAccountId });
      expect(linkedMainTx!.transferId).toBeTruthy();

      await helpers.unlinkTransferTransactions({ transferIds: [linkedMainTx!.transferId!], raw: true });

      await syncAccountWith({
        connectionId,
        accountId: mainAccountId,
        transactions: [
          bankLeg,
          expenseLeg({
            amount: '42.10',
            bookingDate: '2024-03-16',
            valueDate: '2024-03-16',
            entryReference: 'unrelated_grocery_001',
            counterpartyIban: null,
            remittanceInformation: ['GROCERY STORE'],
          }),
        ],
      });

      const [payin] = await listTransactions({ accountId: walutomatAccountId });
      const mainTxs = await listTransactions({ accountId: mainAccountId });

      expect(mainTxs.length).toBe(2);
      for (const tx of [payin!, ...mainTxs]) {
        expect(tx.transferId).toBeNull();
      }
    });
  });
});
