import { ATTACHMENT_FILENAME_HEADER, CHAT_DOCUMENT_PASSWORD_HEADER } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { readFilename } from '@controllers/attachments.controller';
import { createController } from '@controllers/helpers/controller-factory';
import { documentPasswordSchema } from '@controllers/statement-parser/shared-schemas';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { uploadChatAttachment } from '@services/chat/attachments/upload.service';
import { z } from 'zod';

const schema = z.object({ params: z.object({ id: recordId() }) });

/**
 * Takes one file as the raw request body. The password of an encrypted PDF travels in a header
 * because the body is the file, and a query string would end up in access logs.
 */
export default createController(schema, async ({ user, params, req }) => {
  const body: unknown = req.body;
  // `express.raw` leaves the body as an empty object when the request carried no octet-stream payload.
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new ValidationError({ message: t({ key: 'chat.noFileUploaded' }) });
  }

  const password = documentPasswordSchema.safeParse(req.get(CHAT_DOCUMENT_PASSWORD_HEADER) || undefined);
  if (!password.success) {
    throw new ValidationError({ message: t({ key: 'chat.documentPasswordInvalid' }) });
  }

  const data = await uploadChatAttachment({
    userId: user.id,
    threadId: params.id,
    fileName: readFilename({ value: req.get(ATTACHMENT_FILENAME_HEADER) }),
    bytes: body,
    password: password.data,
  });

  return { data, statusCode: 201 };
});
