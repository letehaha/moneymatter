import type { ExecuteOfxResponse } from '@bt/shared/types';
import { createController } from '@controllers/helpers/controller-factory';
import { queueOfxImport, readValidatedOfxUpload } from '@services/import-export/ofx-import';
import { z } from 'zod';

import { importExecuteRequestBaseSchema } from '../shared-schemas';
import { ofxAccountMappingSchema, ofxUploadIdSchema } from './shared-schemas';

export const executeOfxController = createController(
  z.object({
    body: z.object({
      uploadId: ofxUploadIdSchema,
      accountMapping: ofxAccountMappingSchema,
      skipDuplicateIndices: z.array(z.number().int().nonnegative()),
      ...importExecuteRequestBaseSchema.shape,
    }),
  }),
  async ({ user, body }) => {
    await readValidatedOfxUpload({ userId: user.id, uploadId: body.uploadId, accountMapping: body.accountMapping });
    const jobId = await queueOfxImport({ userId: user.id, ...body });
    const data: ExecuteOfxResponse = { jobId };
    return { data };
  },
);
