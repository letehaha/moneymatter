import { tc } from '@/i18n/client';

export type WidgetCard = { title: string; w: number; h: number; light: string; dark: string };
export type Widgets = { css: string; properties: string[]; cards: WidgetCard[] };
export type MountedWidget = { card: WidgetCard; shadow: ShadowRoot };

const PROPERTIES_ID = 'mm-widget-properties';

const NAMES = new Set([
  'Adobe Creative Cloud',
  'Amazon Prime',
  'Apple One',
  'Blue Bottle Coffee',
  'ChatGPT Plus',
  'Chipotle',
  'City Fuel',
  'Corner Coffee',
  'Costco',
  'DM Drogerie',
  "Dunkin'",
  'Green Market',
  'MediaMarkt',
  'Metro Transit',
  'Netflix',
  "Peet's Coffee",
  'Safeway',
  'Spotify',
  'Sweetgreen',
  'YouTube Premium',
]);
const SAVED_OF = '{saved} of {target}';
const SAVED_OF_EN = /^(\$[\d.]+K) of (\$[\d.]+[KM])$/;

const widgetKey = ({ text }: { text: string }) => {
  if (SAVED_OF_EN.test(text)) return SAVED_OF;
  return /[a-z]{2}/i.test(text) && !NAMES.has(text) ? text : null;
};

export const savedOf = ({ saved, target }: { saved: string; target: string }) =>
  tc({ text: SAVED_OF }).replace('{saved}', saved).replace('{target}', target);

export const translateWidgetText = ({ text }: { text: string }) => {
  const saved = text.match(SAVED_OF_EN);
  if (saved) return savedOf({ saved: saved[1], target: saved[2] });
  return widgetKey({ text }) ? tc({ text }) : text;
};

const decode = ({ html }: { html: string }) =>
  html
    .replaceAll('&nbsp;', '\u00a0')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&amp;', '&');

// Build time: the English keys a locale page must ship for these cards (plus extra script-set texts).
export const widgetTexts = ({ cards, texts = [] }: { cards: WidgetCard[]; texts?: string[] }) => [
  ...new Set(
    [
      ...cards.flatMap((card) =>
        [...card.light.replace(/<style[\s\S]*?<\/style>/g, '').matchAll(/>([^<]+)</g)].map(([, html]) =>
          decode({ html }).trim(),
        ),
      ),
      ...texts,
    ].flatMap((text) => widgetKey({ text }) ?? []),
  ),
];

const translateTree = ({ root }: { root: Node }) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const raw = node.nodeValue ?? '';
    const text = raw.trim();
    if (!text || node.parentElement?.localName === 'style') continue;
    const out = translateWidgetText({ text });
    if (out !== text) node.nodeValue = raw.replace(text, () => out);
  }
};

export const loadWidgets = ({ url }: { url: string }): Promise<Widgets> =>
  fetch(url).then((response) =>
    response.ok ? response.json() : Promise.reject(new Error(`${url} responded ${response.status}`)),
  );

export const mountWidgets = ({
  data,
  hosts,
  onPaint,
}: {
  data: Widgets;
  hosts: { card: WidgetCard; host: HTMLElement }[];
  onPaint?: (args: { mounted: MountedWidget[] }) => void;
}): MountedWidget[] => {
  if (!document.getElementById(PROPERTIES_ID)) {
    const properties = document.createElement('style');
    properties.id = PROPERTIES_ID;
    properties.textContent = data.properties.join('\n');
    document.head.appendChild(properties);
  }
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(
    `${data.css.replaceAll(':root', '.mm-root')}
    .mm-root { color: var(--foreground); font-family: 'Manrope', system-ui, sans-serif; height: 100%; container-type: inline-size; }
    .mm-root > * { height: 100%; }`,
  );

  const mounted = hosts.map(({ card, host }) => {
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.adoptedStyleSheets = [sheet];
    return { card, shadow };
  });
  const paintAll = () => {
    const dark = document.documentElement.dataset.theme === 'dark';
    mounted.forEach(({ card, shadow }) => {
      shadow.innerHTML = `<div class="mm-root ${dark ? 'dark' : ''}" inert>${dark ? card.dark : card.light}</div>`;
      translateTree({ root: shadow });
    });
    onPaint?.({ mounted });
  };
  paintAll();
  new MutationObserver(paintAll).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return mounted;
};
