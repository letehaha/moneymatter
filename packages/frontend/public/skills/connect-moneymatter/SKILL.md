# Connect an AI agent to MoneyMatter

MoneyMatter exposes a remote Model Context Protocol (MCP) server. Connecting an
agent to this server gives the agent OAuth-secured access to the user's
financial data: accounts, transactions (including planned
ones, refunds, transfers, splits and attachments), categories, tags, tag
reminders, payees, trackers, budget plans, savings goals, subscriptions,
transaction automations and templates, loans, vehicles, currencies and exchange rates,
investment portfolios, holdings, investment
transactions, venture deals, and duplicate cleanup. Bank connections can
be read and an account unlinked from its bank; sharing is read only; imports can be
listed and undone. The agent can
read these records and — when the user grants the corresponding scopes —
create, edit, and delete them.

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
| `finance:read`   | Read accounts, transactions, trackers, budget plans, analytics   |
| `finance:write`  | Create and edit transactions, trackers, subscriptions, and more  |
| `finance:delete` | Permanently delete records (transactions, trackers, portfolios…) |
| `profile:read`   | Read the user's profile (name, email, base currency)             |
| `offline_access` | Receive a refresh token so sessions survive expiration           |

The MoneyMatter consent screen lets the user grant or deny `finance:write` and
`finance:delete` independently. Always request the narrowest set of scopes
sufficient for the job — read-only agents should not request write or delete.
Users can revoke a connected app at any time from the MoneyMatter settings
page.

## Toolsets

Tools come in toolsets. `core` is always registered; every other toolset is
granted with its own `toolset:<id>` scope, which the user ticks on the consent
screen (none are ticked by default). Request every toolset scope you might
need: the user narrows them down. A session lists only the tools of the
toolsets its token was granted, so a tool missing from `tools/list` means the
user didn't grant its toolset; ask them to reconnect the app and tick it.

| Toolset            | Scope                      | Covers                                                                                                   |
| ------------------ | -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `core`             | none, always on            | Profile, accounts, transactions, transfers and refunds, attachments, categories, tags, payees, analytics |
| `subscriptions`    | `toolset:subscriptions`    | Subscriptions, their periods and candidates, planned transactions                                        |
| `budget-plans`     | `toolset:budget-plans`     | Budget plans, their groups, lines and line goals, savings goals                                          |
| `trackers`         | `toolset:trackers`         | Trackers, their lines and suggestions                                                                    |
| `automations`      | `toolset:automations`      | Transaction automations, payee aliases, ignored payee names, tag reminders                               |
| `review`           | `toolset:review`           | Refund and transfer matches, duplicate cleanup, stuck pending transactions                               |
| `groups-templates` | `toolset:groups-templates` | Transaction groups and transaction templates                                                             |
| `investments`      | `toolset:investments`      | Portfolios, holdings, securities, investment transactions, portfolio transfers                           |
| `ventures`         | `toolset:ventures`         | Venture platforms, deals and events                                                                      |
| `loans-vehicles`   | `toolset:loans-vehicles`   | Loans and vehicles                                                                                       |
| `currencies`       | `toolset:currencies`       | User currencies and exchange rates                                                                       |
| `imports`          | `toolset:imports`          | Import batches (list, undo), bank connections (status, unlink an account), sharing (read only)           |

The server card gives each tool's toolset in its `toolset` field.

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

Tools are grouped by toolset. Tools marked with a scope need that OAuth scope; the rest only read.

<!-- BEGIN GENERATED TOOL TABLES: npm run mcp:generate-metadata -->

### `core`

Accounts, transactions, transfers and refunds, attachments, categories, tags, payees and reports. Always on, needs no scope.

