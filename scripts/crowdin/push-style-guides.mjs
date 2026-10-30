#!/usr/bin/env node
// Creates or updates (matched by exact name) the Crowdin style guides in docs/i18n/style-guide.
// Each guide gets its Markdown file via Storage (what translators see) and the same text as
// aiInstructions, so AI prompts carry the exact rules rather than Crowdin's auto-summary.
// Token scopes: Style guides (read/write) + Projects (read).
// Usage: npm run i18n:crowdin:style-guides [-- --dry-run]
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { ROOT, createCrowdinClient } from './client.mjs';

const GUIDES_DIR = path.join(ROOT, 'docs/i18n/style-guide');
const AI_INSTRUCTIONS_MAX_BYTES = 10240;
const DRY_RUN = process.argv.includes('--dry-run');

const GUIDES = [
  { name: 'MoneyMatter – Shared', file: 'shared.md', languageIds: [] },
  { name: 'MoneyMatter – Ukrainian', file: 'uk.md', languageIds: ['uk'] },
  { name: 'MoneyMatter – Russian and Slovak plurals', file: 'slavic-plurals.md', languageIds: ['ru', 'sk'] },
  { name: 'MoneyMatter – Brazilian Portuguese', file: 'pt-BR.md', languageIds: ['pt-BR'] },
].map((guide) => {
  const text = readFileSync(path.join(GUIDES_DIR, guide.file), 'utf-8');
  return { ...guide, text, bytes: Buffer.byteLength(text) };
});

for (const { name, file, bytes, languageIds } of GUIDES) {
  const fits = bytes <= AI_INSTRUCTIONS_MAX_BYTES;
  const languages = languageIds.length ? languageIds.join(', ') : 'all';
  console.log(
    `${name}: ${file}, ${bytes} bytes, languages: ${languages}, ${fits ? 'OK' : 'OVER'} (cap ${AI_INSTRUCTIONS_MAX_BYTES})`,
  );
}

if (GUIDES.some((guide) => guide.bytes > AI_INSTRUCTIONS_MAX_BYTES)) {
  console.error('error: aiInstructions is capped at 10240 bytes; shorten the files marked OVER.');
  process.exit(1);
}

if (DRY_RUN) process.exit(0);

const { projectId, request: crowdin, listAll } = createCrowdinClient();

async function pushGuide({ guide, existing }) {
  const matches = existing.filter((item) => item.name === guide.name);
  if (matches.length > 1) {
    throw new Error(
      `${matches.length} style guides are named "${guide.name}" (ids ${matches.map((m) => m.id)}); delete the extras.`,
    );
  }

  const storage = await crowdin({
    method: 'POST',
    path: '/storages',
    headers: {
      'Content-Type': 'text/markdown',
      'Crowdin-API-FileName': encodeURIComponent(guide.file),
    },
    body: guide.text,
  });

  const fields = {
    name: guide.name,
    languageIds: guide.languageIds,
    projectIds: [projectId],
    storageId: storage.id,
    aiInstructions: guide.text,
  };
  const [match] = matches;
  const result = match
    ? await crowdin({
        method: 'PATCH',
        path: `/style-guides/${match.id}`,
        json: Object.entries(fields).map(([key, value]) => ({
          op: 'replace',
          path: `/${key}`,
          value,
        })),
      })
    : await crowdin({ method: 'POST', path: '/style-guides', json: fields });

  const languages = result.languageIds?.length ? result.languageIds.join(', ') : 'all';
  console.log(
    `${match ? 'updated' : 'created'} "${result.name}": id ${result.id}, languages: ${languages}, projects: ${result.projectIds?.join(', ')}, storage ${storage.id}`,
  );
  if (result.aiInstructions !== guide.text) {
    console.warn(
      `  warning: returned aiInstructions differ from ${guide.file}; check the AI-Ready Version in Crowdin.`,
    );
  }
}

try {
  const existing = await listAll({ path: '/style-guides' });
  for (const guide of GUIDES) await pushGuide({ guide, existing });
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(1);
}
