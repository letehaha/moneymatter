import { recordId } from '@common/lib/zod/custom-types';
import { createController } from '@controllers/helpers/controller-factory';
import { readLogoImage } from '@services/logo-images/logo-images.service';
import { z } from 'zod';

const schema = z.object({ params: z.object({ id: recordId() }) });

export const getLogoImageController = createController(schema, async ({ params, res }) => {
  const { body, contentType } = await readLogoImage({ id: params.id });

  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.status(200).send(body);
});
