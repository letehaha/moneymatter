/** Plain text only: the same strings feed the FAQ section and the FAQPage JSON-LD. */
export const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: 'Is my data secure?',
    answer:
      "Your browser talks to us over HTTPS. We store your bank credentials and AI keys encrypted with AES-256-GCM, so a stolen copy of the database can't reveal them. We don't sell or share your data, and Stripe handles your card, so we never see it. You won't find Google or Facebook trackers here. Sentry tells us about a crash the moment it happens and PostHog shows us where people get stuck, so we often ship a fix before you write to us. Anyone can audit the code on GitHub. Self-host, and your data stays on your server.",
  },
  {
    question: 'Which banks are supported?',
    answer:
      'Thousands of banks in 30+ countries. LunchFlow and SimpleFIN connect banks across the US, Canada and Europe. Monobank covers Ukraine. You open an account with the provider and MoneyMatter syncs from it. Bank sync comes with the Plus plan. If your bank is missing, import CSV, OFX or statement files.',
  },
  {
    question: 'What happens after the 40-day trial?',
    answer:
      "You start without a card, so we can't charge you when the trial ends. Skip the subscription and your account turns read-only: you can sign in, view and export your data, or delete the account. We don't delete anything.",
  },
  {
    question: "What's the difference between the plans?",
    answer:
      'Essential costs $30 a year. You get manual tracking, imports, budgets, investments, reports, backups, AI features on your own API key, the MCP server and 2 household seats. Plus costs $55 a year and adds bank sync, AI features on our key and 5 seats. Self-hosting is free and includes all of it.',
  },
  {
    question: "Self-hosted or cloud, what's the difference?",
    answer:
      'Both run the same app. Self-host for free with Docker on your own server, and we never see your data. You run the updates and plug in your own API key for crypto prices. On the cloud, we do that work for you: we host the app, ship updates and security patches, and pay for the data feeds behind stock and crypto prices, exchange rates and merchant logos.',
  },
  {
    question: 'Can I move between the cloud and my own server?',
    answer:
      'Yes, both ways. Export a backup on one and restore it on the other. Backup export works during the trial, so you can try the cloud first and move to your own server later with all your data.',
  },
  {
    question: 'Can I bring my data from another app?',
    answer:
      'Yes. MoneyMatter imports from YNAB, Wallet by BudgetBakers and Microsoft Money. For other apps, use CSV, OFX or bank statement import, with AI-assisted parsing for messy files.',
  },
  {
    question: 'What can an AI assistant see and do?',
    answer:
      'What you approve. When you connect an assistant, you pick one of three access levels: read, write, or write and delete. The assistant signs in through OAuth, and you can revoke its access in settings.',
  },
  {
    question: 'How do taxes and refunds work?',
    answer:
      'Stripe sells the subscription as merchant of record, so your card statement says "Link". Stripe adds VAT or sales tax at checkout. For a refund, email support@moneymatter.app within 14 days of your first payment. You get the full amount back, no questions asked.',
  },
];
