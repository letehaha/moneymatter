import {
  ATTACHMENT_MAX_FILE_BYTES,
  ATTACHMENTS_MAX_PER_TRANSACTION,
  RESOURCE_TYPES,
  SHARE_PERMISSIONS,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { deleteAttachment } from '@services/attachments/attachments.service';
import { listObjects } from '@services/attachments/storage';
import { withTransaction } from '@services/common/with-transaction';
import * as helpers from '@tests/helpers';

const DAY = 24 * 60 * 60 * 1000;

/** Smallest valid 1x1 PNG; the upload path identifies it by its magic bytes. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n', 'latin1');
const SVG_BYTES = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><text>hi</text></svg>', 'utf8');
const HTML_BYTES = Buffer.from('<html><body><script>alert(1)</script></body></html>', 'utf8');

const createTransaction = async () => {
  const account = await helpers.createAccount({ raw: true });
  const [tx] = await helpers.createTransaction({
    payload: helpers.buildTransactionPayload({ accountId: account.id }),
    raw: true,
  });
  return tx!;
};

describe('Transaction attachments', () => {
  describe('POST /transactions/:transactionId/attachments', () => {
    it('stores a PNG and returns the attachment record', async () => {
      const tx = await createTransaction();

      const result = await helpers.uploadAttachment({
        transactionId: tx.id,
        file: PNG_BYTES,
        filename: 'receipt.png',
      });

      expect(result.statusCode).toBe(201);
      expect(result.response).toMatchObject({
        transactionId: tx.id,
        filename: 'receipt.png',
        mimeType: 'image/png',
        size: PNG_BYTES.length,
      });
    });

    it('stores a PDF', async () => {
      const tx = await createTransaction();

      const result = await helpers.uploadAttachment({
        transactionId: tx.id,
        file: PDF_BYTES,
        filename: 'invoice.pdf',
      });

      expect(result.statusCode).toBe(201);
      expect(result.response?.mimeType).toBe('application/pdf');
    });

    it('rejects an unsupported file type', async () => {
      const tx = await createTransaction();

      const result = await helpers.uploadAttachment({ transactionId: tx.id, file: SVG_BYTES, filename: 'logo.svg' });

      expect(result.statusCode).toBe(422);
    });

    it('rejects HTML bytes sent under a .png filename', async () => {
      const tx = await createTransaction();

      const result = await helpers.uploadAttachment({ transactionId: tx.id, file: HTML_BYTES, filename: 'evil.png' });

      expect(result.statusCode).toBe(422);
    });

    it('rejects an empty body', async () => {
      const tx = await createTransaction();

      const result = await helpers.uploadAttachment({ transactionId: tx.id, file: Buffer.alloc(0) });

      expect(result.statusCode).toBe(422);
    });

    it(`rejects more than ${ATTACHMENTS_MAX_PER_TRANSACTION} attachments on one transaction`, async () => {
      const tx = await createTransaction();

      for (let i = 0; i < ATTACHMENTS_MAX_PER_TRANSACTION; i++) {
        const accepted = await helpers.uploadAttachment({ transactionId: tx.id, file: PNG_BYTES });
        expect(accepted.statusCode).toBe(201);
      }

      const rejected = await helpers.uploadAttachment({ transactionId: tx.id, file: PNG_BYTES });
      expect(rejected.statusCode).toBe(422);
    });

    it('rejects a body over the upload size limit with 413', async () => {
      const tx = await createTransaction();

      const result = await helpers.uploadAttachment({
        transactionId: tx.id,
        file: Buffer.alloc(ATTACHMENT_MAX_FILE_BYTES + 1),
      });

      expect(result.statusCode).toBe(413);
    });

    it('strips path separators and control characters from the filename and caps its length', async () => {
      const tx = await createTransaction();

      const result = await helpers.uploadAttachment({
        transactionId: tx.id,
        file: PNG_BYTES,
        filename: `..\\..\\etc/pa${String.fromCharCode(1)}ss${'w'.repeat(300)}.png`,
      });

      expect(result.statusCode).toBe(201);
      const filename = result.response!.filename;
      expect(filename).not.toMatch(/[/\\]/);
      // eslint-disable-next-line no-control-regex
      expect(filename).not.toMatch(/[\x00-\x1f\x7f]/);
      expect(filename.length).toBeLessThanOrEqual(255);
    });

    it('rejects an upload from a read-only user with 402', async () => {
      const tx = await createTransaction();
      await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });

      const result = await helpers.uploadAttachment({ transactionId: tx.id, file: PNG_BYTES });

      expect(result.statusCode).toBe(402);
    });
  });

  describe('upload token auth', () => {
    it('uploads several files with one token and no session', async () => {
      const tx = await createTransaction();
      const { token } = await helpers.createAttachmentUploadToken({ transactionId: tx.id, raw: true });

      const first = await helpers.withoutSession(() =>
        helpers.uploadAttachment({ transactionId: tx.id, file: PNG_BYTES, uploadToken: token }),
      );
      const second = await helpers.withoutSession(() =>
        helpers.uploadAttachment({ transactionId: tx.id, file: PDF_BYTES, uploadToken: token }),
      );

      expect(first.statusCode).toBe(201);
      expect(second.statusCode).toBe(201);
      expect(await helpers.listAttachments({ transactionId: tx.id, raw: true })).toHaveLength(2);
    });

    it('rejects a token minted for another transaction', async () => {
      const tx = await createTransaction();
      const other = await createTransaction();
      const { token } = await helpers.createAttachmentUploadToken({ transactionId: tx.id, raw: true });

      const result = await helpers.withoutSession(() =>
        helpers.uploadAttachment({ transactionId: other.id, file: PNG_BYTES, uploadToken: token }),
      );

      expect(result.statusCode).toBe(401);
      expect(await helpers.listAttachments({ transactionId: other.id, raw: true })).toHaveLength(0);
    });

    it('rejects an unknown token', async () => {
      const tx = await createTransaction();

      const result = await helpers.withoutSession(() =>
        helpers.uploadAttachment({ transactionId: tx.id, file: PNG_BYTES, uploadToken: 'nope' }),
      );

      expect(result.statusCode).toBe(401);
    });

    it('does not fall back to the session cookie when the token does not match the transaction', async () => {
      const tx = await createTransaction();
      const other = await createTransaction();
      const { token } = await helpers.createAttachmentUploadToken({ transactionId: tx.id, raw: true });

      const result = await helpers.uploadAttachment({ transactionId: other.id, file: PNG_BYTES, uploadToken: token });

      expect(result.statusCode).toBe(401);
      expect(await helpers.listAttachments({ transactionId: other.id, raw: true })).toHaveLength(0);
    });

    it('rejects an upload from a read-only user holding a valid token with 402', async () => {
      const tx = await createTransaction();
      const { token } = await helpers.createAttachmentUploadToken({ transactionId: tx.id, raw: true });
      await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });

      const result = await helpers.withoutSession(() =>
        helpers.uploadAttachment({ transactionId: tx.id, file: PNG_BYTES, uploadToken: token }),
      );

      expect(result.statusCode).toBe(402);
    });

    it('does not mint a token for a transaction that does not exist', async () => {
      const result = await helpers.createAttachmentUploadToken({
        transactionId: '00000000-0000-7000-8000-000000000000',
      });

      expect(result.statusCode).toBe(404);
    });

    it('does not mint a token for another user transaction', async () => {
      const tx = await createTransaction();
      const second = await helpers.signUpSecondUser();

      await helpers.asUser({
        cookies: second.cookies,
        fn: async () => {
          expect((await helpers.createAttachmentUploadToken({ transactionId: tx.id })).statusCode).toBe(404);
        },
      });
    });
  });

  describe('GET /transactions/:transactionId/attachments', () => {
    it('returns an empty list when nothing is attached', async () => {
      const tx = await createTransaction();

      const attachments = await helpers.listAttachments({ transactionId: tx.id, raw: true });

      expect(attachments).toEqual([]);
    });

    it('returns the uploaded attachments', async () => {
      const tx = await createTransaction();
      const uploaded = await helpers.uploadAttachment({ transactionId: tx.id, file: PNG_BYTES, filename: 'a.png' });

      const attachments = await helpers.listAttachments({ transactionId: tx.id, raw: true });

      expect(attachments).toHaveLength(1);
      expect(attachments[0]!.id).toBe(uploaded.response!.id);
    });
  });

  describe('GET /attachments/:id/file', () => {
    it('streams back the exact bytes with the stored content type', async () => {
      const tx = await createTransaction();
      const uploaded = await helpers.uploadAttachment({
        transactionId: tx.id,
        file: PNG_BYTES,
        filename: 'receipt.png',
      });

      const download = await helpers.downloadAttachment({ id: uploaded.response!.id });

      expect(download.statusCode).toBe(200);
      expect(download.body.equals(PNG_BYTES)).toBe(true);
      expect(download.contentType).toContain('image/png');
      expect(download.nosniff).toBe('nosniff');
      expect(download.contentDisposition).toContain("filename*=UTF-8''receipt.png");
    });

    it('404s for an unknown attachment', async () => {
      const download = await helpers.downloadAttachment({ id: '01950000-0000-7000-8000-000000000000' });

      expect(download.statusCode).toBe(404);
    });
  });

  describe('DELETE /attachments/:id', () => {
    it('removes the attachment from the list and from storage', async () => {
      const tx = await createTransaction();
      const uploaded = await helpers.uploadAttachment({ transactionId: tx.id, file: PNG_BYTES });

      const storedKey = (key: string) => key.endsWith(`/${uploaded.response!.id}`);
      expect((await listObjects()).some((object) => storedKey(object.key))).toBe(true);

      const deleted = await helpers.deleteAttachment({ id: uploaded.response!.id });
      expect(deleted.statusCode).toBe(200);

      expect(await helpers.listAttachments({ transactionId: tx.id, raw: true })).toEqual([]);
      expect((await helpers.downloadAttachment({ id: uploaded.response!.id })).statusCode).toBe(404);
      expect((await listObjects()).some((object) => storedKey(object.key))).toBe(false);
    });
  });

  describe('deleting inside a database transaction', () => {
    const blobStored = async ({ id }: { id: string }) =>
      (await listObjects()).some((object) => object.key.endsWith(`/${id}`));

    it('keeps the blob when the transaction rolls back, so the restored row still has its file', async () => {
      const tx = await createTransaction();
      const uploaded = await helpers.uploadAttachment({ transactionId: tx.id, file: PNG_BYTES });
      const id = uploaded.response!.id;
      const { id: userId } = await helpers.getUserInfo({ raw: true });

      const failing = withTransaction(async () => {
        await deleteAttachment({ userId, id });
        throw new Error('rolled back');
      });
      await expect(failing()).rejects.toThrow('rolled back');

      expect(await helpers.listAttachments({ transactionId: tx.id, raw: true })).toHaveLength(1);
      expect(await blobStored({ id })).toBe(true);
      expect((await helpers.downloadAttachment({ id })).statusCode).toBe(200);
    });

    it('removes the blob once the transaction commits', async () => {
      const tx = await createTransaction();
      const uploaded = await helpers.uploadAttachment({ transactionId: tx.id, file: PNG_BYTES });
      const id = uploaded.response!.id;
      const { id: userId } = await helpers.getUserInfo({ raw: true });

      await withTransaction(() => deleteAttachment({ userId, id }))();

      expect(await helpers.listAttachments({ transactionId: tx.id, raw: true })).toEqual([]);
      expect(await blobStored({ id })).toBe(false);
    });
  });

  describe('lapsed subscription', () => {
    it('keeps reads open and refuses the delete', async () => {
      const tx = await createTransaction();
      const uploaded = await helpers.uploadAttachment({ transactionId: tx.id, file: PNG_BYTES });

      await helpers.setUserBilling({ trialEndsAt: new Date(Date.now() - DAY) });

      expect((await helpers.listAttachments({ transactionId: tx.id })).statusCode).toBe(200);
      expect((await helpers.downloadAttachment({ id: uploaded.response!.id })).statusCode).toBe(200);
      expect((await helpers.deleteAttachment({ id: uploaded.response!.id })).statusCode).toBe(402);
    });
  });

  describe('read share on the parent account', () => {
    it('lets the recipient read the attachments but not upload or delete', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [tx] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      const uploaded = await helpers.uploadAttachment({ transactionId: tx!.id, file: PNG_BYTES });

      const recipient = await helpers.provisionSecondUserWithBaseCurrency();
      const invitation = await helpers.createShareInvitation({
        inviteeEmail: recipient.email,
        resourceType: RESOURCE_TYPES.account,
        resourceId: account.id,
        permission: SHARE_PERMISSIONS.read,
        raw: true,
      });

      await helpers.asUser({
        cookies: recipient.cookies,
        fn: async () => {
          await helpers.acceptShareInvitation({ token: invitation.token, raw: true });

          const listed = await helpers.listAttachments({ transactionId: tx!.id, raw: true });
          expect(listed.map((item) => item.id)).toEqual([uploaded.response!.id]);

          const download = await helpers.downloadAttachment({ id: uploaded.response!.id });
          expect(download.statusCode).toBe(200);
          expect(download.body.equals(PNG_BYTES)).toBe(true);

          expect((await helpers.uploadAttachment({ transactionId: tx!.id, file: PNG_BYTES })).statusCode).toBe(404);
          expect((await helpers.deleteAttachment({ id: uploaded.response!.id })).statusCode).toBe(404);
          expect((await helpers.createAttachmentUploadToken({ transactionId: tx!.id })).statusCode).toBe(404);
        },
      });
    });
  });

  describe('access isolation', () => {
    it('hides another user attachments behind 404', async () => {
      const tx = await createTransaction();
      const uploaded = await helpers.uploadAttachment({ transactionId: tx.id, file: PNG_BYTES });
      const attachmentId = uploaded.response!.id;

      const second = await helpers.signUpSecondUser();

      await helpers.asUser({
        cookies: second.cookies,
        fn: async () => {
          expect((await helpers.listAttachments({ transactionId: tx.id })).statusCode).toBe(404);
          expect((await helpers.downloadAttachment({ id: attachmentId })).statusCode).toBe(404);
          expect((await helpers.deleteAttachment({ id: attachmentId })).statusCode).toBe(404);
          expect((await helpers.uploadAttachment({ transactionId: tx.id, file: PNG_BYTES })).statusCode).toBe(404);
        },
      });
    });
  });

  describe('transaction cascade', () => {
    it('drops the attachment rows when the transaction is deleted', async () => {
      const tx = await createTransaction();
      const uploaded = await helpers.uploadAttachment({ transactionId: tx.id, file: PNG_BYTES });

      expect((await helpers.deleteTransaction({ id: tx.id })).statusCode).toBe(200);

      expect((await helpers.listAttachments({ transactionId: tx.id })).statusCode).toBe(404);
      expect((await helpers.downloadAttachment({ id: uploaded.response!.id })).statusCode).toBe(404);
    });
  });

  describe('hasAttachment filter on GET /transactions', () => {
    it('splits transactions by whether they carry an attachment', async () => {
      const account = await helpers.createAccount({ raw: true });
      const [withFile] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      const [withoutFile] = await helpers.createTransaction({
        payload: helpers.buildTransactionPayload({ accountId: account.id }),
        raw: true,
      });
      await helpers.uploadAttachment({ transactionId: withFile!.id, file: PNG_BYTES });

      const attached = await helpers.getTransactions({ hasAttachment: true, raw: true });
      expect(attached.map((tx) => tx.id)).toEqual([withFile!.id]);

      const bare = await helpers.getTransactions({ hasAttachment: false, raw: true });
      const bareIds = bare.map((tx) => tx.id);
      expect(bareIds).toContain(withoutFile!.id);
      expect(bareIds).not.toContain(withFile!.id);
    });

    it.each([{ includeSplits: false }, { includeSplits: true }])(
      'flags each row with hasAttachments (includeSplits: $includeSplits)',
      async ({ includeSplits }) => {
        const account = await helpers.createAccount({ raw: true });
        const [withFile] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({ accountId: account.id }),
          raw: true,
        });
        const [withoutFile] = await helpers.createTransaction({
          payload: helpers.buildTransactionPayload({ accountId: account.id }),
          raw: true,
        });
        await helpers.uploadAttachment({ transactionId: withFile!.id, file: PNG_BYTES });

        // The helper types rows as the model, which lacks serializer-derived fields.
        const rows = (await helpers.getTransactions({
          includeSplits,
          includeHasAttachments: true,
          raw: true,
        })) as unknown as Array<{
          id: string;
          hasAttachments?: boolean;
        }>;

        expect(rows.find((tx) => tx.id === withFile!.id)!.hasAttachments).toBe(true);
        expect(rows.find((tx) => tx.id === withoutFile!.id)!.hasAttachments).toBe(false);
      },
    );
  });
});
