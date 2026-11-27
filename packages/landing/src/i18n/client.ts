import { GIFT_PLANS } from '@/lib/plans';

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

export const GIFT_ERRORS = {
  network: DEMO_STRINGS.network,
  rateLimited: 'Too many checkout attempts from this network. Please try again in a few minutes.',
  failed: "Couldn't start the checkout. Please try again, or email support@moneymatter.app.",
};

export const GIFT_FORM_STRINGS = [
  ...GIFT_PLANS.flatMap((plan) => [plan.name, plan.tagline]),
  'Choose a plan',
  'Popular',
  'for 12 months',
  'Your name',
  'Your email',
  "Recipient's name",
  "Recipient's email",
  'Message (optional)',
  'Send on a specific date',
  'Delivery date',
  'We email the gift at 9:00 your time on that day.',
  'Without a date, we email the gift right after payment.',
  'Continue to payment',
  'Opening checkout…',
  'Price before tax. Promo codes can be applied at checkout.',
  'Payment received',
  "We'll email the gift code to the recipient, right away or on the date you chose. You'll get a confirmation email too.",
  'Send another gift',
  ...Object.values(GIFT_ERRORS),
];
