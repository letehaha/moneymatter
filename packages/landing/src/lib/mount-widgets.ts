export type WidgetCard = { title: string; w: number; h: number; light: string; dark: string };
export type Widgets = { css: string; properties: string[]; cards: WidgetCard[] };
export type MountedWidget = { card: WidgetCard; shadow: ShadowRoot };

const PROPERTIES_ID = 'mm-widget-properties';

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