| Tool                             | Purpose                                                                                                                                                                                                                                      |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `adjust_account_balance`         | Set an account to a specific balance by creating an adjustment transaction for the difference (`finance:write`)                                                                                                                              |
| `archive_account`                | Archive or unarchive a user account (`finance:write`)                                                                                                                                                                                        |
| `assign_tags_to_transaction`     | Assign one or more tags to a transaction (`finance:write`)                                                                                                                                                                                   |
| `bulk_delete_payees`             | Permanently delete many payees at once (`finance:delete`)                                                                                                                                                                                    |
| `bulk_delete_transactions`       | Permanently delete many transactions at once, by ids or by filters (`finance:delete`)                                                                                                                                                        |
| `bulk_update_transactions`       | Update multiple transactions at once (`finance:write`)                                                                                                                                                                                       |
| `create_account`                 | Create a manual account (`finance:write`)                                                                                                                                                                                                    |
| `create_attachment_upload_url`   | Get a short-lived upload URL for attaching receipt/invoice files (JPEG, PNG, WebP, PDF) to a transaction (`finance:write`)                                                                                                                   |
| `create_category`                | Create a new transaction category (`finance:write`)                                                                                                                                                                                          |
| `create_payee`                   | Create a Payee (merchant/counterparty) for the user (`finance:write`)                                                                                                                                                                        |
| `create_tag`                     | Create a new tag that can be assigned to transactions (`finance:write`)                                                                                                                                                                      |
| `create_transaction`             | Create a new transaction (income, expense, or transfer) (`finance:write`)                                                                                                                                                                    |
| `delete_account`                 | Permanently delete an account together with all its transactions (`finance:delete`)                                                                                                                                                          |
| `delete_attachment`              | Permanently delete a file attached to a transaction (`finance:delete`, Attachments feature)                                                                                                                                                  |
| `delete_category`                | Permanently delete a category by ID (`finance:delete`)                                                                                                                                                                                       |
| `delete_payee`                   | Delete a Payee (`finance:delete`)                                                                                                                                                                                                            |
| `delete_split`                   | Delete a single split from a transaction by its split ID (UUID string) (`finance:delete`)                                                                                                                                                    |
| `delete_tag`                     | Permanently delete a tag by ID (`finance:delete`)                                                                                                                                                                                            |
| `delete_transaction`             | Permanently delete a transaction by ID (`finance:delete`)                                                                                                                                                                                    |
| `get_account`                    | Read one account: balances (original and base currency), opening balance, credit limit, category, status, bank link and logo, plus transactionCount, the number of transactions the account holds (null for an account shared with the user) |
| `get_accounts`                   | List all user accounts with current balances                                                                                                                                                                                                 |
| `get_balance_history`            | Get account balance over time                                                                                                                                                                                                                |
| `get_cash_flow`                  | Get income, expenses, and net cash flow for a period with configurable granularity (monthly/biweekly/weekly)                                                                                                                                 |
| `get_categories`                 | List all transaction categories                                                                                                                                                                                                              |
| `get_category_transaction_count` | Count the transactions filed under a category, planned ones and split lines included                                                                                                                                                         |
| `get_cumulative_stats`           | Get running totals of expenses, income or savings by month for a period, next to the period of the same length right before it, plus the percent change, in the base currency                                                                |
| `get_earliest_transaction_date`  | Get the date (YYYY-MM-DD) of the first transaction on record, or null when there are none                                                                                                                                                    |
| `get_expenses_for_period`        | Get total expense amount for a date range                                                                                                                                                                                                    |
| `get_net_worth_drivers`          | Explain what moved net worth, period by period, in the base currency: savings (income, expenses, net), investment growth (price effect, dividends, fees and taxes, per portfolio) and the holdings and cash values at the end of the period  |
| `get_net_worth_history`          | Get net worth over time as points, each with assets by kind (cash, investments, vehicles, ventures), liabilities by kind (credit-card, loan, overdraft) and the net worth, in the base currency                                              |
| `get_payee`                      | Fetch a single Payee with aliases and computed stats                                                                                                                                                                                         |
| `get_payees`                     | List Payees (merchants/counterparties) for the user, optionally filtered by a substring query                                                                                                                                                |
| `get_pivot_report`               | Cross-tab spending or income: rows by category, subcategory, payee or tag against time columns (yearly, quarterly, monthly, weekly), with row and column totals, in the base currency                                                        |
| `get_refund_links`               | List every refund link touching a transaction, on either side (as the refund or as the original)                                                                                                                                             |
| `get_refunds`                    | Read refund links, the pairs of an original transaction and the transaction that refunds it                                                                                                                                                  |
| `get_spending_by_categories`     | Get spending breakdown by category for a date range                                                                                                                                                                                          |
| `get_tags`                       | List all user tags                                                                                                                                                                                                                           |
| `get_total_balance`              | Get the user's total balance across all accounts on one date, as { amount, currencyCode, date }, where amount is a number in the base currency and currencyCode is that currency                                                             |
| `get_transaction_links`          | Read what a transaction is linked to: the portfolio transfer it funds or pays out (portfolioLink: portfolio, deposit or withdrawal, amount) and the venture event it belongs to (ventureLink: deal)                                          |
| `get_transactions_by_id`         | Read transactions by id (up to 50) or both legs of a transfer by transferId                                                                                                                                                                  |
| `get_transactions_summary`       | Count and totals of the transactions that match the filters, in the base currency: income, expense, net and transfers                                                                                                                        |
| `get_user_profile`               | Get the user's base currency, configured currencies with exchange rates, and basic profile info                                                                                                                                              |
| `link_refund`                    | Mark an existing transaction as a refund of another transaction (`finance:write`)                                                                                                                                                            |
| `link_transfer`                  | Link two existing transactions as a transfer pair (`finance:write`)                                                                                                                                                                          |
| `list_transaction_attachments`   | List the files attached to a transaction (receipts, invoices): id, filename, mimeType, size in bytes and upload time                                                                                                                         |
| `merge_payees`                   | Merge a source Payee into a target Payee (`finance:delete`)                                                                                                                                                                                  |
| `remove_tags_from_transaction`   | Remove a tag from one or more transactions (`finance:write`)                                                                                                                                                                                 |
| `search_transactions`            | Search and filter transactions                                                                                                                                                                                                               |
| `split_transaction`              | Split a transaction across multiple categories (`finance:write`)                                                                                                                                                                             |
| `unlink_refund`                  | Remove one refund link, identified by refundTxId + originalTxId; both transactions stay (`finance:write`)                                                                                                                                    |
| `unlink_transfer`                | Unlink transfer transactions by their shared transferId (UUID string) (`finance:write`)                                                                                                                                                      |
| `update_account`                 | Update an account: name, accountCategory, defaultPaymentType (null clears it), creditLimit, excludeFromStats, logo, and balances (`finance:write`)                                                                                           |
| `update_category`                | Update an existing category by ID (`finance:write`)                                                                                                                                                                                          |
| `update_payee`                   | Update a Payee (`finance:write`)                                                                                                                                                                                                             |
| `update_tag`                     | Update an existing tag by ID (`finance:write`)                                                                                                                                                                                               |
| `update_transaction`             | Update an existing transaction by ID (`finance:write`)                                                                                                                                                                                       |

### `subscriptions`

Recurring payments, their periods and candidates, and planned transactions.

