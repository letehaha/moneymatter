import type { OfxUploadResponse } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { t } from '@i18n/index';
import { ValidationError } from '@js/errors';
import { OfxParseError, parseOfxFile, storeOfxUpload } from '@services/import-export/ofx-import';
import { z } from 'zod';

export const uploadOfxController = createController(z.object({}), async ({ user, req }) => {
  const body: unknown = req.body;
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new ValidationError({ message: t({ key: 'ofxImport.noFileUploaded' }) });
  }

  const result = (() => {
    try {
      return parseOfxFile({ bytes: body, timezone: req.get('X-Timezone') });
    } catch (error) {
      if (error instanceof OfxParseError) {
        throw new ValidationError({ message: t({ key: error.key, variables: error.params }) });
      }
      throw error;
    }
  })();
  const { uploadId, lease } = await storeOfxUpload({ userId: user.id, result });
  const data: OfxUploadResponse = { uploadId, result, lease };
  return { data };
});
