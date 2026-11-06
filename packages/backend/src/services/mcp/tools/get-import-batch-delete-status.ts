import { getUserActiveImportBatchDeleteStatus } from '@services/import-export/delete-batch-queue';

import { defineTool } from '../define-tool';
import { presentImportBatchDeleteStatus } from './import-batch-output';

export const getImportBatchDeleteStatusTool = defineTool({
  name: 'get_import_batch_delete_status',
  toolset: 'imports',
  access: 'read',
  description:
    'Read the state of the latest background import batch delete of the signed-in user, the job delete_import_batch starts for a batch above 1000 rows. Returns { state } with state idle (no job), queued or running (with jobId), completed (jobId and deletedCount) or failed (jobId and error). While a job is queued or running, writes are blocked. Read-only.',
  run: async ({ userId }) => {
    const status = await getUserActiveImportBatchDeleteStatus({ userId });

    return presentImportBatchDeleteStatus({ status });
  },
});