| Tool                                     | Purpose                                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accept_subscription_candidate`          | Accept a pending subscription candidate (`finance:write`)                                                                                                                                                                                                                                                                         |
| `confirm_planned_transaction`            | Confirm a planned (upcoming) transaction once the money has moved: it becomes a real transaction and counts toward the account balance (`finance:write`)                                                                                                                                                                          |
| `create_subscription`                    | Create a new subscription, recurring bill, or installment plan (`finance:write`)                                                                                                                                                                                                                                                  |
| `delete_subscription`                    | Permanently delete a subscription or recurring bill (`finance:delete`)                                                                                                                                                                                                                                                            |
| `detect_subscription_candidates`         | Scan the past 12 months of transactions to detect recurring payment patterns and generate subscription candidates (`finance:write`)                                                                                                                                                                                               |
| `dismiss_subscription_candidate`         | Dismiss a pending subscription candidate so it no longer appears in the candidate list (`finance:write`)                                                                                                                                                                                                                          |
| `get_planned_summary`                    | Totals of the planned (upcoming, not yet confirmed) transactions per account and currency: plannedDelta in the account currency, refPlannedDelta in the base currency, the number of plans and the latest plan date                                                                                                               |
| `get_subscription_by_id`                 | Retrieve a single subscription by its ID including all linked transactions (with match source and date) and the computed next expected payment date                                                                                                                                                                               |
| `get_subscription_periods`               | List a subscription’s billing periods, newest due date first, with the status of each (upcoming, overdue, paid, skipped) and the transaction behind a paid one                                                                                                                                                                    |
| `get_subscriptions_summary`              | Aggregate summary across all active subscriptions with an expected amount, split by direction                                                                                                                                                                                                                                     |
| `get_subscriptions`                      | List all subscriptions and recurring bills for the user                                                                                                                                                                                                                                                                           |
| `get_upcoming_subscription_payments`     | List upcoming subscription payments sorted by next expected payment date (soonest first)                                                                                                                                                                                                                                          |
| `link_transactions_to_subscription`      | Link one or more transactions to a subscription to mark them as payment instances (`finance:write`)                                                                                                                                                                                                                               |
| `list_subscription_candidates`           | List auto-detected subscription candidates sorted by confidence score                                                                                                                                                                                                                                                             |
| `list_subscription_match_suggestions`    | List past transactions (the last 12 months, at most 100, newest first) that a subscription’s matching rules would match but that are not linked to it yet                                                                                                                                                                         |
| `pay_subscription_period`                | Mark a subscription period as paid and open the next one (`finance:write`)                                                                                                                                                                                                                                                        |
| `preview_subscription_payment`           | Preview what paying a subscription period would book: the amount in the account’s currency (converted at today’s rate when the subscription is billed in another currency), and, with periodId, the transactions already linked to the subscription that fall inside the period and could be linked instead of creating a new one |
| `revert_subscription_period`             | Undo a paid or skipped period: it becomes upcoming (or overdue when its due date has passed) again, and the open period the app generated after it is removed unless a later period was already paid or skipped (`finance:write` + `finance:delete` when it deletes the transaction the app created)                              |
| `skip_subscription_period`               | Skip a subscription period, for a billing cycle that is not paid, and open the next one (`finance:write`)                                                                                                                                                                                                                         |
| `toggle_subscription_active`             | Activate or deactivate a subscription (`finance:write`)                                                                                                                                                                                                                                                                           |
| `unlink_subscription_period_transaction` | Detach the transaction a period points at: the transaction is kept (even one the app created for the period) and the period keeps its paid status, but it no longer points at any payment, so a later revert deletes nothing (`finance:write`)                                                                                    |
| `unlink_transactions_from_subscription`  | Unlink transactions from a subscription without deleting them (`finance:write`)                                                                                                                                                                                                                                                   |
| `update_subscription`                    | Update fields on an existing subscription or bill (`finance:write`)                                                                                                                                                                                                                                                               |

### `budget-plans`

Budget plans with their groups, lines and line goals, and savings goals.

| Tool                                 | Purpose                                                                                                                                                                                                          |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_suggested_budget_plan_lines`    | Draft starter lines (and groups) for a budget plan from the spending history of its accounts, skipping categories another line already covers (`finance:write`, Budget plan feature)                             |
| `archive_budget_plan_line`           | Archive a line of a budget plan (archived: true) or bring an archived one back (archived: false) (`finance:write`, Budget plan feature)                                                                          |
| `create_budget_plan_group`           | Add a group to a budget plan: a named section that lines sit in, shown after the existing groups (`finance:write`, Budget plan feature)                                                                          |
| `create_budget_plan_line`            | Add a line (an envelope for one or more categories) to a budget plan (`finance:write`, Budget plan feature)                                                                                                      |
| `create_budget_plan`                 | Create a budget plan (the "Budget" in the app: period envelopes where money is assigned to lines, not the trackers behind create_tracker) (`finance:write`, Budget plan feature)                                 |
| `create_goal`                        | Create a savings goal: a target amount (optionally by a date) funded by percent shares or fixed amounts of one or more accounts (`finance:write`, Goals feature)                                                 |
| `delete_budget_plan_group`           | Delete a group of a budget plan (`finance:delete`, Budget plan feature)                                                                                                                                          |
| `delete_budget_plan_line_goal`       | Delete the goal of a budget plan line (`finance:delete`, Budget plan feature)                                                                                                                                    |
| `delete_budget_plan_line`            | Permanently delete a line of a budget plan with all its category memberships and assignments in every period, so its categories become unbudgeted (`finance:delete`, Budget plan feature)                        |
| `delete_budget_plan`                 | Delete a budget plan (`finance:delete`)                                                                                                                                                                          |
| `delete_goal`                        | Permanently delete a savings goal and free its account shares (`finance:delete`, Goals feature)                                                                                                                  |
| `get_budget_plan_period`             | Read one period of a budget plan: the figures behind the Budget screen                                                                                                                                           |
| `get_budget_plan_scheduled`          | List what is still scheduled in a period of a budget plan, from today on: subscription payments and planned transactions dated in the period                                                                     |
| `get_budget_plan_suggestion_context` | Read what a new budget plan could start from, before creating one: the top spending categories of the given accounts over the last three full months                                                             |
| `get_budget_plan_trends`             | Compare the last periods of a budget plan: for each, in order from oldest to newest, what was assigned, the activity (spending is negative), the amount carried in and what was available, in total and per line |
| `get_goals`                          | List savings goals (active, paused, archived) in the user's order                                                                                                                                                |
| `list_budget_plan_periods`           | List the periods of a budget plan, newest first                                                                                                                                                                  |
| `list_budget_plans`                  | List the budget plans (the "Budget" in the app: period envelopes where money is assigned to lines, not the trackers behind get_trackers), or read one with planId                                                |
| `restore_budget_plan`                | Bring a budget plan back from the trash (`finance:write`, Budget plan feature)                                                                                                                                   |
| `set_budget_plan_accounts`           | Replace the set of accounts a budget plan counts activity from (`finance:write`, Budget plan feature)                                                                                                            |
| `set_budget_plan_assignment`         | Assign money to a budget plan line in a period, or change its carry policy there (`finance:write`, Budget plan feature)                                                                                          |
| `set_budget_plan_line_goal`          | Set the goal of a budget plan line: how much it should hold or receive and when (`finance:write`, Budget plan feature)                                                                                           |
| `snooze_budget_plan_line_goal`       | Snooze the goal of a budget plan line for one period, so it asks for nothing from that period (`finance:write`, Budget plan feature)                                                                             |
| `update_budget_plan_group`           | Rename a group of a budget plan (`finance:write`, Budget plan feature)                                                                                                                                           |
| `update_budget_plan_line`            | Change a line of a budget plan (`finance:write`, Budget plan feature)                                                                                                                                            |
| `update_budget_plan`                 | Change the settings of a budget plan (`finance:write`, Budget plan feature)                                                                                                                                      |
| `update_goal`                        | Update a savings goal (`finance:write`, Goals feature)                                                                                                                                                           |

