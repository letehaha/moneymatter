import { glob } from 'astro/loaders';
import { z } from 'astro/zod';
import { defineCollection } from 'astro:content';

const guides = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/guides' }),
  schema: z.object({
    title: z.string(),
    description: z.string().max(160),
    published: z.coerce.date(),
    updated: z.coerce.date().optional(),
    related: z.array(z.string()).min(1),
    docs: z.array(z.object({ label: z.string(), href: z.url() })).min(1),
  }),
});

export const collections = { guides };
