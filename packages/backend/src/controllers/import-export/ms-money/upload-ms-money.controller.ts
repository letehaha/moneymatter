import type { MsMoneyUploadResponse } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { getUserBaseCurrencyCode } from '@services/common/transaction-linking';
import { parseMsMoneyFile, storeMsMoneyUpload } from '@services/import-export/ms-money-import';
import { z } from 'zod';

/**
 * Header carrying the file's password. The request body is the file's raw bytes,
 * so the password cannot travel with it, and a query string would end up in
 * access logs and proxy history.
 */
const PASSWORD_HEADER = 'x-file-password';

// Money's own password field is short. The cap stops a bloated header from
// reaching the key derivation. An empty value means "no password set".
const passwordHeaderSchema = z.string().max(255).optional();

/**
 * Accepts one `.mny` file as a raw binary body, parses it, and caches the parse
 * result under an id the later wizard steps send back. The file itself is never
 * stored and never re-sent.
 *
 * The body is a Buffer rather than JSON, so there is nothing for the shared body
 * schema to validate — the password header is checked with zod here and the
 * buffer by hand.
 */
export const uploadMsMoneyController = createController(z.object({}), async ({ user, req }) => {
  const body: unknown = req.body;

  // `express.raw` leaves the body as an empty object when the request carried no
  // octet-stream payload at all.
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new ValidationError({ message: t({ key: 'importExport.msMoney.noFileUploaded' }) });
  }

  const rawPassword = req.headers[PASSWORD_HEADER];
  const parsedPassword = passwordHeaderSchema.safeParse(Array.isArray(rawPassword) ? rawPassword[0] : rawPassword);
  if (!parsedPassword.success) {
    throw new ValidationError({ message: t({ key: 'importExport.msMoney.invalidPasswordHeader' }) });
  }

  const result = parseMsMoneyFile({
    buffer: body,
    password: parsedPassword.data || null,
    fallbackCurrency: await getUserBaseCurrencyCode({ userId: user.id }),
  });
  const { uploadId, lease } = await storeMsMoneyUpload({ userId: user.id, result });

  const data: MsMoneyUploadResponse = { uploadId, result, lease };
  return { data };
});