### `trackers`

Spending trackers, their lines and suggestions.

| Tool                               | Purpose                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accept_tracker_suggestions`       | Accept pending smart-tracking suggestions of a tracker the user owns: each suggested transaction is linked to the tracker (`finance:write`)                                                                                                                                                                                                          |
| `add_transactions_to_tracker`      | Manually link one or more transactions to a tracker, alongside any links its category and tag rules add (`finance:write`)                                                                                                                                                                                                                            |
| `archive_tracker`                  | Archive or unarchive a tracker (`finance:write`)                                                                                                                                                                                                                                                                                                     |
| `create_tracker_line`              | Add a line to a tracker: a named category set with its own optional limit (`finance:write`)                                                                                                                                                                                                                                                          |
| `create_tracker`                   | Create a tracker with an optional spending limit, date range and logo (`finance:write`)                                                                                                                                                                                                                                                              |
| `delete_tracker_line`              | Permanently delete a line from a tracker (`finance:delete`)                                                                                                                                                                                                                                                                                          |
| `delete_tracker`                   | Permanently delete a tracker and all its transaction links (`finance:delete`)                                                                                                                                                                                                                                                                        |
| `get_tracker_spending_stats`       | Get spending statistics for a tracker: spending broken down by category and a time-series of expense vs income over the tracker period                                                                                                                                                                                                               |
| `get_tracker`                      | Get one tracker with its progress: the tracker itself (name, status, type, date range, limit, linked categories, and the share details when it is shared with the user) and its stats (income, expense and balance over the tracker period, how much of the limit is used, how many transactions it covers, and the first and last transaction date) |
| `get_trackers`                     | List trackers: spending watchers over a date range with an optional limit, holding hand-picked transactions plus those their category and tag rules link                                                                                                                                                                                             |
| `list_tracker_suggestions`         | Smart-tracking state of a tracker the user owns                                                                                                                                                                                                                                                                                                      |
| `reject_tracker_suggestions`       | Reject smart-tracking suggestions of a tracker the user owns: pending ones are dismissed, and AI-linked or accepted ones are also unlinked from the tracker (`finance:write`)                                                                                                                                                                        |
| `remove_transactions_from_tracker` | Unlink one or more transactions from a tracker (`finance:write`)                                                                                                                                                                                                                                                                                     |
| `update_tracker_line`              | Update a tracker line: name, categories, limit, or position (`finance:write`)                                                                                                                                                                                                                                                                        |
| `update_tracker`                   | Update the name, date range, spending limit, or rules (categories, tags, auto-add) of an existing tracker (`finance:write`)                                                                                                                                                                                                                          |

### `automations`

Transaction rules, payee aliases, ignored payee names and tag reminders.

| Tool                               | Purpose                                                                                                                                                                                                                      |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apply_payee_tags_to_transactions` | Add a payee's default tags (set with update_payee) to every transaction already linked to it, planned ones included (`finance:write`)                                                                                        |
| `apply_transaction_automation`     | Run one saved automation rule on existing transactions, writing the rule's actions to them (`finance:write`)                                                                                                                 |
| `create_payee_alias`               | Add an alias to a payee: another name that links future transactions to it (`finance:write`)                                                                                                                                 |
| `create_tag_reminder`              | Create a reminder on a tag (`finance:write`)                                                                                                                                                                                 |
| `create_transaction_automation`    | Create a transaction automation rule that categorizes, tags, sets a payee, or edits the note of matching transactions (`finance:write`)                                                                                      |
| `delete_payee_alias`               | Delete one alias of a payee (`finance:delete`)                                                                                                                                                                               |
| `delete_tag_reminder`              | Permanently delete a tag reminder (`finance:delete`)                                                                                                                                                                         |
| `delete_transaction_automation`    | Permanently delete a transaction automation rule (`finance:delete`)                                                                                                                                                          |
| `get_ignored_payee_names`          | List the names on the ignored list, newest first                                                                                                                                                                             |
| `get_tag_reminders`                | List tag reminders: rules that notify the user about the transactions of a tag, either when the tag total in a period passes an amount (amount_threshold) or when the tag has no transaction in the period (existence_check) |
| `get_transaction_automations`      | List the transaction automation rules (rules engine) of the user, ordered by evaluation order                                                                                                                                |
| `ignore_payee_name`                | Add a name to the ignored list, so it is never turned into a payee automatically when transactions are imported or synced (`finance:write` + `finance:delete` with force)                                                    |
| `preview_transaction_automation`   | Dry-run a set of automation conditions against up to the last 1000 eligible existing transactions and return { matchedCount, scannedCount, matches } where matches is capped at 5 sample transactions                        |
| `reorder_transaction_automations`  | Reorder the transaction automation rules of the user (`finance:write`)                                                                                                                                                       |
| `unignore_payee_name`              | Remove a name from the ignored list, so imports and syncs may turn it into a payee again (`finance:write`)                                                                                                                   |
| `update_tag_reminder`              | Update a tag reminder (`finance:write`)                                                                                                                                                                                      |
| `update_transaction_automation`    | Update a transaction automation rule (`finance:write`)                                                                                                                                                                       |

