import {
  CHAT_ATTACHMENT_EXCERPT_CHARS,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_TEXT_MAX_CHARS,
  STATEMENT_IMAGE_MAX_BYTES,
} from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import { ERROR_CODES } from '@js/errors';
import ChatAttachments from '@models/chat-attachments.model';
import {
  ENCRYPTED_STATEMENT_MERCHANT,
  ENCRYPTED_STATEMENT_PASSWORD,
  STATEMENT_PDF_FIXTURES,
  PNG_1X1_BASE64,
  readStatementPdfFixture,
} from '@tests/fixtures/statement-parser-fixtures';
import * as helpers from '@tests/helpers';

const PNG_BYTES = Buffer.from(PNG_1X1_BASE64, 'base64');
/** Only the magic bytes matter: images are stored as sent and never decoded on the server. */
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
const WEBP_BYTES = Buffer.concat([
  Buffer.from('RIFF', 'latin1'),
  Buffer.from([0x40, 0x00, 0x00, 0x00]),
  Buffer.from('WEBP', 'latin1'),
  Buffer.alloc(64, 1),
]);
/** `ftyp` box of an iPhone HEIC photo: the server cannot decode it, the browser converts it first. */
const HEIC_BYTES = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18]),
  Buffer.from('ftypheic', 'latin1'),
  Buffer.alloc(64, 1),
]);
const ZIP_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 0)]);

const CSV = 'date,description,amount\n2026-10-01,Coffee,-3.50\n2026-10-02,Salary,2500.00\n';
const TXT = 'Dinner with friends on Friday cost 84 euros, split four ways.';

const encrypted = () => readStatementPdfFixture({ file: STATEMENT_PDF_FIXTURES.encrypted });

const csvBuffer = ({ extra = '' }: { extra?: string } = {}) => Buffer.from(CSV + extra, 'utf8');

const createThreadId = async () => (await helpers.createChatThread({ raw: true })).id;

