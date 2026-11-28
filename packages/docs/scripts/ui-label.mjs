import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// Prints English UI strings so docs writers can quote labels without opening the locale files.
// Each query matches a key prefix (`pages.household.permissions`) or, case-insensitively, any part of a text.
const ROOT = new URL('../../../', import.meta.url).pathname;
const FRONTEND = join(ROOT, 'packages/frontend/src/i18n/locales/chunks/en');
const BACKEND = join(ROOT, 'packages/backend/src/i18n/locales/en.json');
const LIMIT = 40;

const flatten = ({ obj, prefix = '' }) =>
  Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return value && typeof value === 'object'
      ? flatten({ obj: value, prefix: path })
      : [{ key: path, text: String(value) }];
  });
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

const entries = [
  ...readdirSync(FRONTEND, { recursive: true })
    .filter((file) => file.endsWith('.json'))
    .flatMap((file) => flatten({ obj: readJson(join(FRONTEND, file)) })),
  ...flatten({ obj: readJson(BACKEND) }).map((entry) => ({ ...entry, backend: true })),
];
if (!entries.length) throw new Error(`No strings loaded from ${FRONTEND} or ${BACKEND}`);

const queries = process.argv.slice(2);
if (!queries.length) {
  console.log('Usage: npm run ui-label -- <key prefix or text> [...]');
  process.exit(1);
}

for (const query of queries) {
  const needle = query.toLowerCase();
  const hits = entries.filter(
    ({ key, text }) => key === query || key.startsWith(`${query}.`) || text.toLowerCase().includes(needle),
  );
  console.log(`# ${query} (${hits.length})`);
  for (const { key, text, backend } of hits.slice(0, LIMIT))
    console.log(`${key} = ${text}${backend ? '  (backend)' : ''}`);
  if (hits.length > LIMIT) console.log(`… ${hits.length - LIMIT} more, narrow the query`);
}
