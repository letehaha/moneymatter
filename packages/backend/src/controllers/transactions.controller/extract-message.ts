import { createController } from '@controllers/helpers/controller-factory';
import { logger } from '@js/utils/logger';
import { extractMessage } from '@services/document-extraction/extract-message.service';
import { z } from 'zod';

const schema = z.object({
  body: z.object({ text: z.string().trim().min(1).max(2000) }),
});

const controller = createController(
  schema,
  async ({ user, body }) => {
    try {
      return { data: await extractMessage({ userId: user.id, text: body.text }) };
    } catch (error) {
      logger.info(
        `[extract-message-debug] rejected by service: ${(error as Error)?.name} ${(error as Error)?.message}`,
      );
      throw error;
    }
  },
  { inBackground: true },
);

export default async (...[req, res]: Parameters<typeof controller>) => {
  const text: unknown = req.body?.text;
  logger.info(`[extract-message-debug] raw text: ${JSON.stringify(text)}`);
  if (typeof text === 'string') {
    logger.info(`[extract-message-debug] length: ${text.length}`);
    const nonAscii = [...text]
      .map((char, i) => ({ char, i, code: char.codePointAt(0)! }))
      .filter(({ code }) => code > 0x7f)
      .map(({ char, i, code }) => `${char} U+${code.toString(16).toUpperCase().padStart(4, '0')} @${i}`);
    logger.info(`[extract-message-debug] non-ASCII: ${nonAscii.length ? nonAscii.join(' | ') : 'none'}`);
  }
  const parsed = schema.safeParse({ body: req.body });
  if (!parsed.success) {
    logger.info(`[extract-message-debug] rejected by validation: ${JSON.stringify(parsed.error.issues)}`);
  }
  return controller(req, res);
};