### `review`

Refund and transfer matches, duplicate cleanup and stuck pending transactions.

| Tool                              | Purpose                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dismiss_transfer_suggestion`     | Tell MoneyMatter that a suggested expense/income pair is not a transfer, so list_transfer_suggestions stops offering that pair (`finance:write`)                                                                                                                                                                                            |
| `get_reconciliation_history`      | List the duplicate cleanups that removed transactions, newest first                                                                                                                                                                                                                                                                         |
| `get_refund_recommendations`      | Suggest transactions that a refund could be linked to: up to 5 of the opposite type (income for an expense, expense for an income) from the last 6 months, within 50 of the amount in the base currency, leaving out transfers, planned rows and rows that already act as refunds                                                           |
| `get_transfer_recommendations`    | Suggest the other leg of a transfer: up to 7 transactions of the opposite type (income for an expense, expense for an income) on other accounts, within 10% of the amount in the base currency and 14 days of the date, leaving out transfers, refunds, planned rows and split parents; same currency and closer amount and date rank first |
| `keep_pending_as_booked`          | Confirm that bank-synced pending transactions are real and booked, so they stop showing as stuck (`finance:write`)                                                                                                                                                                                                                          |
| `list_stuck_pending_transactions` | List bank-synced transactions that have been pending for more than 7 days, so the bank probably booked them under a different row                                                                                                                                                                                                           |
| `list_transfer_suggestions`       | Scan a period for expenses that look like one leg of a transfer between the caller's accounts                                                                                                                                                                                                                                               |
| `merge_duplicate_transactions`    | Merge duplicate transactions of one account into a survivor: the other rows are removed and their tracker, group and subscription links move to the survivor, which keeps its own data (`finance:write`)                                                                                                                                    |
| `remove_duplicate_transactions`   | Remove duplicate transactions from the books: they disappear from lists, trackers and reports, and the account balance is left as it is (`finance:delete`)                                                                                                                                                                                  |
| `restore_removed_transactions`    | Bring back transactions that remove_duplicate_transactions or merge_duplicate_transactions took out of the books (`finance:write`)                                                                                                                                                                                                          |

### `groups-templates`

Transaction groups and transaction templates.

| Tool                             | Purpose                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `add_transactions_to_group`      | Add one or more transactions to an existing transaction group (`finance:write`)                                                                                                                                    |
| `create_transaction_group`       | Create a new transaction group that bundles related transactions together (e.g. a split bill) (`finance:write`)                                                                                                    |
| `create_transaction_template`    | Create a transaction template: a named preset to fill new transactions from (`finance:write`)                                                                                                                      |
| `delete_transaction_group`       | Permanently delete a transaction group (`finance:delete`)                                                                                                                                                          |
| `delete_transaction_template`    | Permanently delete a transaction template (`finance:delete`)                                                                                                                                                       |
| `get_transaction_groups`         | List all transaction groups for the user                                                                                                                                                                           |
| `get_transaction_templates`      | List the transaction templates: named presets the user fills a new transaction from (type, and optionally an account, a pinned amount, a category, a payee, a payment type, a note, an original currency and tags) |
| `remove_transactions_from_group` | Remove transactions from a group (`finance:write`)                                                                                                                                                                 |
| `update_transaction_group`       | Update the name or note of an existing transaction group (`finance:write`)                                                                                                                                         |
| `update_transaction_template`    | Update a transaction template (`finance:write`)                                                                                                                                                                    |

### `investments`

Portfolios, holdings, securities, investment transactions and portfolio transfers.

| Tool                                | Purpose                                                                                                                                                                                                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_holding`                    | Add a security to a portfolio, so investment transactions can be recorded against it (`finance:write`)                                                                                                                                                                     |
| `create_investment_transaction`     | Record a new investment transaction (buy, sell, dividend, fee, etc.) in a portfolio (`finance:write`)                                                                                                                                                                      |
| `create_portfolio_cash_transaction` | Record a direct cash deposit into or withdrawal from an investment portfolio without touching any regular account — no bank transaction is created (`finance:write`)                                                                                                       |
| `create_portfolio`                  | Create a new investment portfolio for the user (`finance:write`)                                                                                                                                                                                                           |
| `delete_holding`                    | Remove a security from a portfolio (`finance:delete`)                                                                                                                                                                                                                      |
| `delete_investment_transaction`     | Permanently delete an investment transaction (`finance:delete`)                                                                                                                                                                                                            |
| `delete_portfolio_transfer`         | Permanently delete a portfolio transfer, a direct deposit/withdrawal or a currency exchange, and reverse its effect on the portfolio cash balances (`finance:delete`)                                                                                                      |
| `delete_portfolio`                  | Permanently delete a portfolio and, if force is true, all its holdings, transactions, and cash balances (`finance:delete`)                                                                                                                                                 |
| `exchange_portfolio_currency`       | Record a currency exchange inside a portfolio: sells fromAmount of one cash currency and buys toAmount of another (`finance:write`)                                                                                                                                        |
| `get_investment_contributions`      | Get the money moved into portfolios (net of withdrawals) per period, in the base currency, with the split per portfolio and the net savings of the same period for comparison                                                                                              |
| `get_investment_transactions`       | Investment transaction history: buy, sell, dividend, transfer, tax, fee, cancel, other                                                                                                                                                                                     |
| `get_portfolio_balances`            | Cash balances held in a portfolio, broken down per currency                                                                                                                                                                                                                |
| `get_portfolio_holdings`            | Positions held in a portfolio with dynamically calculated market value, cost basis, and realized/unrealized gain (value and percent)                                                                                                                                       |
| `get_portfolio_summary`             | Portfolio-level aggregates for a single portfolio: total current market value, total cost basis, realized and unrealized gains (value and percent), cash balances, and total portfolio value (holdings + cash)                                                             |
| `get_portfolio`                     | Read one portfolio by id: name, portfolio type (investment/retirement/savings/other), description, enabled state and creation date                                                                                                                                         |
| `get_portfolios_overview`           | Overview of all portfolios in one call                                                                                                                                                                                                                                     |
| `get_portfolios`                    | List the user's investment portfolios                                                                                                                                                                                                                                      |
| `get_security_prices`               | Stored closing prices of one security, found by securityId or by symbol with providerName (a security that is stored, even without a holding; not found otherwise), oldest first, each with the date, the close, when it was recorded and its source, as { prices, total } |
| `link_transaction_to_portfolio`     | Link an existing regular transaction to an investment portfolio as a cash transfer (`finance:write`)                                                                                                                                                                       |
| `list_portfolio_transfers`          | Cash movement history of a portfolio: account↔portfolio transfers, direct deposits/withdrawals, linked bank transactions, and currency exchanges                                                                                                                           |
| `restore_portfolio`                 | Restore a portfolio that was deleted without force, with its holdings, transactions and cash balances (`finance:write`)                                                                                                                                                    |
| `search_securities`                 | Search for securities (stocks, ETFs, crypto, etc.) by ticker symbol or company name                                                                                                                                                                                        |
| `set_portfolio_transfer_adjustment` | Flag a portfolio transfer as an adjustment, or clear the flag (`finance:write`)                                                                                                                                                                                            |
| `transfer_account_to_portfolio`     | Move cash from a regular account into an investment portfolio (`finance:write`)                                                                                                                                                                                            |
| `transfer_between_portfolios`       | Move cash from one portfolio to another, in one currency (`finance:write`)                                                                                                                                                                                                 |
| `transfer_portfolio_to_account`     | Withdraw cash from an investment portfolio into a regular account (`finance:write`)                                                                                                                                                                                        |
| `unlink_transaction_from_portfolio` | Remove the portfolio link from a transaction: deletes the portfolio transfer, reverses the portfolio cash balance change, and restores the transaction to a regular income/expense (`finance:write`)                                                                       |
| `update_investment_transaction`     | Update an existing investment transaction — correct the date, quantity, price, fees, settlement leg, category, or label (`finance:write`)                                                                                                                                  |
| `update_portfolio`                  | Update an existing portfolio's name, type, description, or enabled state (`finance:write`)                                                                                                                                                                                 |

