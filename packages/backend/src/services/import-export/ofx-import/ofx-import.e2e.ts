import { ACCOUNT_TYPES, ImportSource, OFX_MAX_FILE_BYTES, PAYMENT_TYPES, type RecordId } from '@bt/shared/types';
import { t } from '@i18n/index';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { asUser, provisionSecondUserWithBaseCurrency } from '@tests/helpers/share';
import { format, startOfDay, subDays } from 'date-fns';

const createNewMapping = ({
  upload,
  name,
  currentBalance = null,
}: {
  upload: Awaited<ReturnType<typeof helpers.uploadOfxFixture>>;
  name: string;
  currentBalance?: number | null;
}) => {
  const account = upload.result.accounts[0]!;
  return {
    [account.sourceAccountKey]: {
      action: 'create-new' as const,
      name,
      currencyCode: account.currency,
      currentBalance,
    },
  };
};

const runImport = async (payload: Parameters<typeof helpers.executeOfx>[0]['payload']) => {
  const { jobId } = await helpers.executeOfx({ payload, raw: true });
  expect(jobId).toMatch(/^ofx-import-/);

  const firstStatus = await helpers.getOfxImportStatus({ jobId, raw: true });
  expect(firstStatus.jobId).toBe(jobId);
  expect(['queued', 'running', 'completed', 'failed']).toContain(firstStatus.status);

  return helpers.waitForOfxImportCompletion({ jobId });
};

