# Connect an AI agent to MoneyMatter

MoneyMatter exposes a remote Model Context Protocol (MCP) server. Connecting an
agent to this server gives the agent OAuth-secured access to the user's
financial data (accounts, transactions, trackers, savings goals,
subscriptions, transaction automations, categories, tags, cash flow, balance
history, investment portfolios, holdings, and investment transactions). The
agent can read these records and — when the user grants the corresponding
scopes — create, edit, and delete them.

Use this skill when the user asks to "connect Claude to my budget", "hook up
ChatGPT to MoneyMatter", "let my AI see my finances", or similar.

## Endpoints

- **MCP transport**: `https://mcp.moneymatter.app/mcp` (Streamable HTTP)
- **Server card**: <https://moneymatter.app/.well-known/mcp/server-card.json>
- **OAuth Authorization Server metadata**: <https://moneymatter.app/.well-known/oauth-authorization-server>
- **OAuth Protected Resource metadata**: <https://moneymatter.app/.well-known/oauth-protected-resource>

## OAuth scopes

| Scope            | Purpose                                                          |
| ---------------- | ---------------------------------------------------------------- |
| `finance:read`   | Read accounts, transactions, trackers, subscriptions, analytics  |
| `finance:write`  | Create and edit transactions, trackers, subscriptions, and more  |
| `finance:delete` | Permanently delete records (transactions, trackers, portfolios…) |
| `profile:read`   | Read the user's profile (name, email, base currency)             |
| `offline_access` | Receive a refresh token so sessions survive expiration           |

The MoneyMatter consent screen lets the user grant or deny `finance:write` and
`finance:delete` independently. Always request the narrowest set of scopes
sufficient for the job — read-only agents should not request write or delete.
Users can revoke a connected app at any time from the MoneyMatter settings
page.

## Setup steps (Claude Desktop, Claude.ai, ChatGPT, OpenClaw)

1. Ensure the user has a MoneyMatter account. If not: direct them to
   <https://moneymatter.app/sign-up>.
2. In the agent client, add a new MCP server using the URL
   `https://mcp.moneymatter.app/mcp`.
3. The client discovers the OAuth authorization server from the
   `/.well-known/oauth-protected-resource/mcp` endpoint automatically.
4. The client opens a browser window for the user to sign in and authorize
   the requested scopes. The user grants consent in the MoneyMatter UI.
5. On success, the agent receives tokens and can list the tools exposed by
   the server (see below).

## Available tools

