export const ALTERNATIVE_PAGES = [
  {
    label: 'Wallet by BudgetBakers alternative',
    href: '/alternatives/wallet-by-budgetbakers',
    verdict:
      'Switch if you want open-source code you can host yourself and your Wallet records, labels and transfers kept. Stay on Wallet if you want a native phone app that works offline: MoneyMatter is a web app and needs a connection.',
    importer: 'Dedicated importer for Wallet CSV exports in English or Spanish.',
  },
  {
    label: 'YNAB alternative',
    href: '/alternatives/ynab',
    verdict:
      'Switch if you want an open-source tracker you can host yourself for free, with your YNAB accounts, categories, payees, flags and transfers kept. Stay on YNAB if you budget the zero-based way: a MoneyMatter budget has a line per category with rollover and goals, but no Ready to Assign.',
    importer:
      'Dedicated importer for the YNAB register export: accounts, categories, payees, flags and transfers. It takes .csv files only.',
  },
  {
    label: 'Microsoft Money alternative',
    href: '/alternatives/microsoft-money',
    verdict:
      'Switch if your history is in a .mny file and you want it in an open-source web app you can also host yourself. Stay on Microsoft Money if you want a Windows desktop program that works with no internet connection, or if most of your history is in investment and loan accounts, which the import skips.',
    importer: 'Dedicated importer that reads .mny files directly, including password-protected ones.',
  },
  {
    label: 'Monarch Money alternative',
    href: '/alternatives/monarch',
    verdict:
      'Switch if you hold accounts in more than one currency, live outside the US and Canada, or want to host the app yourself. Stay on Monarch if you bank in the US or Canada and want bank sync and native phone apps in one subscription.',
    importer:
      'No dedicated importer. Monarch exports CSV, and MoneyMatter imports CSV with column mapping; this route has not been tested with a real Monarch file. An AI assistant connected over MCP is a second route for a short history.',
  },
];