### `ventures`

Venture platforms, deals and events.

| Tool                                 | Purpose                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create_venture_deal`                | Create a venture deal (private/illiquid investment record) (`finance:write`)                                                                                                                                                                                                                                                                            |
| `create_venture_event`               | Record an event on a venture deal (`finance:write`)                                                                                                                                                                                                                                                                                                     |
| `create_venture_platform`            | Create a venture investment platform (e.g. AngelList, a syndicate, a fund manager) so its default fees can be auto-applied when creating new deals (`finance:write`)                                                                                                                                                                                    |
| `delete_venture_deal`                | Delete a venture deal (`finance:delete`)                                                                                                                                                                                                                                                                                                                |
| `delete_venture_event_link`          | Remove one transaction link from a venture event (`finance:delete`)                                                                                                                                                                                                                                                                                     |
| `delete_venture_event`               | Delete a venture event (`finance:delete`)                                                                                                                                                                                                                                                                                                               |
| `delete_venture_platform`            | Delete a venture platform (`finance:delete`)                                                                                                                                                                                                                                                                                                            |
| `get_venture_contributions`          | Get the net amount contributed to each venture deal in a date range, in the base currency                                                                                                                                                                                                                                                               |
| `get_venture_deal_metrics`           | Compute aggregated metrics for a venture deal: cost basis, current value (latest NAV), total distributions, absolute and percent P&L, TVPI (total value to paid-in), DPI (distributions to paid-in), and IRR                                                                                                                                            |
| `get_venture_deal`                   | Retrieve a single venture deal by id, including its platform and currency                                                                                                                                                                                                                                                                               |
| `get_venture_event`                  | Retrieve a single venture event by id, including its link rows (bank transactions linked to this event)                                                                                                                                                                                                                                                 |
| `get_venture_platform`               | Retrieve a single venture platform by id                                                                                                                                                                                                                                                                                                                |
| `link_transactions_to_venture_event` | Link existing bank transactions to a venture event as the cash behind it (`finance:write`)                                                                                                                                                                                                                                                              |
| `list_venture_deals`                 | List the user's venture deals (private/illiquid investments through SPVs, syndicates, or direct vehicles)                                                                                                                                                                                                                                               |
| `list_venture_events`                | List events for a venture deal in chronological order (oldest first)                                                                                                                                                                                                                                                                                    |
| `list_venture_platforms`             | List the user's venture investment platforms (SPV syndicators, fund managers)                                                                                                                                                                                                                                                                           |
| `replace_venture_event_links`        | Replace the whole set of bank transactions linked to a venture event: every current link is removed (each transaction gets its original state back), then the given transactions are linked under the rules of link_transactions_to_venture_event (same currency, not already linked elsewhere, sum equal to the event's lpNetAmount) (`finance:write`) |
| `update_venture_deal`                | Update a venture deal (`finance:write`)                                                                                                                                                                                                                                                                                                                 |
| `update_venture_event`               | Update a venture event (`finance:write`)                                                                                                                                                                                                                                                                                                                |
| `update_venture_platform`            | Update an existing venture platform's name, website, description, or default fees (`finance:write`)                                                                                                                                                                                                                                                     |

### `loans-vehicles`

Loans with their payments and notes, and vehicles.

| Tool                       | Purpose                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_loan_note`            | Add a note to the timeline of a loan (for example "rate fixed until 2030") (`finance:write`)                                                                        |
| `create_loan`              | Create a loan: a liability account with the loan terms (`finance:write`)                                                                                            |
| `create_vehicle`           | Create a vehicle: an asset account whose value follows a depreciation curve from the purchase price and date (`finance:write`)                                      |
| `delete_loan`              | Permanently delete a loan and its account (`finance:delete`)                                                                                                        |
| `delete_vehicle`           | Permanently delete a vehicle together with its account and the account's history (`finance:delete`)                                                                 |
| `get_loan_balance_history` | The outstanding balance of a loan over time, in the loan currency: the opening balance followed by one end-of-day point per day that has payments, oldest first     |
| `get_loans`                | List the loans (mortgage, auto, student, personal), or read one with loanId                                                                                         |
| `get_vehicles`             | List the vehicles (cars and other vehicles tracked as an asset), or read one with vehicleId                                                                         |
| `link_loan_payments`       | Record existing expense transactions as payments on a loan (`finance:write`)                                                                                        |
| `unlink_loan_payment`      | Undo a loan payment: the loan-side leg is deleted, the source transaction is restored to a plain expense and the outstanding balance goes back up (`finance:write`) |
| `update_loan`              | Update a loan (`finance:write`)                                                                                                                                     |
| `update_vehicle`           | Update a vehicle (`finance:write`)                                                                                                                                  |

