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
  budgets, savings goals, investments, loans, vehicles, venture, reports, backup export and restore, AI features
  with your own API key, MCP server for AI agents, 2 household seats. No bank sync.
- Plus: $55/year or $8/month. Everything in Essential, plus bank sync, AI features on our key
  with no setup, 5 household seats.
- Premium: planned, not for sale yet. Planned price $80/year or $12/month. Bank sync we run for
  you: no API keys and no provider subscription to pay (you still sign in to the bank through our
  partner's page). 2 bank connections included with unlimited accounts each, extra banks
  $2/month. Real-time security prices, higher AI usage cap, 10 household seats. Leave an email
  with "Get early access" on the pricing section to hear when it opens.
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
- CSV import with column mapping, plus OFX and QFX.
- Duplicates: the CSV, OFX/QFX, Wallet and Microsoft Money importers flag possible duplicates when
  you import into an account you already have, and skip them unless you choose otherwise. Nothing
  is flagged in accounts the import creates. The YNAB importer has no duplicate check.
- Paste a bank statement or an email and AI turns it into transactions.
- Export everything to CSV or Excel: transactions, accounts, categories, tags, payees, budgets,
  subscriptions, templates and investments. Full backup export and restore too.

## Budgets

- A budget is split into lines. Each line covers one or more categories and has an assigned
  amount for the period; it shows what is assigned, spent and left. Lines can be put in groups
  such as Bills or Everyday. Going over a line is shown in red; nothing is blocked.
- The budget resets on a schedule: monthly, semi-monthly, biweekly, weekly, or every few days or
  months. The schedule cannot be changed after the budget is created.
- Rollover: carry leftovers into the next period, carry overspending too, or start fresh. Set for
  the budget, and each line can have its own rule.
- Goals on a line: fund it every period, refill it up to an amount, or save up to a balance by a
  date. These budget line goals are separate from the savings Goals page described below.
- A new budget can be pre-filled with lines and amounts from your own spending history, and you
  choose which accounts it counts.
- Trackers are separate: one spending limit over a date range you choose freely, for a set of
  categories or for transactions you attach. Use one for a trip or a project. A tracker can be
  shared with a partner.
- Transfers between your own accounts never count. Refunds count back automatically. Spending in
  other currencies is converted into your base currency.
- You can have one budget at a time, and it always uses your base currency.
- Budgeting is included in Essential and Plus. The Early Adopter grant does not include it:
  early adopters can try it for 40 days from their first budget, then the budget turns read-only
  until they subscribe.
- Not supported today: zero-based budgeting with a "Ready to Assign" pool, balance forecasts,
  "safe to spend", percentage rules like 50/30/20, budgets by tag or payee.
- Debt payoff: the Loans feature projects the payoff date and remaining balance.

## Savings goals

- A goal is a target amount, in any currency, with an optional target date. It lives on its own
  Goals page (sidebar, Planned > Goals), separate from budgets.
- Progress is read from real account balances; goals never move money or create transactions.
  Each linked account counts by a percentage share of its balance (minus its credit limit,
  never below 0). One account can back several goals, but its shares across active and paused
  goals cannot pass 100%. Archiving a goal frees its shares; pausing keeps them.
- Accounts that can back a goal: your own general, cash, current, savings, investment and crypto
  accounts. Not credit cards, overdrafts, loans, vehicles or accounts shared with you. On
  investment and crypto accounts market moves count as progress; projections assume no growth.
- Each goal shows saved, left, pace, a projected finish month and how much is needed per month to
  hit the date. Pace is the median monthly change over the last 6 full months and needs at least
  3; an optional planned monthly amount replaces it. Statuses: ahead, on track, behind, overdue,
  reached, and a projected month for goals without a date.
- A What-if tab tries another monthly amount, date or account shares without saving anything. A
  banner compares what all active goals need per month with the median monthly net cash flow of
  the last 12 complete months and says whether they fit.
- A dashboard widget lists active goals. Reaching a goal sends one in-app notification.
- The MCP server can list goals with their progress and create, update or delete them.
- Goals are included in Essential and Plus (and the 40-day trial). The Early Adopter grant does
  not include them: early adopters can start a 14-day goals trial from the Goals page. No limit on
  the number of goals.
- Not supported: portfolios as goal sources, fixed-amount earmarks ("$3,000 of this account"),
  moving money into a goal, investment growth projections.

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
- Loans you owe: mortgage, auto, student, personal, with a projected payoff date, the interest still to pay, and a balance projection chart. No amortization table and no principal/interest split per payment.
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
  tables by category, payee or tag per week, month, quarter or year, net worth and balance history.
- The dashboard is a grid of widgets you add, remove and rearrange.
- Not supported: a free-form custom report builder.

## Family sharing

- Invite people by email with read-only or write access, per account or tracker. Write access can
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
  tags, payees, budgets, goals, analytics, investments, subscriptions, automation rules and venture
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

- Monarch, Copilot and similar: about $100-200/year, closed source, US/CA bank aggregators only,
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

## Moving from YNAB

- The importer is under Settings, Import/Export, "Import from YNAB". It reads the register file
  (the one with your transactions) from the Export Plan download in the YNAB web app. One .csv
  file, up to 10 MB and 100,000 rows.
- Imported: every account as a new account, with YNAB's Starting Balance as its initial balance.
  "Group: Category" becomes a category with a subcategory. Payees, memos as notes, and flags as
  tags such as "YNAB Red". Transfers between two of your accounts are joined into one transfer
  when both sides share a date and an amount. An import can be undone from Import History.
- Not imported: assigned amounts, targets and Ready to Assign. Only the register is read.
- Limits: every import creates new accounts, so YNAB history cannot be added to an existing
  account, and importing the same file twice creates a second set of accounts. A split arrives as
  separate transactions. A transfer between two currencies keeps the same number on both sides.
- Not supported: .tsv files. YNAB exports tab-separated files instead of CSV for currencies that
  use a decimal comma. (Checked October 2026.)
- If you budget the zero-based way with Ready to Assign, YNAB is the better fit. MoneyMatter has
  category lines with rollover and goals, but no Ready to Assign.
- Full comparison: https://moneymatter.app/alternatives/ynab

## Moving from Microsoft Money

- The importer is under Settings, Import/Export, "Microsoft Money". It reads the .mny file
  itself, password-protected ones too. No QIF or CSV export is needed. Up to 50 MB and 100,000
  transactions.
- Imported: banking, credit card, cash, asset and liability accounts. Transactions with category,
  payee and memo. Categories. Each line of a split as its own transaction. Transfers between two
  imported accounts, once each. Voided transactions only if you tick the box. An import can be
  undone from Import History.
- During the import each account is created as new, linked to an existing account in the same
  currency, or skipped.
- Not imported: investment and loan accounts (skipped with a warning), budgets, bills and reports.
- Tested with sample files from Money 2001, 2002, 2004, 2005, 2008 and Money Plus Sunset. Only
  the Money 2005 and Sunset samples contain a full ledger. The Money 2001 and 2002 samples have no
  payee column, so payees are not read from files laid out that way.
- Full comparison: https://moneymatter.app/alternatives/microsoft-money

## Moving from Monarch Money

- There is no dedicated Monarch importer. Monarch exports transactions as a CSV file, and the
  CSV import with column mapping (Settings, Import/Export, "Import CSV") takes CSV files. This
  route has not been tested with a real Monarch export.
- One currency per file. A transfer arrives as two transactions; link the pair afterwards with
  Transfer matching. Only transactions are imported, not budgets, goals, rules or holdings.
- Second route for a short history: an AI assistant connected to the MCP server with write
  access. Every transaction is its own tool call, so a long history is slow.
- Full comparison: https://moneymatter.app/alternatives/monarch

## Contact and community

- Support: support@moneymatter.app
- Bugs: https://github.com/letehaha/moneymatter/issues
- Feature requests, voting and roadmap: https://moneymatter.featurebase.app/dashboard/roadmap
- Community, questions and discussion: https://www.reddit.com/r/moneymatterapp/ (subreddit r/moneymatterapp)
- There is no Discord, Telegram or Slack community.
- Tech stack: TypeScript, Node.js with Express, PostgreSQL, Redis, Vue 3. Contributions are
  welcome on GitHub; a CLA is signed on the first pull request.
`.trim();
