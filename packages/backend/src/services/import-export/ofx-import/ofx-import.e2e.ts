import { ImportSource, OFX_MAX_FILE_BYTES, PAYMENT_TYPES } from '@bt/shared/types';
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
      expect(empty.errorMessage).toMatch(/No file was uploaded/i);

      const malformed = await helpers.uploadOfx({ file: Buffer.from('not an OFX document', 'utf8') });
      expect(malformed.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(malformed.errorMessage).toBeTruthy();
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

  it('fails execution when a linked account has another currency', async () => {
    const account = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: `OFX wrong currency ${Date.now()}`, currencyCode: 'EUR' }),
      raw: true,
    });
    const upload = await helpers.uploadOfxFixture({ filename: 'bank-v1.ofx' });
    const sourceKey = upload.result.accounts[0]!.sourceAccountKey;
    const progress = await runImport({
      uploadId: upload.uploadId,
      accountMapping: { [sourceKey]: { action: 'link-existing', accountId: account.id } },
      skipDuplicateIndices: [],
    });

    expect(progress.status).toBe('failed');
    if (progress.status !== 'failed') throw new Error('unreachable');
    expect(progress.error).toMatch(/cannot be linked across currencies/i);
  });

  it('does not let another user import into an account they do not own', async () => {
    const ownerAccount = await helpers.createAccount({
      payload: helpers.buildAccountPayload({ name: `OFX owner ${Date.now()}`, currencyCode: 'USD' }),
      raw: true,
    });
    const otherUser = await provisionSecondUserWithBaseCurrency({ currencyCode: 'USD' });

    const progress = await asUser({
      cookies: otherUser.cookies,
      fn: async () => {
        const upload = await helpers.uploadOfxFixture({ filename: 'bank-v1.ofx' });
        const sourceKey = upload.result.accounts[0]!.sourceAccountKey;
        return runImport({
          uploadId: upload.uploadId,
          accountMapping: { [sourceKey]: { action: 'link-existing', accountId: ownerAccount.id } },
          skipDuplicateIndices: [],
        });
      },
    });

    expect(progress.status).toBe('failed');
    if (progress.status !== 'failed') throw new Error('unreachable');
    expect(progress.error).toMatch(/was not found/i);
  });
});