| Tool                                    | Purpose                                                                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `get_user_profile`                      | Base currency, configured currencies, profile basics                                                             |
| `get_accounts`                          | List accounts with balances, types, currencies                                                                   |
| `search_transactions`                   | Filter transactions by date, category, tag, amount, etc.                                                         |
| `get_categories`                        | List spending/income categories                                                                                  |
| `get_tags`                              | List transaction tags                                                                                            |
| `get_trackers`                          | Trackers with limits, categories and lines                                                                       |
| `create_tracker`                        | Create a new tracker with limit, date range, categories, smart tracking (`finance:write`)                        |
| `update_tracker`                        | Update name, dates, limit (null clears), categories, or smart tracking of a tracker (`finance:write`)            |
| `delete_tracker`                        | Permanently delete a tracker and its transaction links (`finance:delete`)                                        |
| `archive_tracker`                       | Archive or restore a tracker — active ↔ archived (`finance:write`)                                               |
| `add_transactions_to_tracker`           | Link transactions to a manual tracker (`finance:write`)                                                          |
| `remove_transactions_from_tracker`      | Unlink transactions from a tracker (`finance:write`)                                                             |
| `get_tracker_spending_stats`            | Category breakdown, time-series, per-line spent and "other" spending for a tracker                               |
| `create_tracker_line`                   | Add a line (category set + optional limit) to a tracker (`finance:write`)                                        |
| `update_tracker_line`                   | Update a tracker line's name, categories, limit, or position (`finance:write`)                                   |
| `delete_tracker_line`                   | Permanently delete a tracker line (`finance:delete`)                                                             |
| `list_tracker_suggestions`              | Smart-tracking suggestions (score, AI reason), AI-matched transactions, scan status of an owned tracker          |
| `accept_tracker_suggestions`            | Accept pending suggestions, linking their transactions (`finance:write`)                                         |
| `reject_tracker_suggestions`            | Reject suggestions; also unlinks AI-linked or accepted ones (`finance:write`)                                    |
| `get_goals`                             | Savings goals with backing accounts, shares, progress, pace, ETA, needed per month (goal currency)               |
| `create_goal`                           | Create a savings goal funded by % shares of accounts (`finance:write`, Goals feature)                            |
| `update_goal`                           | Update target, date, monthly plan, accounts, or status of a goal (`finance:write`, Goals feature)                |
| `delete_goal`                           | Permanently delete a goal and free its account shares (`finance:delete`, Goals feature)                          |
| `get_spending_by_categories`            | Aggregate spending by category over a range                                                                      |
| `get_cash_flow`                         | Income vs expenses over a range                                                                                  |
| `get_balance_history`                   | Time-series of account balances                                                                                  |
| `get_expenses_for_period`               | Expenses summary for a time period                                                                               |
| `get_portfolios`                        | List investment portfolios (types, enabled state)                                                                |
| `get_portfolio_summary`                 | Portfolio totals, P&L, cash balances                                                                             |
| `get_portfolio_holdings`                | Positions with market value and gains/losses                                                                     |
| `get_portfolio_balances`                | Portfolio cash balances per currency                                                                             |
| `get_investment_transactions`           | Buy/sell/dividend/fee history for investments                                                                    |
| `search_securities`                     | Search securities by ticker/name; resolves to securityId                                                         |
| `create_portfolio`                      | Create a new investment portfolio (`finance:write`)                                                              |
| `update_portfolio`                      | Rename, recategorize, or disable a portfolio (`finance:write`)                                                   |
| `delete_portfolio`                      | Delete a portfolio and optionally all its data (`finance:delete`)                                                |
| `create_investment_transaction`         | Record a buy/sell/dividend/fee transaction (`finance:write`)                                                     |
| `update_investment_transaction`         | Correct a transaction's date, quantity, price, or fees (`finance:write`)                                         |
| `delete_investment_transaction`         | Delete an investment transaction (`finance:delete`)                                                              |
| `link_transaction_to_portfolio`         | Link an existing transaction to a portfolio as a cash transfer (`finance:write`)                                 |
| `unlink_transaction_from_portfolio`     | Remove a transaction's portfolio link and reverse the cash change (`finance:write`)                              |
| `transfer_account_to_portfolio`         | Move cash from an account into a portfolio (`finance:write`)                                                     |
| `transfer_portfolio_to_account`         | Withdraw portfolio cash into an account (`finance:write`)                                                        |
| `create_portfolio_cash_transaction`     | Direct portfolio cash deposit/withdrawal, no account involved (`finance:write`)                                  |
| `list_portfolio_transfers`              | Cash movement history of a portfolio (transfers, deposits, exchanges)                                            |
| `adjust_account_balance`                | Set an account to a target balance via an adjustment transaction (`finance:write`)                               |
| `archive_account`                       | Archive or unarchive an account; handles side effects (`finance:write`)                                          |
| `get_transaction_groups`                | List transaction groups with counts/dates or full embedded transactions                                          |
| `create_transaction_group`              | Bundle related transactions into a group (e.g. split bill) (`finance:write`)                                     |
| `update_transaction_group`              | Rename or add a note to an existing group (`finance:write`)                                                      |
| `delete_transaction_group`              | Delete a group — transactions kept (`finance:delete`)                                                            |
| `add_transactions_to_group`             | Add transactions to an existing group (`finance:write`)                                                          |
| `remove_transactions_from_group`        | Remove transactions from a group, optionally dissolving it (`finance:write`)                                     |
| `get_subscriptions`                     | List subscriptions/bills with frequency, amount, and linked count                                                |
| `get_subscription_by_id`                | Single subscription with linked transactions and next payment date                                               |
| `create_subscription`                   | Create a subscription, bill, or installment — expense by default or income via transactionType (`finance:write`) |
| `update_subscription`                   | Update subscription fields (`finance:write`)                                                                     |
| `delete_subscription`                   | Delete a subscription and its transaction links (`finance:delete`)                                               |
| `toggle_subscription_active`            | Activate or deactivate a subscription (`finance:write`)                                                          |
| `detect_subscription_candidates`        | Scan 12 months of transactions to auto-detect recurring patterns (`finance:write`)                               |
| `list_subscription_candidates`          | List auto-detected candidates sorted by confidence score                                                         |
| `dismiss_subscription_candidate`        | Dismiss a pending candidate (`finance:write`)                                                                    |
| `link_transactions_to_subscription`     | Mark transactions as payment instances of a subscription (`finance:write`)                                       |
| `unlink_transactions_from_subscription` | Remove transaction links from a subscription (`finance:write`)                                                   |
| `get_upcoming_subscription_payments`    | Upcoming payments sorted by next expected date                                                                   |
| `get_subscriptions_summary`             | Monthly/yearly cost, expected monthly income, and per-direction active counts in base currency                   |
| `get_transaction_automations`           | List automation rules with evaluation order, enabled state, match counts, and pause reason                       |
| `preview_transaction_automation`        | Dry-run automation conditions against recent transactions; nothing is modified                                   |
| `create_transaction_automation`         | Create a rule that sets category, tags, payee, or note on matching transactions (`finance:write`)                |
| `update_transaction_automation`         | Change a rule name, conditions, actions, or enabled state (`finance:write`)                                      |
| `delete_transaction_automation`         | Permanently delete an automation rule (`finance:delete`)                                                         |
| `reorder_transaction_automations`       | Set the top-to-bottom evaluation order of the automation rules (`finance:write`)                                 |
| `create_transaction`                    | Create income, expense, or transfer with optional splits/tags/payee/original-currency amount (`finance:write`)   |
| `update_transaction`                    | Update amount, date, category, payee, tags, note, splits, or original-currency amount (`finance:write`)          |
| `delete_transaction`                    | Permanently delete a transaction; transfer pairs are deleted together (`finance:delete`)                         |
| `create_attachment_upload_url`          | Get a short-lived URL to upload receipt files (JPEG/PNG/WebP/PDF) to a transaction over HTTP (`finance:write`)   |
| `bulk_update_transactions`              | Update category, payee, note, or tags on multiple transactions at once (`finance:write`)                         |
| `split_transaction`                     | Split a transaction across multiple categories (`finance:write`)                                                 |
| `delete_split`                          | Delete a single split by split ID (`finance:delete`)                                                             |
| `link_transfer`                         | Link two existing transactions as a transfer pair (`finance:write`)                                              |
| `unlink_transfer`                       | Unlink a transfer pair by transferId (`finance:write`)                                                           |
| `link_refund`                           | Mark a transaction as a refund of another (`finance:write`)                                                      |
| `unlink_refund`                         | Remove the refund link between two transactions (`finance:write`)                                                |
| `assign_tags_to_transaction`            | Assign tags to a transaction (`finance:write`)                                                                   |
| `remove_tags_from_transaction`          | Remove tags from one or more transactions (`finance:write`)                                                      |
| `create_category`                       | Create a new category, optionally nested (`finance:write`)                                                       |
| `update_category`                       | Rename, recolor, or change a category's icon (`finance:write`)                                                   |
| `delete_category`                       | Delete a category; supply replacement for linked transactions (`finance:delete`)                                 |
| `create_tag`                            | Create a new transaction tag (`finance:write`)                                                                   |
| `update_tag`                            | Rename, recolor, or update a tag (`finance:write`)                                                               |
| `delete_tag`                            | Permanently delete a tag and unlink it from all transactions (`finance:delete`)                                  |

