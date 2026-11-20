// Check: node scripts/i18n.mjs. Sync from a report build: --sync. Every locale page built: --dist. Self-test: --self-test.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { TRANSLATED_LOCALES } from '../astro.config.mjs';

const ROOT = 'src/i18n';
const REPORT = '.i18n-report.jsonl';

const tokens = ({ text }) => (text.match(/<\/?[a-z]+|\{\w+\}|\d+/gi) ?? []).sort().join(' ');

const jsonFiles = ({ dir }) =>
  existsSync(dir)
    ? readdirSync(dir, { recursive: true })
        .filter((file) => file.endsWith('.json'))
        .map((file) => join(dir, file))
    : [];

const read = ({ file }) => JSON.parse(readFileSync(file, 'utf8'));

const check = () => {
  let mismatches = 0;
  for (const file of jsonFiles({ dir: ROOT })) {
    const entries = Object.entries(read({ file }));
    for (const [english, translation] of entries) {
      if (!translation || tokens({ text: english }) === tokens({ text: translation })) continue;
      mismatches++;
      console.error(`${file}: tags, {placeholders} or digits differ\n  en: ${english}\n  tr: ${translation}`);
    }
    const empty = entries.filter(([, translation]) => !translation).length;
    if (empty) console.log(`${file}: ${empty} untranslated`);
  }
  if (mismatches) process.exit(1);
};

const sync = () => {
  const seen = new Map();
  for (const line of readFileSync(REPORT, 'utf8').split('\n').filter(Boolean)) {
    const { locale, page, text } = JSON.parse(line);
    if (!seen.has(locale)) seen.set(locale, new Map());
    const pages = seen.get(locale);
    if (!pages.has(text)) pages.set(text, new Set());
    pages.get(text).add(page);
  }

  for (const [locale, texts] of seen) {
    const dir = join(ROOT, locale);
    const files = new Map(jsonFiles({ dir }).map((file) => [file, read({ file })]));
    const known = new Set();
    for (const dict of files.values()) {
      for (const text of Object.keys(dict)) {
        if (texts.has(text)) known.add(text);
        else delete dict[text];
      }
    }
    for (const [text, pages] of texts) {
      if (known.has(text)) continue;
      const file = join(dir, `${pages.size > 1 ? 'shell' : [...pages][0]}.json`);
      if (!files.has(file)) files.set(file, {});
      files.get(file)[text] = '';
    }
    for (const [file, dict] of files) {
      if (!Object.keys(dict).length) {
        unlinkSync(file);
        continue;
      }
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(dict, null, 2) + '\n');
    }
  }
  check();
};

const checkDist = () => {
  const english = readdirSync('dist', { recursive: true }).filter(
    (file) => file.endsWith('index.html') && !TRANSLATED_LOCALES.includes(file.split('/')[0]),
  );
  const missing = TRANSLATED_LOCALES.flatMap((locale) =>
    english.map((file) => join('dist', locale, file)).filter((file) => !existsSync(file)),
  );
  for (const file of missing) console.error(`Not built (see the [i18n] errors above): ${relative('dist', file)}`);
  if (missing.length) process.exit(1);
};

const selfTest = () => {
  const same = ({ english, translation }) =>
    assert.equal(tokens({ text: english }), tokens({ text: translation }), `${english} | ${translation}`);
  same({
    english: '<strong>40-day free trial,</strong> no card needed',
    translation: '<strong>40 днів безкоштовно,</strong> без картки',
  });
  same({ english: 'LunchFlow covers 20,000 banks for {price}', translation: '{price} — LunchFlow, 20 000 банків' });
  same({ english: 'No tokens here', translation: 'Жодних токенів' });
  assert.notEqual(tokens({ text: '<b>Bold</b> text' }), tokens({ text: 'Жирний текст' }));
  assert.notEqual(tokens({ text: 'Costs $30' }), tokens({ text: 'Коштує $35' }));
  assert.notEqual(tokens({ text: 'Email {email}' }), tokens({ text: 'Пошта {mail}' }));
  console.log('i18n self-test passed');
};

const mode = process.argv[2];
if (mode === '--sync') sync();
else if (mode === '--dist') checkDist();
else if (mode === '--self-test') selfTest();
else check();
