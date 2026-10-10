/**
 * Everything the landing FAQ assistant may state as fact. The model is told to answer from
 * this text alone, so a claim missing here is a claim it refuses to make. Keep it in step
 * with the landing copy (pricing, FAQ, comparison) and with what the app ships. "Not
 * supported" lines are deliberate: they turn "I don't know" into a straight "no".
 */
export const LANDING_FAQ_KNOWLEDGE = `
# MoneyMatter

MoneyMatter is an open-source (AGPL-3.0) personal finance app: accounts, transactions, budgets,
investments, loans, vehicles, venture deals, reports and net worth in one place. It runs as a
hosted cloud service at moneymatter.app or self-hosted on your own server. It is built by one
developer, in the open. Source: https://github.com/letehaha/moneymatter

## Plans and pricing (cloud)

- 40-day free trial. No card needed to start, so nothing is charged when it ends. The trial gives
  every Plus feature (bank sync and AI on our key included) and 5 seats. One exception: restoring
  a backup needs a paid plan. Backup export works during the trial.
- After the trial without a subscription, after cancelling, or after failed payments, the account
  turns read-only: you can sign in, view and export data, or delete the account. Nothing is deleted.
- There is no free cloud plan, only the trial. Self-hosting is free forever with every feature.
- Essential: $30/year or $5/month. Manual tracking, imports (CSV, OFX, YNAB, Wallet, MS Money),
  budgets, investments, loans, vehicles, venture, reports, backup export and restore, AI features
  with your own API key, MCP server for AI agents, 2 household seats. No bank sync.
- Plus: $55/year or $8/month. Everything in Essential, plus bank sync, AI features on our key
  with no setup, 5 household seats.
- Premium: planned, price not decided. Built-in bank sync with no provider account, real-time
  security prices, higher AI usage cap, 10 household seats. Roadmap and voting:
  https://moneymatter.featurebase.app/dashboard/roadmap
- Seats are fixed per plan and cannot be bought one by one. At the limit, new invitations are
  blocked until you upgrade.
- Switching monthly to yearly or Essential to Plus: Settings > Plan & billing opens the Stripe
  billing portal, which shows the charge or credit before you confirm.
- Prices are in USD. Taxes are calculated at checkout. Cancel anytime.
- Promo codes can be entered at checkout. No lifetime deal. "Early Adopter" is a grant for
  accounts that existed before paid plans launched; new signups cannot get it.

## Payments, taxes, refunds

- Stripe sells the subscription as merchant of record, so a card statement says "Link". Payment
  is by card through Stripe's hosted checkout.
- Stripe adds VAT or sales tax at checkout. MoneyMatter never sees card details.
- Refunds: email support@moneymatter.app within 14 days of the first payment for the full amount
  back, no questions asked.

## Bank connections

- Bank sync is part of Plus (also in the trial and on self-hosted). Essential does not include it.
- Providers by region: Monobank (Ukraine). LunchFlow (US, Canada, EU, UK, Australia, New Zealand
  and more countries worldwide). SimpleFIN (US, Canada). Walutomat (Poland).
- LunchFlow and SimpleFIN are separate paid services: you open an account with them and pay them
  directly, on top of Plus. Monobank and Walutomat cost nothing extra.
- Banks in the EU, the UK and any other country not named above connect through LunchFlow. To
  see whether a country or one specific bank is covered, search LunchFlow's coverage list:
  https://www.lunchflow.app/coverage
- Read-only: sync can view accounts, balances and transactions. It can never move money.
- Your bank password is never stored. Only provider tokens and keys are kept, encrypted with
  AES-256-GCM.
- Sync runs automatically while you use the app, at most once every 12 hours, and you can start a
  sync by hand anytime. Balances update with every sync.
- History on first connect: 12 months with Walutomat, about 6 months with SimpleFIN, 31 days with
  Monobank (Monobank's own limit), and whatever LunchFlow has already collected for LunchFlow.
- A broken connection is flagged and you reconnect it.
- You can connect several banks, providers and countries at once, and several accounts per bank.
- Bank-synced transactions: category, note, tags, payee and splits are editable; amount, date,
  type and account are locked.
- Not supported: PayPal, Stripe or broker connections.
- If a bank is missing: import CSV, OFX/QFX or statement files instead.

## Importing and exporting

- Direct importers for YNAB, Wallet by BudgetBakers and Microsoft Money.
- CSV import with column mapping, plus OFX and QFX. Every import detects and skips duplicates and
  reconciles the account balance.
- Paste a bank statement or an email and AI turns it into transactions.
- Export everything to CSV or Excel: transactions, accounts, categories, tags, payees, budgets,
  subscriptions, templates and investments. Full backup export and restore too.

## Budgets

- A budget is one spending limit over a date range you choose freely. It is either a category
  budget (tracks one or more categories automatically) or a manual budget (you attach
  transactions). Going over the limit is shown in red; nothing is blocked.
- Transfers between your own accounts never count. Refunds count back automatically. Budgets can
  be shared with a partner. Spending in other currencies is converted into your base currency.
- Envelope budgeting is in development and not available yet.
- Not supported today: zero-based budgeting, rollover of unspent amounts, repeating monthly
  budgets, copying a budget, savings goals, "safe to spend", balance forecasts, percentage rules
  like 50/30/20, budgets by tag or payee, a budget limited to one account.
- Debt payoff: the Loans feature projects the payoff date and remaining balance.

## Transactions

- Split one transaction across several categories. Transfers between your own accounts are one
  linked pair, across currencies too.
- Attach receipts and photos. Add notes. Tags exist alongside categories, several per transaction.
- Your own categories and subcategories. Bulk edit and bulk delete.
- Automation rules match on payee, note text, amount, account, type or day of month, and set
  category, tags, payee or note. They can also run over past transactions.
- Filter and search by category, payee, tag, account, amount range, date range and note text.
- Refunds and reimbursements link to the original transaction. Payees are detected automatically.
- Reusable transaction templates for quick repeat entries, such as cash spending.
- Recurring subscriptions are detected from your history and suggested for confirmation. Upcoming
  payments send reminders in the app and by email.
- Not supported: hiding a single transaction from reports (a whole account can be excluded),
  splitting a bill with another person and settling up, mileage, per-diem or invoicing.

## Accounts, currencies, net worth

- Account types: general, cash, current account, credit card (with credit limit), savings, bonus,
  insurance, investment, loan, overdraft, crypto, vehicle. Accounts can be archived.
- Correct any account balance to a target value, backdated too.
- About 158 fiat currencies with automatic exchange rates. Each transaction is converted at the
  rate of its own date. Crypto is tracked as an investment holding, not as an account currency.
- Net worth: cash, investments, vehicles, venture deals and loans on one chart in your base
  currency, filterable by asset type and period.
- Loans you owe: mortgage, auto, student, personal, with amortization and a payment schedule.
- Vehicles with depreciation. Venture and private deals.
- Not supported: a real-estate asset type, tracking money you lent to someone.

## Investments

- Stocks, ETFs and crypto, entered by hand or imported from a file. Cost basis (average cost
  method), realized and unrealized return per holding, dividends, several portfolios.
- Stock and ETF prices update once a day, crypto hourly. Nothing is real-time. Non-US listings
  often work, including European UCITS ETFs, but coverage of a given exchange is not guaranteed.
- Not supported: connecting a broker or crypto exchange, bonds, options, mutual funds.

## Reports and dashboard

- Cash flow (income against expenses by month), money flow (income sources to categories), pivot
  tables by category, payee, account or period, net worth and balance history.
- The dashboard is a grid of widgets you add, remove and rearrange.
- Not supported: a free-form custom report builder.

## Family sharing

- Invite people by email with read-only or write access, per account or budget. Write access can
  be limited to their own transactions. Access can be revoked, and the invitee can leave.

## Apps, languages, sign-in

- Web app only today. An iOS app is under development, with no release date yet. No Android or
  desktop app. The web app can be added to a phone home screen as a PWA, but there is no offline mode.
- Languages: English, Ukrainian, Spanish, Indonesian, Russian. Spanish, Indonesian and Russian
  are community translations. Dark mode is supported.
- Sign in with email and password, Google, GitHub or passkeys. You can see and log out active
  sessions.
- Not supported: Apple sign-in, two-factor authentication, changing the account email, push or
  Telegram notifications.
- Delete your account yourself in Settings > Security. It removes your data and cancels any
  subscription.

## AI and MCP

- Three AI features: automatic transaction categorization, turning a pasted or uploaded statement
  into transactions, and parsing investment transactions. Categorization runs after a bank sync
  and on request; the parsers run only when you use them.
- AI runs on our key (Plus) or on your own API key (Essential and self-hosted): OpenAI, Anthropic,
  Google Gemini, or any OpenAI-compatible server such as Groq, OpenRouter, or local models through
  Ollama or LM Studio. AI costs nothing extra from MoneyMatter; with your own key you pay that
  provider.
- What AI sees: for categorization, the transaction amount, currency, date, account name, note,
  payee and your category names. For parsing, the text or image you submit.
- Without a key on Essential or self-hosted, AI stays off. There is no single off switch on Plus.
- The MCP server lets an AI assistant work with your data: accounts, transactions, categories,
  tags, payees, budgets, analytics, investments, subscriptions, automation rules and venture
  deals. You pick one of three access levels when connecting it: read, write, or write and
  delete. It signs in through OAuth (no API tokens) and access can be revoked in settings.
- Connect it from Settings > AI > Connectors (MCP), with guided setup for Claude and ChatGPT. It
  works on self-hosted too.
- Not supported: a public REST API, an SDK, webhooks.

## Security and privacy

- Traffic is HTTPS. Bank credentials and AI keys are stored encrypted with AES-256-GCM. Passwords
  are hashed.
- Data is never sold or shared. No ads. No Google or Facebook trackers.
- Sentry reports crashes and PostHog shows product usage, so problems get fixed quickly. PostHog
  respects the browser's Do Not Track setting. Self-hosted installs send no analytics.
- The code is open for audit on GitHub. Self-hosted data never leaves your server.
- You can export all your data at any time.

## Self-hosting

- Same app as the cloud, free, every feature unlocked, no plans or trial. Deployed with Docker
  Compose. Runs on a $5 VPS. 2 GB RAM minimum. Published images are amd64; ARM hosts such as a
  Raspberry Pi build from source.
- Stack: Postgres, Redis and a bundled exchange-rate service. Docker Compose is the only
  supported setup: no Kubernetes, Helm or Unraid templates, no install without Docker.
- No domain or HTTPS needed for a local or LAN trial. For public access there are recipes for
  nginx, Nginx Proxy Manager, Caddy and Traefik, plus a bundled Traefik with Let's Encrypt.
- Exchange rates and stock prices work without any API key. Crypto prices need your own CoinGecko
  key. AI, merchant logos, email and Google or GitHub sign-in are optional and use your own keys.
  Without email set up, invitation links are shared by hand.
- Bank sync works on self-hosted with your own provider accounts.
- Up to 10 users per instance. Sign-ups can be capped or closed.
- Update with "docker compose pull" then "docker compose up -d". Back up with pg_dump plus the
  attachments volume; the same backup moves you to another server. Releases are tagged on GitHub
  with release notes.
- On the cloud, hosting, updates, security patches and the data feeds (stock and crypto prices,
  exchange rates, merchant logos) are handled for you.
- Setup guide: https://github.com/letehaha/moneymatter/tree/main/self-hosting
- Moving between cloud and self-hosted works both ways: export a backup on one, restore it on
  the other.
- The "Try demo" button on the landing page opens a ready-made demo account with no sign-up.

## Compared with other apps

- Monarch, Copilot and similar: $70-200/year, closed source, US/CA bank aggregators only,
  balances-only investments, USD/CAD only.
- YNAB: $109/year, closed source, US/CA plus limited EU bank sync, one currency per budget.
- MoneyMatter: from $30/year, open source and self-hostable, bank sync in 30+ countries,
  investments including crypto, multi-currency, full export and backup.

## Moving from Wallet by BudgetBakers

- The importer is under Settings, Import/Export, "Wallet (BudgetBakers)". It reads the CSV export
  from Wallet. Several files can be uploaded at once, up to about 10 MB and 100,000 rows together.
- Imported: every record with its category and payee. Labels become tags. Transfers between
  Wallet accounts are joined back into one transfer when the two records share a date and time,
  sit in different accounts and their amounts are within 1% of each other. A transfer record with
  no partner is imported as money moved outside the tracked accounts.
- During the import each Wallet account is created as new, linked to an existing account or
  skipped, and each Wallet category is mapped to an existing one or created. A review step lists
  possible duplicates before anything is saved. An import can be undone from Import History.
- Not imported: budgets, planned payments and goals.
- Not supported: Wallet exports in a language other than English or Spanish. Set Wallet to
  English or Spanish before exporting.
- Wallet's CSV export needs Wallet Premium, and the Wallet iOS app has no export; use Wallet's
  web app. (Checked October 2026.)
- Compared with Wallet (checked October 2026): Wallet is closed source and cloud only, does not
  list its price on its website, and has native iOS and Android apps with offline mode and a free
  plan for manual tracking. MoneyMatter is open source and self-hostable, lists its price, links
  refunds to purchases, tracks loans, vehicles and venture deals, has pivot reports and a FIRE
  planner, and offers a full backup and restore.
- Full comparison: https://moneymatter.app/alternatives/wallet-by-budgetbakers

## Contact and community

- Support: support@moneymatter.app
- Bugs: https://github.com/letehaha/moneymatter/issues
- Feature requests, voting and roadmap: https://moneymatter.featurebase.app/dashboard/roadmap
- There is no Discord, Telegram or Slack community.
- Tech stack: TypeScript, Node.js with Express, PostgreSQL, Redis, Vue 3. Contributions are
  welcome on GitHub; a CLA is signed on the first pull request.
`.trim();