### `currencies`

Your currencies and exchange rates.

| Tool                        | Purpose                                                                                                                                                                                                                                             |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `add_user_currencies`       | Add currencies to the ones the user holds, so accounts and transactions can use them (`finance:write`)                                                                                                                                              |
| `delete_exchange_rates`     | Remove the user's own exchange rates for currency pairs, so the pair falls back to the market rate (`finance:delete`)                                                                                                                               |
| `delete_user_currency`      | Stop holding a currency (`finance:delete`)                                                                                                                                                                                                          |
| `get_exchange_rate`         | Read an exchange rate for a day                                                                                                                                                                                                                     |
| `get_user_currencies`       | Get the currencies the user holds: baseCurrency (the reporting currency, null before one is set), currencies (every held currency with its settings: liveRateUpdate and exchangeRate) and exchangeRates (today's rate of each currency to the base) |
| `list_supported_currencies` | List every ISO 4217 currency the app supports, with its code, name and decimals                                                                                                                                                                     |
| `set_exchange_rates`        | Set the user's own exchange rates for currency pairs (`finance:write`)                                                                                                                                                                              |
| `update_user_currency`      | Change how one held currency is valued: exchangeRate (the flat rate to the base currency) and liveRateUpdate (true follows the market rate, false keeps the manual one) (`finance:write`)                                                           |

### `imports`

Import batches (list, undo) and bank connections (status, unlink an account); sharing is read only.

| Tool                                  | Purpose                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `delete_import_batch`                 | Undo an import: permanently delete every transaction the batch created, reverse the balance shift the import absorbed, and remove accounts the import created once they are empty (`finance:delete`)                                                                                                                                 |
| `get_bank_sync_status`                | Read the sync state of the bank-connected accounts: the last automatic sync, a summary (total, syncing, queued, completed, failed, idle), per account its status, startedAt, completedAt and error, the connections that need reconnecting (connectionsNeedingReauth) and the consent state of every connection (connectionStatuses) |
| `get_import_batch_delete_status`      | Read the state of the latest background import batch delete of the signed-in user, the job delete_import_batch starts for a batch above 1000 rows                                                                                                                                                                                    |
| `list_bank_connections`               | List the bank connections of the signed-in user (a bank or data provider linked to MoneyMatter), or read one with connectionId                                                                                                                                                                                                       |
| `list_import_batches`                 | List the import batches of the signed-in user, newest first: every CSV, YNAB, statement, Wallet, MS Money and OFX import that still has transactions to undo                                                                                                                                                                         |
| `list_share_invitations`              | List the sharing invitations of the signed-in user: the ones they sent (every status: pending, accepted, declined, revoked, expired) and the pending ones addressed to them                                                                                                                                                          |
| `list_share_members`                  | List who has access to an account, household or tracker the signed-in user manages: the owner and every member who accepted                                                                                                                                                                                                          |
| `list_shared_with_me`                 | List the accounts, households and trackers other people shared with the signed-in user                                                                                                                                                                                                                                               |
| `unlink_account_from_bank_connection` | Disconnect a bank-connected account from its bank (`finance:write`)                                                                                                                                                                                                                                                                  |

<!-- END GENERATED TOOL TABLES -->

Call `get_user_profile` **first** — it reveals the user's base currency, which
is required to interpret `ref*` fields (refAmount, refBalance) that normalize
multi-currency data.

## Data conventions

- All monetary amounts are decimals (e.g. `42.50` means $42.50), not cents.
- Fields prefixed with `ref` are converted to the user's base currency.
  Use them for cross-account totals when accounts have different currencies.
- Transaction types: `income`, `expense`, `transfer`. Transfers are **not**
  income or expense — exclude them from spend/earn aggregations.
- The two legs of a linked transfer share a `transferId`; `get_transactions_by_id` with that
  `transferId` reads both. To find unlinked pairs, `list_transfer_suggestions` scans a
  period and `get_transfer_recommendations` suggests one transaction's other leg;
  `link_transfer` links a pair and `dismiss_transfer_suggestion` rejects a wrong one.
- A transaction's payee is set with `payeeId` (an id from `get_payees`; `null` clears it
  on `update_transaction` and `bulk_update_transactions`). `create_transaction` also
  takes `merchantName`, a raw merchant string resolved the way bank sync does: it matches
  an existing payee by name or alias and follows the instance's promotion rules, so a new
  payee may not appear on first sight. `payeeId` and `merchantName` exclude each other.
- Duplicate cleanup is reversible. `remove_duplicate_transactions` and
  `merge_duplicate_transactions` soft-delete rows, `get_reconciliation_history` lists
  them and `restore_removed_transactions` brings them back, but a restored row does not
  get back the tracker, group and subscription links it lost. Bank rows pending for over
  a week show up in `list_stuck_pending_transactions` with the booked row that likely
  replaced each.
- A subscription's `matchingRules` (`create_subscription`, `update_subscription`) link imported
  transactions to it automatically: `{ rules: [...] }`, every rule must pass. A rule is a note
  keyword list (`contains_any`), an amount range (`between`, optional `currencyCode` to match
  other currencies within 5%), a transaction type or an account (`equals`). An update replaces
  the whole list, `{ rules: [] }` turns matching off, and rules cannot be combined with
  `autoRecord`. `list_subscription_match_suggestions` shows what a rule set would match.