describe('OFX import HTTP endpoints', () => {
  describe('upload', () => {
    it('parses a sanitized bank fixture and returns an opaque upload', async () => {
      const result = await helpers.uploadOfx({ file: helpers.loadOfxFixture({ filename: 'bank-v1.ofx' }) });

      expect(result.statusCode).toBe(200);
      expect(result.response?.uploadId).toEqual(expect.any(String));
      expect(result.response?.result).toMatchObject({
        formatVersion: '1.x',
        financialInstitutionName: 'Example Bank',
        accounts: [{ maskedDisplayName: expect.stringContaining('2222'), currency: 'USD', transactionCount: 2 }],
      });
      expect(result.response?.result.accounts[0]?.sourceAccountKey).not.toContain('000011112222');
      expect(result.response?.result.warnings).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: 'date-user-fallback', count: 1 }),
          expect.objectContaining({ code: 'fitid-missing', count: 1 }),
        ]),
      );
    });

    it('rejects empty and malformed uploads through the HTTP error envelope', async () => {
      const empty = await helpers.uploadOfx({ file: Buffer.alloc(0) });
      expect(empty.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(empty.errorMessage).toBe(t({ key: 'ofxImport.noFileUploaded', locale: 'en' }));

      const malformed = await helpers.uploadOfx({ file: Buffer.from('not an OFX document', 'utf8') });
      expect(malformed.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(malformed.errorMessage).toBe(t({ key: 'ofxImport.errors.headerMissing', locale: 'en' }));
    });

    it('translates parse errors into the request locale', async () => {
      const result = await helpers.uploadOfx({
        file: Buffer.from(
          'OFXHEADER:100\nDATA:OFXSGML\nVERSION:102\nENCODING:EBCDIC\nCHARSET:500\nCOMPRESSION:NONE\n\n<OFX></OFX>',
        ),
        locale: 'uk',
      });
      const variables = { encoding: 'EBCDIC', charset: '500' };

      expect(result.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(result.errorMessage).toBe(t({ key: 'ofxImport.errors.unsupportedEncoding', variables, locale: 'uk' }));
      expect(result.errorMessage).not.toBe(t({ key: 'ofxImport.errors.unsupportedEncoding', variables, locale: 'en' }));
    });

    it('rejects the wrong media type and files over the upload limit', async () => {
      const wrongType = await helpers.uploadOfx({
        file: helpers.loadOfxFixture({ filename: 'bank-v1.ofx' }),
        contentType: 'text/plain',
      });
      expect(wrongType.statusCode).toBe(ERROR_CODES.ValidationError);

      const oversized = await helpers.uploadOfx({ file: Buffer.alloc(OFX_MAX_FILE_BYTES + 1) });
      expect(oversized.statusCode).toBe(413);
    });
  });

  it('returns not found for an unknown job status', async () => {
    const response = await helpers.getOfxImportStatus({ jobId: 'ofx-import-unknown' });
    expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
  });

  it('creates an account and imports payee, stable ID, direction, payment type, and requested balance', async () => {
    const accountName = `OFX created ${Date.now()}`;
    const upload = await helpers.uploadOfxFixture({ filename: 'bank-v1.ofx' });
    const progress = await runImport({
      uploadId: upload.uploadId,
      accountMapping: createNewMapping({ upload, name: accountName, currentBalance: 250 }),
      skipDuplicateIndices: [],
      recalculateBalance: false,
    });
    helpers.expectOfxCompleted(progress);

    expect(progress.summary).toMatchObject({
      accountsCreated: 1,
      accountsLinked: 0,
      accountsSkipped: 0,
      payeesCreated: 2,
      transactionsImported: 2,
      duplicatesSkipped: 0,
      errors: [],
    });

    const account = (await helpers.getAccounts()).find((candidate) => candidate.name === accountName)!;
    expect(account).toBeDefined();
    expect(Number(account.currentBalance)).toBe(250);

    const transactions = await helpers.getTransactions({ accountIds: [account.id], raw: true });
    const purchase = transactions.find((transaction) => transaction.note === 'Sanitized purchase')!;
    expect(purchase).toMatchObject({
      amount: 12.34,
      transactionType: 'expense',
      paymentType: PAYMENT_TYPES.debitCard,
      accountId: account.id,
    });
    expect(purchase.originalId).toEqual(expect.any(String));
    expect(purchase.originalId).not.toContain('tx-1');

    const payees = await helpers.listPayees({ accountId: account.id, raw: true });
    expect(payees.map((payee) => payee.name)).toEqual(expect.arrayContaining(['Example Shop', 'Example Employer']));
    expect(purchase.payeeId).toBe(payees.find((payee) => payee.name === 'Example Shop')?.id);

    const history = await helpers.getBatchesHistory({ raw: true });
    expect(history.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          batchId: progress.summary.batchId,
          source: ImportSource.ofx,
          transactionCount: 2,
          createdAccountCount: 1,
        }),
      ]),
    );

    await helpers.deleteImportBatch({ batchId: progress.summary.batchId, raw: true });
    expect((await helpers.getAccounts()).some((candidate) => candidate.id === account.id)).toBe(false);
  });

  it('links an existing account, detects a repeated file, and skips it on a second execution', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: `OFX linked ${Date.now()}`, currencyCode: 'EUR' }),
      raw: true,
    });

    const firstUpload = await helpers.uploadOfxFixture({ filename: 'bank-v2.ofx' });
    const sourceKey = firstUpload.result.accounts[0]!.sourceAccountKey;
    const accountMapping = { [sourceKey]: { action: 'link-existing' as const, accountId: account.id } };
    const first = await runImport({ uploadId: firstUpload.uploadId, accountMapping, skipDuplicateIndices: [] });
    helpers.expectOfxCompleted(first);
    expect(first.summary).toMatchObject({ accountsLinked: 1, transactionsImported: 1, duplicatesSkipped: 0 });

    const secondUpload = await helpers.uploadOfxFixture({ filename: 'bank-v2.ofx' });
    const duplicateResult = await helpers.detectOfxDuplicates({
      payload: { uploadId: secondUpload.uploadId, accountMapping },
      raw: true,
    });
    expect(duplicateResult.duplicates).toHaveLength(1);
    expect(duplicateResult.duplicates[0]).toMatchObject({ matchType: 'originalId', confidence: 100 });

    // Do not trust the client-provided skip list for idempotency. The execute
    // endpoint must recheck stable IDs before it writes.
    const second = await runImport({ uploadId: secondUpload.uploadId, accountMapping, skipDuplicateIndices: [] });
    helpers.expectOfxCompleted(second);
    expect(second.summary).toMatchObject({ transactionsImported: 0, duplicatesSkipped: 1, errors: [] });

    const transactions = await helpers.getTransactions({ accountIds: [account.id], raw: true });
    expect(transactions).toHaveLength(1);

    const history = await helpers.getBatchesHistory({ raw: true });
    expect(history.totalCount).toBe(1);
    expect(history.items.map((item) => item.batchId)).toEqual([first.summary.batchId]);
  });

  it('treats a trashed row as already imported in both the preview and the re-import', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: `OFX trashed ${Date.now()}`, currencyCode: 'EUR' }),
      raw: true,
    });

    const firstUpload = await helpers.uploadOfxFixture({ filename: 'bank-v2.ofx' });
    const sourceKey = firstUpload.result.accounts[0]!.sourceAccountKey;
    const accountMapping = { [sourceKey]: { action: 'link-existing' as const, accountId: account.id } };
    const first = await runImport({ uploadId: firstUpload.uploadId, accountMapping, skipDuplicateIndices: [] });
    helpers.expectOfxCompleted(first);

    const [imported] = await helpers.getTransactions({ accountIds: [account.id], raw: true });
    expect((await helpers.deleteTransaction({ id: imported!.id })).statusCode).toBe(200);
    const balanceAfterTrash = (await helpers.getAccount({ id: account.id, raw: true })).currentBalance;

    const secondUpload = await helpers.uploadOfxFixture({ filename: 'bank-v2.ofx' });
    const duplicateResult = await helpers.detectOfxDuplicates({
      payload: { uploadId: secondUpload.uploadId, accountMapping },
      raw: true,
    });
    expect(duplicateResult.duplicates).toHaveLength(1);
    expect(duplicateResult.duplicates[0]).toMatchObject({ matchType: 'originalId' });

    const second = await runImport({ uploadId: secondUpload.uploadId, accountMapping, skipDuplicateIndices: [] });
    helpers.expectOfxCompleted(second);
    expect(second.summary).toMatchObject({ transactionsImported: 0, duplicatesSkipped: 1, errors: [] });

    expect(await helpers.getTransactions({ accountIds: [account.id], raw: true })).toHaveLength(0);
    expect((await helpers.getTrash({ raw: true })).map((entry) => entry.id)).toEqual([imported!.id]);
    expect((await helpers.getAccount({ id: account.id, raw: true })).currentBalance).toBe(balanceAfterTrash);
  });

  it('restores a linked non-base-currency account in both currencies when a recalc-off import is undone', async () => {
    // Non-zero opening balance plus a seeded row keeps every ref balance non-zero.
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({
        name: `OFX undo ${Date.now()}`,
        currencyCode: 'EUR',
        initialBalance: 1000,
      }),
      raw: true,
    });
    await helpers.createTransaction({
      payload: helpers.buildTransactionPayload({ accountId: account.id, amount: 500, time: '2024-06-10T12:00:00Z' }),
      raw: true,
    });
    const before = await helpers.getAccount({ id: account.id, raw: true });

    const upload = await helpers.uploadOfxFixture({ filename: 'bank-v2.ofx' });
    const sourceKey = upload.result.accounts[0]!.sourceAccountKey;
    const progress = await runImport({
      uploadId: upload.uploadId,
      accountMapping: { [sourceKey]: { action: 'link-existing', accountId: account.id } },
      skipDuplicateIndices: [],
      recalculateBalance: false,
    });
    helpers.expectOfxCompleted(progress);
    expect(progress.summary).toMatchObject({ accountsLinked: 1, transactionsImported: 1, errors: [] });
    const { batchId } = progress.summary;

    const afterImport = await helpers.getAccount({ id: account.id, raw: true });
    expect(afterImport.currentBalance).toBe(before.currentBalance);
    expect(afterImport.initialBalance).not.toBe(before.initialBalance);

    const result = await helpers.deleteImportBatch({ batchId, raw: true });
    expect(result.deletedCount).toBe(1);
    expect(await helpers.getTransactions({ batchId, raw: true })).toHaveLength(0);

    expect(await helpers.getAccount({ id: account.id, raw: true })).toMatchObject({
      id: account.id,
      currentBalance: before.currentBalance,
      initialBalance: before.initialBalance,
      refCurrentBalance: before.refCurrentBalance,
      refInitialBalance: before.refInitialBalance,
    });
  });

  it('honors skip mappings without creating an account or transaction', async () => {
    const upload = await helpers.uploadOfxFixture({ filename: 'card.qfx' });
    const sourceKey = upload.result.accounts[0]!.sourceAccountKey;
    const progress = await runImport({
      uploadId: upload.uploadId,
      accountMapping: { [sourceKey]: { action: 'skip' } },
      skipDuplicateIndices: [],
    });
    helpers.expectOfxCompleted(progress);
    expect(progress.summary).toMatchObject({
      accountsCreated: 0,
      accountsLinked: 0,
      accountsSkipped: 1,
      transactionsImported: 0,
      errors: [],
    });
  });

  it('rejects execution when a linked account has another currency', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: `OFX wrong currency ${Date.now()}`, currencyCode: 'EUR' }),
      raw: true,
    });
    const upload = await helpers.uploadOfxFixture({ filename: 'bank-v1.ofx' });
    const source = upload.result.accounts[0]!;
    const response = await helpers.executeOfx({
      payload: {
        uploadId: upload.uploadId,
        accountMapping: { [source.sourceAccountKey]: { action: 'link-existing', accountId: account.id } },
      },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    expect((response.body.response as unknown as helpers.ErrorResponse).message).toBe(
      t({
        key: 'ofxImport.crossCurrencyLink',
        variables: { account: source.maskedDisplayName, currency: source.currency },
        locale: 'en',
      }),
    );
  });

  it('does not let another user import into an account they do not own', async () => {
    const ownerAccount = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: `OFX owner ${Date.now()}`, currencyCode: 'USD' }),
      raw: true,
    });
    const otherUser = await provisionSecondUserWithBaseCurrency({ currencyCode: 'USD' });

    const { response, source } = await asUser({
      cookies: otherUser.cookies,
      fn: async () => {
        const upload = await helpers.uploadOfxFixture({ filename: 'bank-v1.ofx' });
        const sourceAccount = upload.result.accounts[0]!;
        const executeResponse = await helpers.executeOfx({
          payload: {
            uploadId: upload.uploadId,
            accountMapping: {
              [sourceAccount.sourceAccountKey]: { action: 'link-existing', accountId: ownerAccount.id },
            },
          },
        });
        return { response: executeResponse, source: sourceAccount };
      },
    });

    expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
    expect((response.body.response as unknown as helpers.ErrorResponse).message).toBe(
      t({
        key: 'ofxImport.linkedAccountNotFound',
        variables: { account: source.maskedDisplayName, currency: source.currency },
        locale: 'en',
      }),
    );
  });
});