describe('Chat attachments', () => {
  describe('POST /chat/threads/:id/attachments', () => {
    it('stores a PNG as bytes and answers its metadata', async () => {
      const threadId = await createThreadId();

      const result = await helpers.uploadChatAttachment({ threadId, file: PNG_BYTES, filename: 'receipt.png' });

      expect(result.statusCode).toBe(201);
      expect(result.attachment).toMatchObject({
        threadId,
        messageId: null,
        fileName: 'receipt.png',
        mimeType: 'image/png',
        kind: 'image',
        sizeBytes: PNG_BYTES.length,
        pageCount: 1,
        excerpt: null,
        textTruncated: false,
      });

      const row = await ChatAttachments.findByPk(result.attachment!.id);
      expect(row!.imageData!.equals(PNG_BYTES)).toBe(true);
      expect(row!.extractedText).toBeNull();
      expect(row!.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('identifies JPEG and WebP from their bytes, whatever the file name says', async () => {
      const threadId = await createThreadId();

      const jpeg = await helpers.uploadChatAttachment({ threadId, file: JPEG_BYTES, filename: 'photo.png' });
      const webp = await helpers.uploadChatAttachment({ threadId, file: WEBP_BYTES, filename: 'photo.jpg' });

      expect(jpeg.attachment).toMatchObject({ kind: 'image', mimeType: 'image/jpeg' });
      expect(webp.attachment).toMatchObject({ kind: 'image', mimeType: 'image/webp' });
    });

    it('reads a PDF into text, a page count and an excerpt, and keeps no file', async () => {
      const threadId = await createThreadId();
      const pdf = helpers.buildTextPdf({
        pages: [
          'Account statement for October 2026: opening balance 1200.00',
          'Closing balance 980.45 after card payments and one transfer',
        ],
      });

      const result = await helpers.uploadChatAttachment({ threadId, file: pdf, filename: 'october.pdf' });

      expect(result.statusCode).toBe(201);
      expect(result.attachment).toMatchObject({
        kind: 'pdf',
        mimeType: 'application/pdf',
        fileName: 'october.pdf',
        pageCount: 2,
        textTruncated: false,
      });
      expect(result.attachment!.excerpt).toContain('Account statement for October 2026');

      const row = await ChatAttachments.findByPk(result.attachment!.id);
      expect(row!.extractedText).toContain('Closing balance 980.45');
      expect(row!.imageData).toBeNull();
    });

    it('reads CSV and plain text into text with an excerpt', async () => {
      const threadId = await createThreadId();

      const csv = await helpers.uploadChatAttachment({ threadId, file: csvBuffer(), filename: 'october.csv' });
      const txt = await helpers.uploadChatAttachment({
        threadId,
        file: Buffer.from(TXT, 'utf8'),
        filename: 'dinner.txt',
      });

      expect(csv.attachment).toMatchObject({ kind: 'csv', mimeType: 'text/csv', pageCount: 1 });
      expect(csv.attachment!.excerpt).toContain('2026-10-01,Coffee,-3.50');
      expect(txt.attachment).toMatchObject({ kind: 'text', mimeType: 'text/plain', pageCount: 1 });
      expect(txt.attachment!.excerpt).toBe(TXT);
    });

    it('cuts the excerpt to its limit', async () => {
      const threadId = await createThreadId();

      const result = await helpers.uploadChatAttachment({
        threadId,
        file: Buffer.from(`${CSV}${'row,padding,1.00\nrow,padding,2.00\n'.repeat(200)}`),
      });

      expect(Array.from(result.attachment!.excerpt!).length).toBe(CHAT_ATTACHMENT_EXCERPT_CHARS);
    });

    it('strips path separators and control characters from the file name and defaults an empty one', async () => {
      const threadId = await createThreadId();

      const dirty = await helpers.uploadChatAttachment({
        threadId,
        file: csvBuffer(),
        filename: '../..\\evil\u0007name.csv',
      });
      const blank = await helpers.uploadChatAttachment({ threadId, file: csvBuffer({ extra: '\n' }), filename: '' });

      expect(dirty.attachment!.fileName).toBe('.._..\\evilname.csv'.replace(/\\/g, '_'));
      expect(blank.attachment!.fileName).toBe('attachment');
    });

    it('returns the attachment already waiting in the thread for the same bytes', async () => {
      const threadId = await createThreadId();
      const otherThreadId = await createThreadId();

      const first = await helpers.uploadChatAttachment({ threadId, file: csvBuffer(), filename: 'a.csv' });
      const again = await helpers.uploadChatAttachment({ threadId, file: csvBuffer(), filename: 'b.csv' });
      const elsewhere = await helpers.uploadChatAttachment({ threadId: otherThreadId, file: csvBuffer() });

      expect(again.statusCode).toBe(201);
      expect(again.attachment!.id).toBe(first.attachment!.id);
      expect(elsewhere.attachment!.id).not.toBe(first.attachment!.id);
      expect(await ChatAttachments.count({ where: { threadId } })).toBe(1);
    });

    it('caps text over the limit and says so', async () => {
      const threadId = await createThreadId();
      const long = Buffer.from(`${CSV}${'x,y,1\n'.repeat(Math.ceil(CHAT_ATTACHMENT_TEXT_MAX_CHARS / 6) + 100)}`);
      expect(long.length).toBeGreaterThan(CHAT_ATTACHMENT_TEXT_MAX_CHARS);

      const capped = await helpers.uploadChatAttachment({ threadId, file: long, filename: 'long.csv' });
      const fits = await helpers.uploadChatAttachment({ threadId, file: csvBuffer(), filename: 'short.csv' });

      expect(capped.statusCode).toBe(201);
      expect(capped.attachment!.textTruncated).toBe(true);
      expect(capped.attachment!.sizeBytes).toBe(long.length);
      const row = await ChatAttachments.findByPk(capped.attachment!.id);
      expect(row!.extractedText!.length).toBe(CHAT_ATTACHMENT_TEXT_MAX_CHARS);
      expect(fits.attachment!.textTruncated).toBe(false);
    });

    describe('a password-protected PDF', () => {
      it('answers 422 with the statement parser message when the password is missing or wrong', async () => {
        const threadId = await createThreadId();

        const missing = await helpers.uploadChatAttachment({ threadId, file: encrypted() });
        const wrong = await helpers.uploadChatAttachment({ threadId, file: encrypted(), password: 'not-the-password' });

        expect(missing.statusCode).toBe(ERROR_CODES.ValidationError);
        expect(missing.errorMessage).toMatch(/password-protected/i);
        expect(wrong.statusCode).toBe(ERROR_CODES.ValidationError);
        expect(wrong.errorMessage).toMatch(/password you entered is incorrect/i);
        expect(await ChatAttachments.count({ where: { threadId } })).toBe(0);
      });

      it('stores it once the right password is sent', async () => {
        const threadId = await createThreadId();

        const result = await helpers.uploadChatAttachment({
          threadId,
          file: encrypted(),
          password: ENCRYPTED_STATEMENT_PASSWORD,
        });

        expect(result.statusCode).toBe(201);
        expect(result.attachment).toMatchObject({ kind: 'pdf' });
        expect(result.attachment!.excerpt).toContain(ENCRYPTED_STATEMENT_MERCHANT);
        const row = await ChatAttachments.findByPk(result.attachment!.id);
        expect(row!.extractedText).toContain(ENCRYPTED_STATEMENT_MERCHANT);
      });
    });

    it('answers 422 for a PDF with no text layer instead of a server error', async () => {
      const threadId = await createThreadId();

      const result = await helpers.uploadChatAttachment({
        threadId,
        file: readStatementPdfFixture({ file: STATEMENT_PDF_FIXTURES.noTextLayer }),
      });

      expect(result.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('answers 413 for a body over 10 MB', async () => {
      const threadId = await createThreadId();

      const result = await helpers.uploadChatAttachment({
        threadId,
        file: Buffer.alloc(CHAT_ATTACHMENT_MAX_BYTES + 1, 'a'),
      });

      expect(result.statusCode).toBe(413);
    });

    it('answers 422 for a type it cannot read', async () => {
      const threadId = await createThreadId();

      const result = await helpers.uploadChatAttachment({ threadId, file: ZIP_BYTES, filename: 'archive.zip' });

      expect(result.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(result.errorMessage).toMatch(/unsupported file type/i);
    });

    it('answers 422 with a HEIC-specific message for an iPhone HEIC photo', async () => {
      const threadId = await createThreadId();

      const result = await helpers.uploadChatAttachment({ threadId, file: HEIC_BYTES, filename: 'IMG_0001.HEIC' });

      expect(result.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(result.errorMessage).toMatch(/HEIC/);
    });

    it('takes a large screenshot-sized image just under the model limit, with no text in it', async () => {
      const threadId = await createThreadId();
      const large = Buffer.concat([PNG_BYTES, Buffer.alloc(STATEMENT_IMAGE_MAX_BYTES - PNG_BYTES.length, 1)]);

      const result = await helpers.uploadChatAttachment({ threadId, file: large, filename: 'Screenshot.png' });

      expect(result.statusCode).toBe(201);
      expect(result.attachment).toMatchObject({ kind: 'image', excerpt: null });
    });

    it('answers 422 for an empty body and for a file too small to be real', async () => {
      const threadId = await createThreadId();

      const empty = await helpers.uploadChatAttachment({ threadId, file: Buffer.alloc(0) });
      const tiny = await helpers.uploadChatAttachment({ threadId, file: Buffer.from('hi') });

      expect(empty.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(tiny.statusCode).toBe(ERROR_CODES.ValidationError);
    });

    it('answers 422 for an image over the model image limit', async () => {
      const threadId = await createThreadId();
      const big = Buffer.concat([PNG_BYTES, Buffer.alloc(STATEMENT_IMAGE_MAX_BYTES, 1)]);

      const result = await helpers.uploadChatAttachment({ threadId, file: big });

      expect(result.statusCode).toBe(ERROR_CODES.ValidationError);
      expect(result.errorMessage).toMatch(/over 3\.75MB/);
    });

    it('answers 429 from the 31st upload in the window', async () => {
      const threadId = await createThreadId();

      for (let index = 0; index < 30; index++) {
        const accepted = await helpers.uploadChatAttachment({ threadId, file: csvBuffer({ extra: `#${index}\n` }) });
        expect(accepted.statusCode).toBe(201);
      }
      const rejected = await helpers.uploadChatAttachment({ threadId, file: csvBuffer({ extra: '#last\n' }) });

      expect(rejected.statusCode).toBe(ERROR_CODES.TooManyRequests);
      expect(await ChatAttachments.count({ where: { threadId } })).toBe(30);
    });

    it('answers 404 for a thread that is not the caller’s and for one that does not exist', async () => {
      const other = await helpers.provisionSecondUserWithBaseCurrency();
      const foreignThreadId = await helpers.asUser({
        cookies: other.cookies,
        fn: async () => (await helpers.createChatThread({ raw: true })).id,
      });

      const foreign = await helpers.uploadChatAttachment({ threadId: foreignThreadId, file: csvBuffer() });
      const missing = await helpers.uploadChatAttachment({
        threadId: '00000000-0000-7000-8000-000000000000',
        file: csvBuffer(),
      });

      expect(foreign.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(missing.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(await ChatAttachments.count({ where: { threadId: foreignThreadId } })).toBe(0);
    });
  });

  describe('GET /chat/attachments/:id/image', () => {
    it.each([
      { label: 'PNG', bytes: PNG_BYTES, contentType: 'image/png' },
      { label: 'JPEG', bytes: JPEG_BYTES, contentType: 'image/jpeg' },
      { label: 'WebP', bytes: WEBP_BYTES, contentType: 'image/webp' },
    ])('serves a $label back with its content type', async ({ bytes, contentType }) => {
      const threadId = await createThreadId();
      const uploaded = await helpers.uploadChatAttachment({ threadId, file: bytes });

      const image = await helpers.getChatAttachmentImage({ attachmentId: uploaded.attachment!.id });

      expect(image.statusCode).toBe(200);
      expect(image.contentType).toBe(contentType);
      expect(image.headers['x-content-type-options']).toBe('nosniff');
      expect(image.bytes.equals(bytes)).toBe(true);
    });

    it('answers 404 for a document, which has no image', async () => {
      const threadId = await createThreadId();
      const uploaded = await helpers.uploadChatAttachment({ threadId, file: csvBuffer() });

      const image = await helpers.getChatAttachmentImage({ attachmentId: uploaded.attachment!.id });

      expect(image.statusCode).toBe(ERROR_CODES.NotFoundError);
    });

    it('answers 404 for another user’s attachment and for one that does not exist', async () => {
      const other = await helpers.provisionSecondUserWithBaseCurrency();
      const foreign = await helpers.asUser({
        cookies: other.cookies,
        fn: async () => {
          const threadId = (await helpers.createChatThread({ raw: true })).id;
          return (await helpers.uploadChatAttachment({ threadId, file: PNG_BYTES })).attachment!;
        },
      });

      const stolen = await helpers.getChatAttachmentImage({ attachmentId: foreign.id });
      const missing = await helpers.getChatAttachmentImage({ attachmentId: '00000000-0000-7000-8000-000000000000' });

      expect(stolen.statusCode).toBe(ERROR_CODES.NotFoundError);
      expect(missing.statusCode).toBe(ERROR_CODES.NotFoundError);
      const owner = await helpers.asUser({
        cookies: other.cookies,
        fn: () => helpers.getChatAttachmentImage({ attachmentId: foreign.id }),
      });
      expect(owner.statusCode).toBe(200);
    });
  });
});