- A subscription period is one billing cycle. `get_subscription_periods` lists them,
  `preview_subscription_payment` shows what a payment would book, and
  `pay_subscription_period` either links an existing transaction or books a new one.
  `revert_subscription_period` undoes a payment and also deletes a transaction the app
  booked for it, so it needs `finance:delete` in that case; a transaction you linked
  yourself is kept.
- File bytes never travel through MCP tool arguments. To attach a receipt, call
  `create_attachment_upload_url`, then POST each file as the raw request body to
  the returned `url` with the returned headers plus the file's URI-encoded name in
  the `filenameHeader` header (needs shell/HTTP access to the file).
- Investment vs regular transactions are **separate datasets**.
  `search_transactions` returns regular (spending) transactions; investment
  activity (buy/sell/dividend/fee) lives in `get_investment_transactions` and
  does not appear in `search_transactions`.
- A multi-account payment is one income or expense paid from up to 5 accounts.
  `search_transactions` returns it as one row on its main account, with
  `paymentParts` (every account's part, main first) and `paymentTotal` (the sum
  in the main currency). Filtering by `accountIds` returns each account's own
  part instead. Use `paymentTotal`, not `amount`, for the payment's full cost.
  Set the parts with `paymentLegs` on `create_transaction` / `update_transaction`.
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
- Smart tracking (`aiEnabled`) is owner-only and works on trackers with an
  `aiDescription` and a `startDate`. The AI links transactions it is sure of
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
  transfer, `create_portfolio_cash_transaction` when no account is involved,
  `transfer_between_portfolios` between two portfolios and
  `exchange_portfolio_currency` to swap cash currencies inside one portfolio.
  `set_portfolio_transfer_adjustment` keeps a correction out of the
  contributions report.
- A security reaches a portfolio in two steps: `search_securities` finds it,
  `create_holding` adds a result (passed unchanged as `searchResult`) and returns
  the `securityId` that `create_investment_transaction` needs. A known security is
  added with its `securityId` alone. `delete_holding` removes a holding with no
  quantity left; `force` also deletes its transactions.
- A venture event's cash is a set of bank transactions in the event's currency
  whose amounts sum to its `lpNetAmount`: `link_transactions_to_venture_event`
  adds them, `replace_venture_event_links` swaps the whole set, and
  `delete_venture_event_link` frees one.
- A loan is an account with a payment plan. Its balance is negative while debt
  is outstanding, but `create_loan` and `update_loan` take the amount still owed
  as a positive decimal. `get_loans` carries the payoff projection (use it for
  payoff date and interest left). Payments are existing expenses recorded with
  `link_loan_payments`; a loan with payments cannot be deleted until
  `unlink_loan_payment` has undone them.
- A vehicle is an asset account whose value follows a depreciation curve from
  its purchase price and date. `get_vehicles` shows the estimated value in
  `account.currentBalance`. The purchase price, date and currency are fixed
  after `create_vehicle`; to set the value by hand, use `adjust_account_balance`
  on the vehicle's `accountId`.
- A budget plan (`list_budget_plans`, the "Budget" in the app) is a set of lines
  that money is assigned to period by period, with what is available carried
  from one period to the next. It is not a tracker: the tools named
  `get_trackers`, `get_tracker` and the like read trackers, a limit on a set of
  categories over a date range. Read a plan's periods with
  `list_budget_plan_periods`, then one period with `get_budget_plan_period`.
  Every plan amount is a decimal in the plan's own `currencyCode`.
  Only one plan is active at a time (`create_budget_plan` fails while another
  exists; trash it with `delete_budget_plan` or swap with `restore_budget_plan`
  and `replace`). Changing a plan needs a subscription that includes budget
  plans; trashing one does not.
  A plan holds lines (envelopes for categories, in groups). A category sits in
  one line at a time; archive a line before reusing its categories elsewhere.
  Money is assigned to a line per period with `set_budget_plan_assignment`
  (`from_here` sets a baseline that runs on, `this_period` a one-period
  override). A line's goal is set with `set_budget_plan_line_goal`; the
  combinations it accepts are listed in that tool's description.
- Sharing is read-only here, and bank connections are read-only apart from
  `unlink_account_from_bank_connection`. `list_share_invitations`,
  `list_share_members` and `list_shared_with_me` show who has access to what
  (never an invitation's accept link); `list_bank_connections` and
  `get_bank_sync_status` show the state of linked banks (never credentials).
  Inviting, accepting, connecting a bank and syncing are done in the app.
- Imports are run in the app; here you can list batches and undo one.
  `delete_import_batch` takes a batch id from `list_import_batches` and
  deletes every transaction the import created (it also reverses the balance
  the import absorbed and removes accounts it created that are now empty).
  A batch above 1000 rows answers with a `jobId`: the delete runs in the
  background and blocks writes until it ends, so follow it with
  `get_import_batch_delete_status`.
- The base currency lock: while a base-currency change runs (the user starts
  it in the app), the write tools fail with a "change in progress" error; reads keep working, except
  `preview_transaction_automation` and `list_transfer_suggestions`, which are
  refused too. A few writes that touch no amounts (attachments) are exempt. Wait for the change to finish, then retry. A read-only account (expired plan) can read;
  every write is refused whatever scopes were granted.
- Destructive calls are deliberately narrow. `bulk_delete_transactions` needs
  explicit `transactionIds` or at least one narrowing filter and refuses an
  empty filter (the REST API would delete everything); preview the count with
  `get_transactions_summary` first. Tools that delete only on one path
  (`ignore_payee_name` with `force`, `revert_subscription_period` when the
  app booked the transaction) need `finance:write`, plus `finance:delete` on
  that path.
- Bank connections, sharing writes, file imports and downloads, account groups,
  notifications, app settings, changing the base currency, the app's AI
  settings, billing, and deleting or wiping the account have no tools; send the
  user to the app for those.

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
