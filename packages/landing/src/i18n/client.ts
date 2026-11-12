let dict: Record<string, string> | undefined;

export const tc = ({ text }: { text: string }) => {
  dict ??= Object.assign(
    {},
    ...[...document.querySelectorAll('script[data-i18n]')].map((el) => JSON.parse(el.textContent || '{}')),
  ) as Record<string, string>;
  if (import.meta.env.DEV && document.documentElement.lang !== 'en' && !(text in dict)) {
    console.warn(`[i18n] Not in any data-i18n block on this page: ${text}`);
  }
  return dict[text] ?? text;
};

export const rememberLocale = () => {
  const locale = document.documentElement.lang;
  if (locale === 'en') return;
  try {
    if (!localStorage.getItem('preferred-locale')) localStorage.setItem('preferred-locale', locale);
  } catch {}
};

export const DEMO_STRINGS = {
  network: "Couldn't reach the server. Please check your connection and try again.",
  rateLimited: 'Too many demo sessions from this network. Please try again in a few minutes.',
  failed: "Couldn't start the demo. Please try again.",
  overlayTitle: 'Setting up your demo...',
};

export const FAQ_ERRORS = {
  network: DEMO_STRINGS.network,
  rateLimited: "That's a lot of questions. Please try again in a few minutes, or email support@moneymatter.app.",
  server: "Couldn't get an answer right now. Please email support@moneymatter.app.",
};

export const FAQ_ASK_STRINGS = [
  'Ask anything else…',
  'Ask a question about MoneyMatter',
  'Ask',
  'Thinking…',
  'Please ask a longer question.',
  'AI-generated, may be wrong. For anything important, email us at <a href="mailto:{email}">{email}</a>.',
  ...Object.values(FAQ_ERRORS),
];