Call `get_user_profile` **first** — it reveals the user's base currency, which
is required to interpret `ref*` fields (refAmount, refBalance) that normalize
multi-currency data.

## Data conventions

- All monetary amounts are decimals (e.g. `42.50` means $42.50), not cents.
- Fields prefixed with `ref` are converted to the user's base currency.
  Use them for cross-account totals when accounts have different currencies.
- Transaction types: `income`, `expense`, `transfer`. Transfers are **not**
  income or expense — exclude them from spend/earn aggregations.
- File bytes never travel through MCP tool arguments. To attach a receipt, call
  `create_attachment_upload_url`, then POST each file as the raw request body to
  the returned `url` with the returned headers plus the file's URI-encoded name in
  the `filenameHeader` header (needs shell/HTTP access to the file).
- Investment vs regular transactions are **separate datasets**.
  `search_transactions` returns regular (spending) transactions; investment
  activity (buy/sell/dividend/fee) lives in `get_investment_transactions` and
  does not appear in `search_transactions`.
- Transaction automations are rules evaluated top to bottom by `position` on
  new transactions on bank-connected accounts or imported rows — never on
  transfers, planned ones, or transactions on manual (non-bank) accounts. Existing
  transactions change only when the user runs "Apply to past transactions" for a
  saved rule in the app. The first rule that applies an action wins. Test conditions with `preview_transaction_automation` before
  saving a rule, and pass the full current id set to
  `reorder_transaction_automations`.
- Tracker lines split a tracker's spending into named category sets, each with
  an optional limit. A transaction lands in at most one line: the first by
  `position` whose categories (expanded to children) contain it. Spending that
  matches no line is reported as `otherSpent` by `get_tracker_spending_stats`.
- Smart tracking (`aiEnabled`) is owner-only and works on manual trackers with
  an `aiDescription` and a `startDate`. The AI links transactions it is sure of
  (score >= 0.85) and suggests weaker matches (>= 0.5) as pending in
  `list_tracker_suggestions`. Rejected transactions are not suggested again.
- Savings goals count a percentage share of each backing account's balance
  (minus its credit limit, never below 0) toward a target in the goal's own
  currency. An account's shares across active and paused goals cannot pass
  100%; archiving a goal frees them. Goal writes need the Goals feature on the
  user's plan or an active trial.
- Portfolio queries are gated by `portfolioId`. Call `get_portfolios` first
  to discover ids before calling `get_portfolio_summary`,
  `get_portfolio_holdings`, or `get_portfolio_balances`.
- Portfolio cash moves via transfers: `link_transaction_to_portfolio` when the
  bank transaction already exists, `transfer_account_to_portfolio` /
  `transfer_portfolio_to_account` to create the transaction alongside the
  transfer, `create_portfolio_cash_transaction` when no account is involved.

## Troubleshooting

- **OAuth consent screen doesn't appear**: confirm the client fetched
  `/.well-known/oauth-authorization-server` and is using the advertised
  `authorization_endpoint`.
- **401 Unauthorized on tool calls**: the access token expired. The client
  should use the refresh token (granted via `offline_access` scope) to obtain
  a new access token.
- **Revoking access**: user goes to MoneyMatter → Settings → AI → Connectors (MCP)
  and removes it from Active connectors.

## Self-hosted deployments

Users who self-host will have their own MCP URL (e.g. `https://mcp.my-domain.tld/mcp`).
Ask the user for their deployment URL before assuming the public endpoint.
