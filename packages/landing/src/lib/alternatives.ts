export const ALTERNATIVE_PAGES = [
  {
    label: 'Wallet by BudgetBakers alternative',
    href: '/alternatives/wallet-by-budgetbakers',
    switchIf: 'you want open-source code you can host yourself and your Wallet records, labels and transfers kept.',
    stayOn: 'Wallet',
    stayIf: 'you want a phone app that works offline: MoneyMatter needs a connection.',
    importer: 'Dedicated importer for Wallet CSV exports in English or Spanish.',
  },
  {
    label: 'YNAB alternative',
    href: '/alternatives/ynab',
    switchIf:
      'you want an open-source tracker you can host yourself for free, with your YNAB accounts, categories, payees, flags and transfers kept.',
    stayOn: 'YNAB',
    stayIf:
      'you budget the zero-based way: a MoneyMatter budget has a line per category with rollover and goals, but no Ready to Assign.',
    importer:
      'Dedicated importer for the YNAB register export: accounts, categories, payees, flags and transfers. It takes .csv files only.',
  },
  {
    label: 'Microsoft Money alternative',
    href: '/alternatives/microsoft-money',
    switchIf: 'your history is in a .mny file and you want it in an open-source web app you can also host yourself.',
    stayOn: 'Microsoft Money',
    stayIf:
      'you want a Windows desktop program that works with no internet connection, or if most of your history is in investment and loan accounts, which the import skips.',
    importer: 'Dedicated importer that reads .mny files directly, including password-protected ones.',
  },
  {
    label: 'Monarch Money alternative',
    href: '/alternatives/monarch',
    switchIf:
      'you hold accounts in more than one currency, live outside the US and Canada, or want to host the app yourself.',
    stayOn: 'Monarch',
    stayIf: 'you bank in the US or Canada and want bank sync and native phone apps in one subscription.',
    importer:
      'No dedicated importer. Monarch exports CSV, and MoneyMatter imports CSV with column mapping; this route has not been tested with a real Monarch file. An AI assistant connected over MCP is a second route for a short history.',
  },
].map((page) => ({ ...page, verdict: `Switch if ${page.switchIf} Stay on ${page.stayOn} if ${page.stayIf}` }));
