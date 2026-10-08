import { createController } from '@controllers/helpers/controller-factory';
import { askLandingFaq } from '@services/landing-faq/ask-landing-faq.service';
import { z } from 'zod';

export const landingFaqSchema = z.object({
  body: z.object({
    question: z.string().trim().min(3).max(300),
  }),
});

export default createController(landingFaqSchema, async ({ body }) => {
  const data = await askLandingFaq({ question: body.question });
  return { data };
});
