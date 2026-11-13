import { getEntry, type CollectionEntry } from 'astro:content';
import { getRelativeLocaleUrl } from 'astro:i18n';
import { appendFileSync } from 'node:fs';

const files = import.meta.glob<Record<string, string>>('./**/*.json', { eager: true, import: 'default' });
const dicts: Record<string, Record<string, string>> = {};
for (const [file, dict] of Object.entries(files)) Object.assign((dicts[file.split('/')[1]] ??= {}), dict);

export const ENGLISH_ONLY = /^\/(sign-in|sign-up|privacy-policy|terms-of-use|support|demo)\b/;

const REPORT = Boolean(process.env.I18N_REPORT);
const reported = new Set<string>();

// Log before throwing: Astro swallows render errors on fallback-rewritten locale pages without a log.
const fail = ({ message }: { message: string }) => {
  console.error(message);
  throw new Error(message);
};

export const useI18n = ({ currentLocale: locale = 'en', url: pageUrl }: { currentLocale?: string; url: URL }) => {
  const dir = locale.toLowerCase();
  const dict = dicts[dir] ?? {};
  const page = pageUrl.pathname.replace(/^\/|\/$/g, '') || 'home';

  const t = (text: string, vars: Record<string, string | number> = {}) => {
    const key = vars.ctx ? `${text} [${vars.ctx}]` : text;
    let out = locale === 'en' ? text : dict[key];
    if (locale !== 'en' && REPORT) {
      const row = JSON.stringify({ locale: dir, page, text: key });
      if (!reported.has(row)) {
        reported.add(row);
        appendFileSync('.i18n-report.jsonl', row + '\n');
      }
      out ||= text;
    }
    if (!out) fail({ message: `[i18n] Missing ${locale} translation (run npm run i18n:sync): ${key}` });
    return out.replace(/\{(\w+)\}/g, (match, name) => String(vars[name] ?? match));
  };

  const url = ({ href }: { href: string }) => {
    if (locale === 'en' || !href.startsWith('/') || ENGLISH_ONLY.test(href)) return href;
    const [route, hash] = href.split('#');
    return getRelativeLocaleUrl(locale, route) + (hash ? `#${hash}` : '');
  };

  const translateAll = ({ texts }: { texts: string[] }) => Object.fromEntries(texts.map((text) => [text, t(text)]));

  // Island props: spread as {...clientProps({ texts })}. Empty on English pages, so their markup stays unchanged.
  const clientProps = ({ texts }: { texts: string[] }) => (locale === 'en' ? {} : { dict: translateAll({ texts }) });

  const clientStrings = ({ texts }: { texts: string[] }) =>
    locale === 'en'
      ? ''
      : `<script type="application/json" data-i18n>${JSON.stringify(translateAll({ texts })).replace(/</g, '\\u003c')}</script>`;

  const localizeGuide = async ({ guide }: { guide: CollectionEntry<'guides'> }) => {
    if (locale === 'en') return guide;
    const entry = await getEntry('guides', `${dir}/${guide.id}`);
    if (REPORT) return entry ?? guide;
    const file = `src/content/guides/${dir}/${guide.id}.md`;
    if (!entry) return fail({ message: `[i18n] Missing guide translation: ${file}` });
    const date = ({ data }: CollectionEntry<'guides'>) => (data.updated ?? data.published).getTime();
    if (date(entry) < date(guide))
      fail({ message: `[i18n] Stale guide translation (older than the English guide): ${file}` });
    return entry;
  };

  return { t, url, locale, clientProps, clientStrings, localizeGuide };
};
