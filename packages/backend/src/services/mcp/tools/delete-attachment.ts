import { FEATURES } from '@bt/shared/types';
import { recordId } from '@common/lib/zod/custom-types';
import { deleteAttachment } from '@services/attachments/attachments.service';

import { defineTool } from '../define-tool';

export const deleteAttachmentTool = defineTool({
  name: 'delete_attachment',
  toolset: 'core',
  access: 'delete',
  feature: FEATURES.attachments,
  // DELETE /attachments/:id has no base-currency lock: attachments touch no amounts.
  lock: false,
  description:
    'Permanently delete a file attached to a transaction. Irreversible. Find attachment ids with list_transaction_attachments. Needs a plan that includes attachments.',
  input: {
    attachmentId: recordId().describe('ID of the attachment to delete (from list_transaction_attachments)'),
  },
  run: async ({ userId, args }) => {
    await deleteAttachment({ userId, id: args.attachmentId });

    return { deleted: true, attachmentId: args.attachmentId };
  },
});