const TODAY = startOfDay(new Date());
const TODAY_KEY = format(TODAY, 'yyyy-MM-dd');

type OfxRow = { daysAgo: number; amount: number; time?: string };

const ofxDate = ({ daysAgo, time = '120000' }: { daysAgo: number; time?: string }) =>
  `${format(subDays(TODAY, daysAgo), 'yyyyMMdd')}${time}[0:GMT]`;

const buildOfx = ({ rows }: { rows: OfxRow[] }) =>
  Buffer.from(
    [
      'OFXHEADER:100',
      'DATA:OFXSGML',
      'VERSION:102',
      'ENCODING:USASCII',
      'CHARSET:1252',
      'COMPRESSION:NONE',
      '',
      '<OFX>',
      '<SIGNONMSGSRSV1><SONRS><FI><ORG>Seam Bank<FID>2000</FI></SONRS></SIGNONMSGSRSV1>',
      '<BANKMSGSRSV1><STMTTRNRS><STMTRS>',
      '<CURDEF>USD',
      '<BANKACCTFROM><BANKID>000003<ACCTID>000044445555<ACCTTYPE>CHECKING</BANKACCTFROM>',
      '<BANKTRANLIST>',
      ...rows.map(
        (row, index) =>
          `<STMTTRN><TRNTYPE>${row.amount < 0 ? 'DEBIT' : 'CREDIT'}<DTPOSTED>${ofxDate(row)}<TRNAMT>${row.amount.toFixed(2)}<FITID>seam-${index}<NAME>Row ${index}</STMTTRN>`,
      ),
      '</BANKTRANLIST>',
      `<LEDGERBAL><BALAMT>0.00<DTASOF>${ofxDate({ daysAgo: 0 })}</LEDGERBAL>`,
      '</STMTRS></STMTTRNRS></BANKMSGSRSV1>',
      '</OFX>',
    ].join('\n'),
  );

