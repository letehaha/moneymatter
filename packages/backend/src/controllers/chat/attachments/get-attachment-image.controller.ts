import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { getChatAttachmentImage } from '@services/chat/attachments/image.service';
import { z } from 'zod';

const schema = z.object({ params: z.object({ id: recordId() }) });

export default createController(schema, async ({ user, params, res }) => {
  const { bytes, mimeType, fileName } = await getChatAttachmentImage({ userId: user.id, attachmentId: params.id });

  res.setHeader('Content-Type', mimeType);
  res.setHeader('Content-Length', String(bytes.length));
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  // The type comes from the bytes; a browser must not second-guess it.
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  // Commits the headers, so the controller factory leaves the binary body alone.
  res.end(bytes);
});
