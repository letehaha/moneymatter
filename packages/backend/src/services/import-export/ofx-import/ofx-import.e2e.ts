import { ImportSource, OFX_MAX_FILE_BYTES, PAYMENT_TYPES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { asUser, provisionSecondUserWithBaseCurrency } from '@tests/helpers/share';

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

const buildPreciseOfx = ({ currency, amounts }: { currency: string; amounts: string[] }) =>
  Buffer.from(
    [
      'OFXHEADER:200',
      'DATA:OFXSGML',
      'VERSION:203',
      'ENCODING:UTF-8',
      'CHARSET:NONE',
      'COMPRESSION:NONE',
      '',
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<OFX>',
      '  <SIGNONMSGSRSV1><SONRS><FI><ORG>Example Bank</ORG><FID>1000</FID></FI></SONRS></SIGNONMSGSRSV1>',
      '  <BANKMSGSRSV1><STMTTRNRS><STMTRS>',
      `    <CURDEF>${currency}</CURDEF>`,
      '    <BANKACCTFROM><BANKID>000003</BANKID><ACCTID>999900004444</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>',
      '    <BANKTRANLIST>',
      ...amounts.map(
        (amount, index) =>
          `<STMTTRN><TRNTYPE>CREDIT</TRNTYPE><DTPOSTED>2026080${index + 1}103000</DTPOSTED><TRNAMT>${amount}</TRNAMT><FITID>precise-${index}</FITID><NAME>Row ${index}</NAME></STMTTRN>`,
      ),
      '    </BANKTRANLIST>',
      '    <LEDGERBAL><BALAMT>100.00</BALAMT><DTASOF>20260803103000</DTASOF></LEDGERBAL>',
      '  </STMTRS></STMTTRNRS></BANKMSGSRSV1>',
      '</OFX>',
    ].join('\n'),
  );

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
  describe('amounts at the account currency decimals', () => {
    const expectBalanceKept = async ({
      currencyCode,
      amount,
      storedAmount,
    }: {
      currencyCode: string;
      amount: string;
      storedAmount: number;
    }) => {
      await helpers.addUserCurrencies({ currencyCodes: [currencyCode], raw: true });
      const account = await helpers.createAccount({
        payload: helpers.buildAccountPayload({
          name: `OFX precise ${currencyCode}`,
          currencyCode,
          initialBalance: 100,
        }),
        raw: true,
      });

      const upload = await helpers.uploadOfx({
        file: buildPreciseOfx({ currency: currencyCode, amounts: [amount, amount] }),
      });
      expect(upload.response).not.toBeNull();
      const sourceKey = upload.response!.result.accounts[0]!.sourceAccountKey;

      const progress = await runImport({
        uploadId: upload.response!.uploadId,
        accountMapping: { [sourceKey]: { action: 'link-existing', accountId: account.id } },
        skipDuplicateIndices: [],
        recalculateBalance: false,
      });
      helpers.expectOfxCompleted(progress);
      expect(progress.summary).toMatchObject({ transactionsImported: 2, errors: [] });

      expect(Number((await helpers.getAccount({ id: account.id, raw: true })).currentBalance)).toBe(100);
      const stored = (await helpers.getTransactions({ raw: true })).filter((tx) => tx.accountId === account.id);
      expect(stored.map((tx) => tx.amount)).toEqual([storedAmount, storedAmount]);
    };

    it('keeps a 2-decimal balance when two 12.345 rows are stored as 12.35', async () => {
      await expectBalanceKept({ currencyCode: 'USD', amount: '12.345', storedAmount: 12.35 });
    });

    it('keeps a JPY balance when two 1500.5 rows are stored as 1501', async () => {
      await expectBalanceKept({ currencyCode: 'JPY', amount: '1500.5', storedAmount: 1501 });
    });
  });
});
