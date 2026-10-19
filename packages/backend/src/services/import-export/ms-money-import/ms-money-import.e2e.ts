import { MS_MONEY_MAX_FILE_BYTES } from '@bt/shared/types';
import { t } from '@i18n/index';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import * as helpers from '@tests/helpers';
import { asUser, provisionSecondUserWithBaseCurrency, withoutSession } from '@tests/helpers/share';
import { randomUUID } from 'node:crypto';

/**
 * Contract tests for the Microsoft Money endpoints that need no `.mny` file:
 * rejected uploads, unknown upload ids, cross-user isolation and auth.
 */

/** A well-formed upload id that was never issued. */
const unknownUploadId = () => randomUUID();

/** Minimal mapping — the requests below never get far enough to use it. */
const someAccountMapping = { 'Some Account': { action: 'skip' as const } };

describe('Microsoft Money import endpoints', () => {
  describe('POST /import/ms-money/upload', () => {
    it('rejects bodies that are not an acceptable Microsoft Money upload', async () => {
      const notADatabase = await helpers.uploadMsMoney({
        file: Buffer.from('this is a text file, not a Money database'),
      });
      expect(notADatabase.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(notADatabase.errorMessage).toBe(t({ key: 'importExport.msMoney.notMsMoneyFile', locale: 'en' }));

      // Random bytes long enough to clear any minimum-length check, so the
      // rejection comes from the file's own header rather than its size.
      const rightSize = await helpers.uploadMsMoney({ file: Buffer.alloc(8192, 0x42) });
      expect(rightSize.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(rightSize.errorMessage).toBeTruthy();

      const empty = await helpers.uploadMsMoney({ file: Buffer.alloc(0) });
      expect(empty.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(empty.errorMessage).toBe(t({ key: 'importExport.msMoney.noFileUploaded', locale: 'en' }));

      // Only `application/octet-stream` reaches the raw parser, so anything else
      // leaves the handler with no buffer at all.
      const wrongContentType = await helpers.uploadMsMoney({
        file: Buffer.from('some bytes'),
        contentType: 'text/plain',
      });
      expect(wrongContentType.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(wrongContentType.errorMessage).toBe(t({ key: 'importExport.msMoney.noFileUploaded', locale: 'en' }));
    });

    it("rejects an upload in the requester's language", async () => {
      const result = await helpers.uploadMsMoney({
        file: Buffer.from('this is a text file, not a Money database'),
        locale: 'uk',
      });

      expect(result.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(result.errorMessage).toBe(t({ key: 'importExport.msMoney.notMsMoneyFile', locale: 'uk' }));
      expect(result.errorMessage).not.toBe(t({ key: 'importExport.msMoney.notMsMoneyFile', locale: 'en' }));
    });

    /**
     * The route's own `express.raw` parser caps the body at
     * `MS_MONEY_MAX_FILE_BYTES`. A body over the cap has to be refused by the
     * parser with a 413 — the API host cannot buffer an unbounded upload, and
     * the handler never sees the bytes.
     */
    it('rejects a body larger than the maximum file size', async () => {
      const result = await helpers.uploadMsMoney({ file: Buffer.alloc(MS_MONEY_MAX_FILE_BYTES + 1) });

      expect(result.statusCode).toBe(413);
      // No upload id came back, so nothing was parsed or cached for it.
      expect(result.response).toBeNull();
    }, 30_000);
  });

  describe('upload ids on the mapping steps', () => {
    /**
     * A cached upload is keyed by its owner: another user asking for one gets the
     * same 404 as an id that never existed, never a 200 carrying someone else's
     * data. With no `.mny` fixture the id here is a well-formed random UUID.
     */
    it("refuses unknown, malformed and other users' upload ids on detect and execute", async () => {
      const neverIssued = unknownUploadId();

      const detectUnknown = await helpers.detectMsMoneyDuplicates({
        payload: { uploadId: neverIssued, accountMapping: someAccountMapping },
      });
      expect(detectUnknown.statusCode).toBe(ERROR_CODES.NotFoundError);

      const detectMalformed = await helpers.detectMsMoneyDuplicates({
        payload: { uploadId: '../../etc/passwd', accountMapping: someAccountMapping },
      });
      expect(detectMalformed.statusCode).toBe(ERROR_CODES.ValidationError);

      // The upload is checked before the job is queued, so an id the user cannot
      // act on fails immediately instead of becoming a job that dies later.
      const executeUnknown = await helpers.executeMsMoney({
        payload: { uploadId: neverIssued, accountMapping: someAccountMapping },
      });
      expect(executeUnknown.statusCode).toBe(ERROR_CODES.NotFoundError);

      const executeMalformed = await helpers.executeMsMoney({
        payload: { uploadId: 'not-a-uuid', accountMapping: someAccountMapping },
      });
      expect(executeMalformed.statusCode).toBe(ERROR_CODES.ValidationError);

      const otherUser = await provisionSecondUserWithBaseCurrency();
      await asUser({
        cookies: otherUser.cookies,
        fn: async () => {
          const detect = await helpers.detectMsMoneyDuplicates({
            payload: { uploadId: neverIssued, accountMapping: someAccountMapping },
          });
          expect(detect.statusCode).toBe(ERROR_CODES.NotFoundError);

          const execute = await helpers.executeMsMoney({
            payload: { uploadId: neverIssued, accountMapping: someAccountMapping },
          });
          expect(execute.statusCode).toBe(ERROR_CODES.NotFoundError);
        },
      });
    });

    // Balances persist as INTEGER cents, so a target past ±20,000,000 must fail
    // request validation instead of the balance write at the end of the job. The
    // body schema runs before the upload is looked up, so an id that was never
    // issued still reaches the mapping and cannot answer 404 first.
    it('returns 422 for a create-new balance beyond the integer-cents cap', async () => {
      for (const currentBalance of [20_000_001, -20_000_001]) {
        const response = await helpers.executeMsMoney({
          payload: {
            uploadId: unknownUploadId(),
            accountMapping: { 'Some Account': { action: 'create-new', currencyCode: 'AUD', currentBalance } },
          },
        });

        expect(response.statusCode).toBe(ERROR_CODES.ValidationError);
      }
    });
  });

  describe('GET /import/ms-money/status/:jobId', () => {
    it('returns 404 for an unknown job id', async () => {
      const response = await helpers.getMsMoneyImportStatus({ jobId: 'no-such-ms-money-job' });

      expect(response.statusCode).toBe(ERROR_CODES.NotFoundError);
    });
  });

  describe('authentication', () => {
    it('rejects unauthenticated upload, detect, execute and status calls', async () => {
      await withoutSession(async () => {
        const upload = await helpers.uploadMsMoney({ file: Buffer.from('anything') });
        expect(upload.statusCode).toBe(ERROR_CODES.Unauthorized);

        const detect = await helpers.detectMsMoneyDuplicates({
          payload: { uploadId: unknownUploadId(), accountMapping: someAccountMapping },
        });
        expect(detect.statusCode).toBe(ERROR_CODES.Unauthorized);

        const execute = await helpers.executeMsMoney({
          payload: { uploadId: unknownUploadId(), accountMapping: someAccountMapping },
        });
        expect(execute.statusCode).toBe(ERROR_CODES.Unauthorized);

        const status = await helpers.getMsMoneyImportStatus({ jobId: 'any-job' });
        expect(status.statusCode).toBe(ERROR_CODES.Unauthorized);
      });
    });
  });
});
