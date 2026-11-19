import { TRANSACTION_TYPES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { beforeEach, describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

type Row = Record<string, unknown>;

async function exportWithEdit({ name, edit }: { name: string; edit: (rows: Row[]) => void }): Promise<string> {
  const exported = await helpers.exportBackup();
  const { files } = helpers.parseBackupArchive({ buffer: exported.body });
  const path = `data/${name}.json`;
  const rows = JSON.parse(files.get(path)!.toString('utf8')) as Row[];
  edit(rows);
  files.set(path, Buffer.from(JSON.stringify(rows)));
  return helpers.repackBackup({ files });
}

describe('Restore of a format version 4 archive', () => {
  beforeEach(() => helpers.resetBackupRateLimits());

  it('rejects an amount the column cannot hold with a 422 and keeps the data', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ initialBalance: 100 }),
      raw: true,
    });
    const fileContent = await exportWithEdit({
      name: 'accounts',
      edit: (rows) => {
        rows[0]!.currentBalance = '1e30';
      },
    });

    const restore = await helpers.restoreBackup({ fileContent });

    expect(restore.statusCode).toBe(422);
    expect(restore.message).toBe(
      t({
        key: 'backup.restore.errors.amountNotCents',
        variables: { path: 'data/accounts.json (currentBalance)', value: JSON.stringify('1e30') },
      }),
    );
    expect(Number((await helpers.getAccount({ id: account.id, raw: true })).currentBalance)).toBe(100);
  });

  it('rejects an amount past the minor-unit range of its currency with a 422 and keeps the data', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ initialBalance: 100 }),
      raw: true,
    });
    const [created] = await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 10,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });
    const fileContent = await exportWithEdit({
      name: 'transactions',
      edit: (rows) => {
        for (const row of rows) row.amount = '100000000000000';
      },
    });

    const restore = await helpers.restoreBackup({ fileContent });

    expect(restore.statusCode).toBe(422);
    expect(restore.message).toBe(
      t({
        key: 'currencies.amountTooLarge',
        variables: { code: account.currencyCode, max: Number.MAX_SAFE_INTEGER / 100 },
      }),
    );
    const transactions = (await helpers.getTransactions({ raw: true }))!;
    expect(Number(transactions.find((tx) => tx.id === created!.id)!.amount)).toBe(10);
  });

  it('rounds an amount with more decimals than its currency to the currency decimals', async () => {
    await helpers.createAccount({ payload: helpers.buildAccountPayload({ initialBalance: 100 }), raw: true });
    const fileContent = await exportWithEdit({
      name: 'accounts',
      edit: (rows) => {
        rows[0]!.currentBalance = '100.125';
      },
    });

    await helpers.restoreBackupAndWait({ fileContent });

    const [restored] = helpers.backupRows({ archive: await helpers.exportParsedBackup(), name: 'accounts' });
    helpers.expectDecimal({ actual: restored!.currentBalance, expected: '100.13' });
  });

  it('round-trips a KWD ledger with 3-decimal amounts through export and restore', async () => {
    await helpers.addUserCurrencies({ currencyCodes: ['KWD'], raw: true });
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ currencyCode: 'KWD', initialBalance: 100.555 }),
      raw: true,
    });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({
        accountId: account.id,
        amount: 1.234,
        transactionType: TRANSACTION_TYPES.expense,
      }),
      raw: true,
    });

    const firstExport = await helpers.exportBackup();
    const first = helpers.parseBackupArchive({ buffer: firstExport.body });
    helpers.expectDecimal({
      actual: helpers.backupRows({ archive: first, name: 'accounts' })[0]!.initialBalance,
      expected: '100.555',
    });
    helpers.expectDecimal({
      actual: helpers.backupRows({ archive: first, name: 'accounts' })[0]!.currentBalance,
      expected: '99.321',
    });
    helpers.expectDecimal({
      actual: helpers.backupRows({ archive: first, name: 'transactions' })[0]!.amount,
      expected: '1.234',
    });

    await helpers.restoreBackupAndWait({ fileContent: firstExport.body.toString('base64') });

    const [restored] = await helpers.getAccounts();
    expect(restored!.initialBalance).toBe(100.555);
    expect(restored!.currentBalance).toBe(99.321);
    const [transaction] = (await helpers.getTransactions({ raw: true }))!;
    expect(Number(transaction!.amount)).toBe(1.234);

    const second = await helpers.exportParsedBackup();
    for (const name of ['accounts', 'transactions', 'balances']) {
      expect({ name, rows: helpers.canonicalBackupRows({ rows: second.readData({ name }) }) }).toEqual({
        name,
        rows: helpers.canonicalBackupRows({ rows: first.readData({ name }) }),
      });
    }
  });
});