const SPANNING_OFX_ROWS: OfxRow[] = [
  { daysAgo: 8, amount: -40 },
  { daysAgo: 6, amount: 15 },
  { daysAgo: 3, amount: -25 },
  { daysAgo: 0, amount: -7, time: '000000' },
  { daysAgo: 0, amount: 9, time: '060000' },
];

const importOfxInto = async ({
  accountId,
  rows,
  recalculateBalance,
}: {
  accountId: string;
  rows: OfxRow[];
  recalculateBalance?: boolean;
}) => {
  const upload = await helpers.uploadOfx({ file: buildOfx({ rows }) });
  expect(upload.statusCode).toBe(200);
  const sourceKey = upload.response!.result.accounts[0]!.sourceAccountKey;
  return runImport({
    uploadId: upload.response!.uploadId,
    accountMapping: { [sourceKey]: { action: 'link-existing', accountId } },
    skipDuplicateIndices: [],
    recalculateBalance,
  });
};

describe('OFX import into an account with a bank seam', () => {
  it('imports the rows before the seam as manual history and skips the rest', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await helpers.createSeamAccount();
        const before = await helpers.snapshotSeamAccount({ accountId: account.id });

        const progress = await importOfxInto({ accountId: account.id, rows: SPANNING_OFX_ROWS });
        helpers.expectOfxCompleted(progress);
        expect(progress.summary).toMatchObject({ transactionsImported: 3, skippedAfterBankSeam: 2, errors: [] });

        const created = await helpers.getTransactions({ batchId: progress.summary.batchId, raw: true });
        expect(created).toHaveLength(3);
        expect(created.every((tx) => tx.accountType === ACCOUNT_TYPES.system)).toBe(true);
        expect(created.every((tx) => new Date(tx.time).toISOString().slice(0, 10) < TODAY_KEY)).toBe(true);

        await helpers.expectImportOnlyMovedOpening({
          accountId: account.id,
          before,
          shift: helpers.SPANNING_PRE_SEAM_NET_OUT,
        });
      },
    });
  });

  it('still rejects a bank-linked account without a seam', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await helpers.createSeamAccount();
        await helpers.dropSeam({ accountId: account.id });
        const before = await helpers.snapshotSeamAccount({ accountId: account.id });

        const progress = await importOfxInto({ accountId: account.id, rows: SPANNING_OFX_ROWS });

        expect(progress.status).toBe('failed');
        expect(await helpers.snapshotSeamAccount({ accountId: account.id })).toEqual(before);
        const rows = await helpers.getTransactions({ accountIds: [account.id], raw: true });
        expect(rows.map((tx) => tx.note)).toEqual(['Manual row']);
      },
    });
  });

  it('undoing the batch while linked returns the account to its pre-import state', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await helpers.createSeamAccount();
        const before = await helpers.snapshotSeamAccount({ accountId: account.id });
        const progress = await importOfxInto({ accountId: account.id, rows: SPANNING_OFX_ROWS });
        helpers.expectOfxCompleted(progress);

        const result = await helpers.deleteImportBatch({ batchId: progress.summary.batchId, raw: true });
        expect(result.deletedCount).toBe(3);

        expect(await helpers.snapshotSeamAccount({ accountId: account.id })).toEqual(before);
      },
    });
  });

  it('ignores recalculateBalance for the seam account', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await helpers.createSeamAccount();
        const before = await helpers.snapshotSeamAccount({ accountId: account.id });

        const progress = await importOfxInto({
          accountId: account.id,
          rows: SPANNING_OFX_ROWS,
          recalculateBalance: true,
        });
        helpers.expectOfxCompleted(progress);
        expect(progress.summary).toMatchObject({ transactionsImported: 3, skippedAfterBankSeam: 2, errors: [] });
        expect(progress.summary.accountBalanceChanges).toEqual([
          expect.objectContaining({ accountId: account.id, delta: 0, movedCount: 0, historicalCount: 3 }),
        ]);

        await helpers.expectImportOnlyMovedOpening({
          accountId: account.id,
          before,
          shift: helpers.SPANNING_PRE_SEAM_NET_OUT,
        });
      },
    });
  });

  it('leaves a planned row on the seam account unmerged while the same row confirms a plan on a manual account', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const [category] = await helpers.getCategoriesList();
        const manualAccount = await helpers.createAccount({
          payload: helpers.buildAccountPayload({ name: 'Wallet', currencyCode: 'USD', initialBalance: 1000 }),
          raw: true,
        });
        const seamAccount = await helpers.createSeamAccount();
        const planOn = async ({ accountId }: { accountId: string }) =>
          (
            await helpers.createPlannedTransaction({
              payload: {
                accountId: accountId as RecordId,
                amount: 25,
                time: subDays(TODAY, 2).toISOString(),
                categoryId: category!.id as RecordId,
              },
              raw: true,
            })
          )[0]!;
        const manualPlan = await planOn({ accountId: manualAccount.id });
        const seamPlan = await planOn({ accountId: seamAccount.id });
        const rows: OfxRow[] = [{ daysAgo: 3, amount: -25 }];

        const control = await importOfxInto({ accountId: manualAccount.id, rows });
        helpers.expectOfxCompleted(control);
        expect(control.summary).toMatchObject({ merged: 1, transactionsImported: 0 });
        const manualRows = await helpers.getTransactions({ accountIds: [manualAccount.id], raw: true });
        expect(manualRows.find((tx) => tx.id === manualPlan.id)!.isPlanned).toBe(false);

        const before = await helpers.snapshotSeamAccount({ accountId: seamAccount.id });
        const progress = await importOfxInto({ accountId: seamAccount.id, rows });
        helpers.expectOfxCompleted(progress);
        expect(progress.summary).toMatchObject({ merged: 0, transactionsImported: 1, skippedAfterBankSeam: 0 });

        const seamRows = await helpers.getTransactions({ accountIds: [seamAccount.id], raw: true });
        expect(seamRows.find((tx) => tx.id === seamPlan.id)!.isPlanned).toBe(true);
        expect(progress.summary.newTransactionIds).toHaveLength(1);
        expect(progress.summary.newTransactionIds[0]).not.toBe(seamPlan.id);
        await helpers.expectImportOnlyMovedOpening({ accountId: seamAccount.id, before, shift: 25 });
      },
    });
  });

  it('undoing the batch after unlinking keeps the current balance and restores the opening balance', async () => {
    await helpers.asBaseCurrencyUser({
      currencyCode: 'USD',
      fn: async () => {
        const account = await helpers.createSeamAccount();
        const before = await helpers.snapshotSeamAccount({ accountId: account.id });
        const progress = await importOfxInto({ accountId: account.id, rows: SPANNING_OFX_ROWS });
        helpers.expectOfxCompleted(progress);
        await helpers.unlinkAccountFromBankConnection({ id: account.id, raw: true });
        const unlinked = await helpers.snapshotSeamAccount({ accountId: account.id });

        const result = await helpers.deleteImportBatch({ batchId: progress.summary.batchId, raw: true });
        expect(result.deletedCount).toBe(3);

        const after = await helpers.snapshotSeamAccount({ accountId: account.id });
        expect(after.account.currentBalance).toBe(unlinked.account.currentBalance);
        expect(after.account.initialBalance).toBe(before.account.initialBalance);
        expect(after.account.refInitialBalance).toBe(before.account.refInitialBalance);
      },
    });
  });
});
