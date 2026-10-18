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

| Tool | Purpose |
| `get_loans` | List loans with balance, terms and payoff projection; `loanId` reads one with its timeline |
| `get_loan_balance_history` | Outstanding balance of a loan over time, one point per payment day |
| `create_loan` | Create a loan with its terms (`finance:write`) |
| `update_loan` | Correct a loan's balance, rate, term, payments or lender details (`finance:write`) |
| `delete_loan` | Permanently delete a loan that has no payments (`finance:delete`) |
| `add_loan_note` | Add a note to a loan's timeline (`finance:write`) |
| `link_loan_payments` | Record expense transactions as payments on a loan (`finance:write`) |
| `unlink_loan_payment` | Undo a loan payment; the expense is restored (`finance:write`) |
| `get_vehicles` | List vehicles with their estimated value and depreciation settings; `vehicleId` reads one |
| `create_vehicle` | Create a vehicle whose value depreciates from its purchase price and date (`finance:write`) |
| `update_vehicle` | Update a vehicle's name, details, depreciation settings or mileage (`finance:write`) |
| `delete_vehicle` | Permanently delete a vehicle and its account (`finance:delete`) |
| `list_budget_plans` | List budget plans (period envelopes, not trackers); `planId` reads one with its accounts and lines |
| `get_budget_plan_suggestion_context` | Top spending categories of given accounts, to start a new budget plan from |
| `list_budget_plan_periods` | Periods of a budget plan, newest first, the current one marked |
| `get_budget_plan_period` | One period: assigned, activity and available per line, the pool, goals and coverage |
| `get_budget_plan_scheduled` | Subscription payments and planned transactions still scheduled in a period |
| `get_budget_plan_trends` | Assigned, activity and available over the last periods, in total and per line |
| `create_budget_plan` | Create the budget plan from accounts, cadence and anchor date; only one can be active (`finance:write`) |
| `update_budget_plan` | Change a plan's name, carry policy, pool, zero-sum or expected income (`finance:write`) |
| `delete_budget_plan` | Trash a plan, or erase a trashed one with `permanent` (`finance:delete`) |
| `restore_budget_plan` | Bring a plan back from the trash; `replace` swaps out the active one (`finance:write`) |
| `set_budget_plan_accounts` | Replace the accounts a plan counts activity from (`finance:write`) |
| `create_budget_plan_group` | Add a named group for a plan's lines (`finance:write`) |
| `update_budget_plan_group` | Rename a plan's group (`finance:write`) |
| `delete_budget_plan_group` | Delete an empty group of a plan (`finance:delete`) |
| `create_budget_plan_line` | Add a line for one or more categories to a plan (`finance:write`) |
| `update_budget_plan_line` | Rename a line, move it to a group or change its categories (`finance:write`) |
| `delete_budget_plan_line` | Permanently delete a line and its assignments (`finance:delete`) |
| `archive_budget_plan_line` | Archive a line from the current period, or restore an archived one (`finance:write`) |
| `add_suggested_budget_plan_lines` | Draft starter lines from spending history, with AI when the server has it (`finance:write`) |
| `set_budget_plan_layout` | Reorder groups and move lines between them in one call (`finance:write`) |
| `set_budget_plan_line_goal` | Set or replace a line's goal: frequency, behavior and amount (`finance:write`) |
| `delete_budget_plan_line_goal` | Delete a line's goal (`finance:delete`) |
| `snooze_budget_plan_line_goal` | Snooze a line's goal for one period, or wake it again (`finance:write`) |
| `set_budget_plan_assignment` | Assign money to a line from a period on or for one period, or set its carry policy (`finance:write`) |
| `list_share_invitations` | Sharing invitations you sent and the pending ones sent to you |
| `list_share_members` | Owner and members of an account, household or budget you manage |
| `list_shared_with_me` | Accounts, households and budgets others shared with you |
| `list_bank_connections` | Bank connections, or one with its accounts and consent window |
| `get_bank_sync_status` | Sync state of bank-connected accounts, connections to reconnect, running syncs |
| `list_import_batches` | Import batches (source, row count, accounts), newest first |
| `delete_import_batch` | Undo an import: delete one batch's transactions; large batches run as a job (`finance:delete`) |
| `get_import_batch_delete_status` | State of the background import batch delete (idle, queued, running, completed, failed) |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `get_user_profile`                      | Base currency, configured currencies, profile basics                                                             |
| `get_accounts`                          | List accounts with balances, types, currencies                                                                   |
| `get_account`                           | Read one account: balances, opening balance, bank link, logo, transaction count                                  |
| `create_account`                        | Create a manual account with currency, category, opening balance, credit limit (`finance:write`)                 |
| `update_account`                        | Update an account's name, category, credit limit, logo or balance (`finance:write`)                              |
| `search_transactions`                   | Filter transactions by date, category, tag, payee, planned state, amount, etc.; each carries its payee           |
| `get_transactions`                      | Read transactions by id (up to 50) or both legs of a transfer; optionally with splits and tags                   |
| `get_transactions_summary`              | Count and base-currency totals of the transactions matching the list filters                                     |
| `get_planned_summary`                   | Totals of planned (upcoming) transactions per account and currency                                               |
| `confirm_planned_transaction`           | Confirm a planned transaction once the money moved; settles a subscription period (`finance:write`)              |
| `bulk_delete_transactions`              | Permanently delete many by ids or non-empty filters; preview with get_transactions_summary (`finance:delete`)    |
| `get_transaction_links`                 | A transaction's portfolio-transfer and venture-event links                                                       |
| `list_transaction_attachments`          | Files attached to a transaction (id, name, type, size)                                                           |
| `delete_attachment`                     | Permanently delete a transaction attachment (`finance:delete`)                                                   |
| `get_categories`                        | List spending/income categories                                                                                  |
| `get_tags`                              | List transaction tags                                                                                            |
| `get_trackers`                          | Trackers with limits, category/tag rules and lines                                                               |
| `create_tracker`                        | Create a new tracker with limit, date range, category/tag rules, smart tracking (`finance:write`)                |
| `update_tracker`                        | Update name, dates, limit (null clears), category/tag rules, or smart tracking of a tracker (`finance:write`)    |
| `delete_tracker`                        | Permanently delete a tracker and its transaction links (`finance:delete`)                                        |
| `archive_tracker`                       | Archive or restore a tracker — active ↔ archived (`finance:write`)                                               |
| `add_transactions_to_tracker`           | Link transactions to a tracker (`finance:write`)                                                                 |
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
| `delete_account`                        | Permanently delete an account and all its transactions (`finance:delete`)                                        |
| `unlink_account_from_bank_connection`   | Disconnect a bank-connected account; it becomes manual and keeps history (`finance:write`)                       |
| `get_account_groups`                    | List account groups (nested folders) with parent, path, child groups and accounts                                |
| `create_account_group`                  | Create an account group, optionally nested under a parent (`finance:write`)                                      |
| `update_account_group`                  | Rename an account group or change its parent or logo (`finance:write`)                                           |
| `move_account_group`                    | Move an account group under another group or to the top level (`finance:write`)                                  |
| `delete_account_group`                  | Delete an account group; its accounts are kept, only ungrouped (`finance:delete`)                                |
| `add_account_to_group`                  | Put an account into a group; an account is in one group at a time (`finance:write`)                              |
| `remove_accounts_from_group`            | Take accounts out of a group (`finance:write`)                                                                   |
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
| `get_category_transaction_count`         | Count transactions filed under a category; check before `delete_category`                                        |
| `get_budget`                             | One tracker with its limit, categories and stats (income, expense, balance, limit used)                          |
| `get_budget_transactions`                | Transactions a category tracker counts, newest first; manual trackers use `search_transactions` with `budgetIds` |
| `get_total_balance`                      | Total balance on one date across all accounts, net of credit limits if that setting is on                        |
| `get_net_worth_history`                  | Net worth over a range: assets and liabilities by kind, weekly to yearly points                                  |
| `get_net_worth_drivers`                  | What moved net worth per period: savings, investment growth, dividends, fees                                     |
| `get_investment_contributions`           | Money moved into portfolios per period, split per portfolio                                                      |
| `get_venture_contributions`              | Net contributed to each venture deal over a range                                                                |
| `get_pivot_report`                       | Spending or income as rows (category, payee, tag) by time columns, with totals                                   |
| `get_cumulative_stats`                   | Running monthly totals of expenses, income or savings vs the previous period                                     |
| `get_earliest_transaction_date`          | Date of the first transaction on record; start date for reports                                                  |
| `get_portfolio`                          | Read one portfolio by id                                                                                         |
| `get_portfolios_overview`                | Summaries and annualized returns of all portfolios                                                               |
| `get_security_prices`                   | Stored closing prices of one security, optionally in a date range                                                |
| `get_security_prices`                   | Stored closing prices of one security, optionally in a date range                                                |
| `create_holding`                        | Add a security to a portfolio from a search result or securityId (`finance:write`)                               |
| `create_holding`                        | Add a security to a portfolio from a search result or securityId (`finance:write`)                               |
| `delete_holding`                        | Remove a security from a portfolio, with `force` its transactions too (`finance:delete`)                         |
| `delete_holding`                        | Remove a security from a portfolio, with `force` its transactions too (`finance:delete`)                         |
| `restore_portfolio`                      | Restore a deleted portfolio (`finance:write`)                                                                    |
| `transfer_between_portfolios`            | Move cash from one portfolio to another (`finance:write`)                                                        |
| `exchange_portfolio_currency`            | Exchange one cash currency for another inside a portfolio (`finance:write`)                                      |
| `set_portfolio_transfer_adjustment`      | Flag a transfer as an adjustment, not a contribution (`finance:write`)                                           |
| `delete_portfolio_transfer`              | Delete a portfolio transfer and reverse its cash effect (`finance:delete`)                                       |
| `adjust_account_balance` | Set an account to a target balance via an adjustment transaction (`finance:write`) |
| `archive_account` | Archive or unarchive an account; handles side effects (`finance:write`) |
| `delete_account` | Permanently delete an account and all its transactions (`finance:delete`) |
| `unlink_account_from_bank_connection` | Disconnect a bank-connected account; it becomes manual and keeps history (`finance:write`) |
| `get_account_groups` | List account groups (nested folders) with parent, path, child groups and accounts |
| `create_account_group` | Create an account group, optionally nested under a parent (`finance:write`) |
| `update_account_group` | Rename an account group or change its parent or logo (`finance:write`) |
| `move_account_group` | Move an account group under another group or to the top level (`finance:write`) |
| `delete_account_group` | Delete an account group; its accounts are kept, only ungrouped (`finance:delete`) |
| `add_account_to_group` | Put an account into a group; an account is in one group at a time (`finance:write`) |
| `remove_accounts_from_group` | Take accounts out of a group (`finance:write`) |
| `get_transaction_groups` | List transaction groups with counts/dates or full embedded transactions |
| `create_transaction_group` | Bundle related transactions into a group (e.g. split bill) (`finance:write`) |
| `update_transaction_group` | Rename or add a note to an existing group (`finance:write`) |
| `delete_transaction_group` | Delete a group — transactions kept (`finance:delete`) |
| `add_transactions_to_group` | Add transactions to an existing group (`finance:write`) |
| `remove_transactions_from_group` | Remove transactions from a group, optionally dissolving it (`finance:write`) |
| `get_subscriptions` | List subscriptions/bills with frequency, amount, and linked count |
| `get_subscription_by_id` | Single subscription with linked transactions and next payment date |
| `create_subscription` | Create a subscription, bill, or installment — expense by default or income via transactionType (`finance:write`) |
| `update_subscription` | Update subscription fields (`finance:write`) |
| `delete_subscription` | Delete a subscription and its transaction links (`finance:delete`) |
| `toggle_subscription_active` | Activate or deactivate a subscription (`finance:write`) |
| `detect_subscription_candidates` | Scan 12 months of transactions to auto-detect recurring patterns (`finance:write`) |
| `list_subscription_candidates` | List auto-detected candidates sorted by confidence score |
| `dismiss_subscription_candidate` | Dismiss a pending candidate (`finance:write`) |
| `link_transactions_to_subscription` | Mark transactions as payment instances of a subscription (`finance:write`) |
| `unlink_transactions_from_subscription` | Remove transaction links from a subscription (`finance:write`) |
| `get_upcoming_subscription_payments` | Upcoming payments sorted by next expected date |
| `get_subscriptions_summary` | Monthly/yearly cost, expected monthly income, and per-direction active counts in base currency |
| `accept_subscription_candidate` | Accept a detected candidate, optionally linking its samples to a subscription (`finance:write`) |
| `get_transaction_automations` | List automation rules with evaluation order, enabled state, match counts, and pause reason |
| `accept_subscription_candidate` | Accept a detected candidate, optionally linking its samples to a subscription (`finance:write`) |
| `list_subscription_match_suggestions` | Past transactions a subscription's matching rules would match but that are not linked yet |
| `list_subscription_match_suggestions` | Past transactions a subscription's matching rules would match but that are not linked yet |
| `get_subscription_periods` | A subscription's billing periods with status and the transaction behind each paid one |
| `get_subscription_periods` | A subscription's billing periods with status and the transaction behind each paid one |
| `preview_subscription_payment` | What paying a period would book (converted amount, already-recorded payments); changes nothing |
| `preview_subscription_payment` | What paying a period would book (converted amount, already-recorded payments); changes nothing |
| `pay_subscription_period` | Mark a period paid by linking a transaction or booking a new one (`finance:write`) |
| `pay_subscription_period` | Mark a period paid by linking a transaction or booking a new one (`finance:write`) |
| `skip_subscription_period` | Skip a billing cycle without paying it (`finance:write`) |
| `skip_subscription_period` | Skip a billing cycle without paying it (`finance:write`) |
| `unlink_subscription_period_transaction` | Detach a period's transaction; the transaction and the paid status stay (`finance:write`) |
| `unlink_subscription_period_transaction` | Detach a period's transaction; the transaction and the paid status stay (`finance:write`) |
| `revert_subscription_period` | Undo a paid or skipped period; may delete the transaction the app booked (`finance:write` + `finance:delete`) |
| `revert_subscription_period` | Undo a paid or skipped period; may delete the transaction the app booked (`finance:write` + `finance:delete`) |
| `get_transaction_automations` | List automation rules with evaluation order, enabled state, match counts, and pause reason |
| `get_transaction_automations` | List automation rules with evaluation order, enabled state, match counts, and pause reason |
| `get_transaction_automations` | List automation rules with evaluation order, enabled state, match counts, and pause reason |
| `preview_transaction_automation` | Dry-run automation conditions against recent transactions; nothing is modified |
| `preview_transaction_automation` | Dry-run automation conditions against recent transactions; nothing is modified |
| `preview_transaction_automation` | Dry-run automation conditions against recent transactions; nothing is modified |
| `preview_transaction_automation` | Dry-run automation conditions against recent transactions; nothing is modified |
| `create_transaction_automation` | Create a rule that sets category, tags, payee, or note on matching transactions (`finance:write`) |
| `create_transaction_automation` | Create a rule that sets category, tags, payee, or note on matching transactions (`finance:write`) |
| `create_transaction_automation` | Create a rule that sets category, tags, payee, or note on matching transactions (`finance:write`) |
| `create_transaction_automation` | Create a rule that sets category, tags, payee, or note on matching transactions (`finance:write`) |
| `update_transaction_automation` | Change a rule name, conditions, actions, or enabled state (`finance:write`) |
| `update_transaction_automation` | Change a rule name, conditions, actions, or enabled state (`finance:write`) |
| `update_transaction_automation` | Change a rule name, conditions, actions, or enabled state (`finance:write`) |
| `update_transaction_automation` | Change a rule name, conditions, actions, or enabled state (`finance:write`) |
| `delete_transaction_automation` | Permanently delete an automation rule (`finance:delete`) |
| `delete_transaction_automation` | Permanently delete an automation rule (`finance:delete`) |
| `delete_transaction_automation` | Permanently delete an automation rule (`finance:delete`) |
| `delete_transaction_automation` | Permanently delete an automation rule (`finance:delete`) |
| `reorder_transaction_automations` | Set the top-to-bottom evaluation order of the automation rules (`finance:write`) |
| `reorder_transaction_automations` | Set the top-to-bottom evaluation order of the automation rules (`finance:write`) |
| `reorder_transaction_automations` | Set the top-to-bottom evaluation order of the automation rules (`finance:write`) |
| `reorder_transaction_automations` | Set the top-to-bottom evaluation order of the automation rules (`finance:write`) |
| `apply_transaction_automation` | Run a saved rule on up to 500 existing transactions; non-matching ids are skipped (`finance:write`) |
| `create_transaction` | Create income, expense, or transfer with optional splits/tags/payee/original-currency amount (`finance:write`) |
| `apply_transaction_automation` | Run a saved rule on up to 500 existing transactions; non-matching ids are skipped (`finance:write`) |
| `get_transaction_templates` | List transaction templates: named presets for new transactions |
| `get_transaction_templates` | List transaction templates: named presets for new transactions |
| `create_transaction_template` | Create a template: type, account, pinned amount, category, payee, tags (`finance:write`) |
| `create_transaction_template` | Create a template: type, account, pinned amount, category, payee, tags (`finance:write`) |
| `update_transaction_template` | Change a template; `null` clears a field, `tagIds` replaces the tags (`finance:write`) |
| `update_transaction_template` | Change a template; `null` clears a field, `tagIds` replaces the tags (`finance:write`) |
| `delete_transaction_template` | Permanently delete a template (`finance:delete`) |
| `delete_transaction_template` | Permanently delete a template (`finance:delete`) |
| `create_transaction` | Create income, expense, or transfer with optional splits/tags/payee/original-currency amount (`finance:write`) |
| `create_transaction` | Create income, expense, or transfer with optional splits/tags/payee/original-currency amount (`finance:write`) |
| `create_transaction` | Create income, expense, or transfer with optional splits/tags/payee/original-currency amount (`finance:write`) |
| `update_transaction` | Update amount, date, category, payee, tags, note, splits, or original-currency amount (`finance:write`) |
| `update_transaction` | Update amount, date, category, payee, tags, note, splits, or original-currency amount (`finance:write`) |
| `update_transaction` | Update amount, date, category, payee, tags, note, splits, or original-currency amount (`finance:write`) |
| `update_transaction` | Update amount, date, category, payee, tags, note, splits, or original-currency amount (`finance:write`) |
| `delete_transaction` | Permanently delete a transaction; transfer pairs are deleted together (`finance:delete`) |
| `delete_transaction` | Permanently delete a transaction; transfer pairs are deleted together (`finance:delete`) |
| `delete_transaction` | Permanently delete a transaction; transfer pairs are deleted together (`finance:delete`) |
| `delete_transaction` | Permanently delete a transaction; transfer pairs are deleted together (`finance:delete`) |
| `create_attachment_upload_url` | Get a short-lived URL to upload receipt files (JPEG/PNG/WebP/PDF) to a transaction over HTTP (`finance:write`) |
| `create_attachment_upload_url` | Get a short-lived URL to upload receipt files (JPEG/PNG/WebP/PDF) to a transaction over HTTP (`finance:write`) |
| `create_attachment_upload_url` | Get a short-lived URL to upload receipt files (JPEG/PNG/WebP/PDF) to a transaction over HTTP (`finance:write`) |
| `create_attachment_upload_url` | Get a short-lived URL to upload receipt files (JPEG/PNG/WebP/PDF) to a transaction over HTTP (`finance:write`) |
| `bulk_update_transactions` | Update category, payee, note, or tags on multiple transactions at once (`finance:write`) |
| `bulk_update_transactions` | Update category, payee, note, or tags on multiple transactions at once (`finance:write`) |
| `bulk_update_transactions` | Update category, payee, note, or tags on multiple transactions at once (`finance:write`) |
| `bulk_update_transactions` | Update category, payee, note, or tags on multiple transactions at once (`finance:write`) |
| `split_transaction` | Split a transaction across multiple categories (`finance:write`) |
| `split_transaction` | Split a transaction across multiple categories (`finance:write`) |
| `split_transaction` | Split a transaction across multiple categories (`finance:write`) |
| `split_transaction` | Split a transaction across multiple categories (`finance:write`) |
| `delete_split` | Delete a single split by split ID (`finance:delete`) |
| `delete_split` | Delete a single split by split ID (`finance:delete`) |
| `delete_split` | Delete a single split by split ID (`finance:delete`) |
| `delete_split` | Delete a single split by split ID (`finance:delete`) |
| `link_transfer` | Link two existing transactions as a transfer pair (`finance:write`) |
| `link_transfer` | Link two existing transactions as a transfer pair (`finance:write`) |
| `link_transfer` | Link two existing transactions as a transfer pair (`finance:write`) |
| `link_transfer` | Link two existing transactions as a transfer pair (`finance:write`) |
| `unlink_transfer` | Unlink a transfer pair by transferId (`finance:write`) |
| `unlink_transfer` | Unlink a transfer pair by transferId (`finance:write`) |
| `unlink_transfer` | Unlink a transfer pair by transferId (`finance:write`) |
| `unlink_transfer` | Unlink a transfer pair by transferId (`finance:write`) |
| `link_refund` | Mark a transaction as a refund of another (`finance:write`) |
| `link_refund` | Mark a transaction as a refund of another (`finance:write`) |
| `link_refund` | Mark a transaction as a refund of another (`finance:write`) |
| `link_refund` | Mark a transaction as a refund of another (`finance:write`) |
| `unlink_refund` | Remove the refund link between two transactions (`finance:write`) |
| `unlink_refund` | Remove the refund link between two transactions (`finance:write`) |
| `unlink_refund` | Remove the refund link between two transactions (`finance:write`) |
| `unlink_refund` | Remove the refund link between two transactions (`finance:write`) |
| `get_refunds` | Refund links: of one transaction, one pair, or a paged list; both sides carry their payee |
| `get_refunds` | Refund links: of one transaction, one pair, or a paged list; both sides carry their payee |
| `get_refunds` | Refund links: of one transaction, one pair, or a paged list; both sides carry their payee |
| `get_refunds` | Refund links: of one transaction, one pair, or a paged list; both sides carry their payee |
| `get_refund_recommendations` | Suggest transactions a refund could link to (saved transaction or form data) |
| `get_refund_recommendations` | Suggest transactions a refund could link to (saved transaction or form data) |
| `get_refund_recommendations` | Suggest transactions a refund could link to (saved transaction or form data) |
| `get_refund_recommendations` | Suggest transactions a refund could link to (saved transaction or form data) |
| `get_transfer_recommendations` | Suggest the other leg of a transfer (saved transaction or form data) |
| `get_transfer_recommendations` | Suggest the other leg of a transfer (saved transaction or form data) |
| `get_transfer_recommendations` | Suggest the other leg of a transfer (saved transaction or form data) |
| `get_transfer_recommendations` | Suggest the other leg of a transfer (saved transaction or form data) |
| `list_transfer_suggestions` | Scan a period for likely transfer pairs with a confidence score; reads only |
| `list_transfer_suggestions` | Scan a period for likely transfer pairs with a confidence score; reads only |
| `list_transfer_suggestions` | Scan a period for likely transfer pairs with a confidence score; reads only |
| `list_transfer_suggestions` | Scan a period for likely transfer pairs with a confidence score; reads only |
| `dismiss_transfer_suggestion` | Dismiss a suggested pair as not a transfer (`finance:write`) |
| `dismiss_transfer_suggestion` | Dismiss a suggested pair as not a transfer (`finance:write`) |
| `dismiss_transfer_suggestion` | Dismiss a suggested pair as not a transfer (`finance:write`) |
| `dismiss_transfer_suggestion` | Dismiss a suggested pair as not a transfer (`finance:write`) |
| `get_reconciliation_history` | Past duplicate removals and merges, newest first, with the removed rows and survivors |
| `get_reconciliation_history` | Past duplicate removals and merges, newest first, with the removed rows and survivors |
| `get_reconciliation_history` | Past duplicate removals and merges, newest first, with the removed rows and survivors |
| `get_reconciliation_history` | Past duplicate removals and merges, newest first, with the removed rows and survivors |
| `list_stuck_pending_transactions` | Bank transactions pending over 7 days, each with the booked row that likely replaced it |
| `list_stuck_pending_transactions` | Bank transactions pending over 7 days, each with the booked row that likely replaced it |
| `list_stuck_pending_transactions` | Bank transactions pending over 7 days, each with the booked row that likely replaced it |
| `list_stuck_pending_transactions` | Bank transactions pending over 7 days, each with the booked row that likely replaced it |
| `remove_duplicate_transactions` | Remove duplicates from the books; restorable, but without their links (`finance:write`) |
| `remove_duplicate_transactions` | Remove duplicates from the books; restorable, but without their links (`finance:write`) |
| `remove_duplicate_transactions` | Remove duplicates from the books; restorable, but without their links (`finance:write`) |
| `remove_duplicate_transactions` | Remove duplicates from the books; restorable, but without their links (`finance:write`) |
| `restore_removed_transactions` | Bring back removed or merged transactions, without the links they lost (`finance:write`) |
| `restore_removed_transactions` | Bring back removed or merged transactions, without the links they lost (`finance:write`) |
| `restore_removed_transactions` | Bring back removed or merged transactions, without the links they lost (`finance:write`) |
| `restore_removed_transactions` | Bring back removed or merged transactions, without the links they lost (`finance:write`) |
| `merge_duplicate_transactions` | Merge 2 to 4 duplicates of one account into a survivor that takes their links (`finance:write`) |
| `merge_duplicate_transactions` | Merge 2 to 4 duplicates of one account into a survivor that takes their links (`finance:write`) |
| `merge_duplicate_transactions` | Merge 2 to 4 duplicates of one account into a survivor that takes their links (`finance:write`) |
| `merge_duplicate_transactions` | Merge 2 to 4 duplicates of one account into a survivor that takes their links (`finance:write`) |
| `keep_pending_as_booked` | Confirm stuck pending bank transactions as booked (`finance:write`) |
| `keep_pending_as_booked` | Confirm stuck pending bank transactions as booked (`finance:write`) |
| `keep_pending_as_booked` | Confirm stuck pending bank transactions as booked (`finance:write`) |
| `keep_pending_as_booked` | Confirm stuck pending bank transactions as booked (`finance:write`) |
| `assign_tags_to_transaction` | Assign tags to a transaction (`finance:write`) |
| `assign_tags_to_transaction` | Assign tags to a transaction (`finance:write`) |
| `assign_tags_to_transaction` | Assign tags to a transaction (`finance:write`) |
| `assign_tags_to_transaction` | Assign tags to a transaction (`finance:write`) |
| `remove_tags_from_transaction` | Remove tags from one or more transactions (`finance:write`) |
| `remove_tags_from_transaction` | Remove tags from one or more transactions (`finance:write`) |
| `remove_tags_from_transaction` | Remove tags from one or more transactions (`finance:write`) |
| `remove_tags_from_transaction` | Remove tags from one or more transactions (`finance:write`) |
| `create_category` | Create a new category, optionally nested (`finance:write`) |
| `create_category` | Create a new category, optionally nested (`finance:write`) |
| `create_category` | Create a new category, optionally nested (`finance:write`) |
| `create_category` | Create a new category, optionally nested (`finance:write`) |
| `update_category` | Rename, recolor, or change a category's icon (`finance:write`) |
| `update_category` | Rename, recolor, or change a category's icon (`finance:write`) |
| `update_category` | Rename, recolor, or change a category's icon (`finance:write`) |
| `update_category` | Rename, recolor, or change a category's icon (`finance:write`) |
| `delete_category` | Delete a category; supply replacement for linked transactions (`finance:delete`) |
| `delete_category` | Delete a category; supply replacement for linked transactions (`finance:delete`) |
| `delete_category` | Delete a category; supply replacement for linked transactions (`finance:delete`) |
| `delete_category` | Delete a category; supply replacement for linked transactions (`finance:delete`) |
| `create_tag` | Create a new transaction tag (`finance:write`) |
| `create_tag` | Create a new transaction tag (`finance:write`) |
| `create_tag` | Create a new transaction tag (`finance:write`) |
| `create_tag` | Create a new transaction tag (`finance:write`) |
| `update_tag` | Rename, recolor, or update a tag (`finance:write`) |
| `update_tag` | Rename, recolor, or update a tag (`finance:write`) |
| `update_tag` | Rename, recolor, or update a tag (`finance:write`) |
| `update_tag` | Rename, recolor, or update a tag (`finance:write`) |
| `delete_tag` | Permanently delete a tag and unlink it from all transactions (`finance:delete`) |
| `delete_tag` | Permanently delete a tag and unlink it from all transactions (`finance:delete`) |
| `delete_tag` | Permanently delete a tag and unlink it from all transactions (`finance:delete`) |
| `delete_tag` | Permanently delete a tag and unlink it from all transactions (`finance:delete`) |
| `get_tag_reminders` | Tag reminders: amount threshold or existence check, scheduled or real-time; filter by tag or reminder |
| `set_exchange_rates` | Set the user's own rates for pairs, each with its opposite (`finance:write`) |
| `get_tag_reminders` | Tag reminders: amount threshold or existence check, scheduled or real-time; filter by tag or reminder |
| `create_tag_reminder` | Create a tag reminder (amount threshold in the base currency, or existence check) (`finance:write`) |
| `create_tag_reminder` | Create a tag reminder (amount threshold in the base currency, or existence check) (`finance:write`) |
| `update_tag_reminder` | Change a reminder; `null` clears the schedule, `isEnabled` pauses it (`finance:write`) |
| `update_tag_reminder` | Change a reminder; `null` clears the schedule, `isEnabled` pauses it (`finance:write`) |
| `delete_tag_reminder` | Permanently delete a tag reminder (`finance:delete`) |
| `delete_tag_reminder` | Permanently delete a tag reminder (`finance:delete`) |
| `get_notifications` | In-app notifications with total and unread count; filter by status or type, or read one by id |
| `get_notifications` | In-app notifications with total and unread count; filter by status or type, or read one by id |
| `mark_notifications_read` | Mark one notification read, or all if no id; read-only accounts allowed (`finance:write`) |
| `mark_notifications_read` | Mark one notification read, or all if no id; read-only accounts allowed (`finance:write`) |
| `dismiss_notification` | Dismiss a notification from the list and the unread count (`finance:write`) |
| `dismiss_notification` | Dismiss a notification from the list and the unread count (`finance:write`) |
| `get_user_settings` | App settings: language, notifications, dashboard, layout, saved views, FIRE inputs; no AI part |
| `get_user_settings` | App settings: language, notifications, dashboard, layout, saved views, FIRE inputs; no AI part |
| `update_user_settings` | Patch app settings; arrays replaced whole; `fire` needs the FIRE planner (`finance:write`) |
| `update_user_settings` | Patch app settings; arrays replaced whole; `fire` needs the FIRE planner (`finance:write`) |
| `get_payees` | List payees (merchants) with transaction count, net flow and top category; filter by name |
| `get_payees` | List payees (merchants) with transaction count, net flow and top category; filter by name |
| `get_payee` | One payee with its aliases and stats |
| `get_payee` | One payee with its aliases and stats |
| `create_payee` | Create a payee (`finance:write`) |
| `create_payee` | Create a payee (`finance:write`) |
| `update_payee` | Rename a payee or change its default category, mode, default tags, location or logo (`finance:write`) |
| `update_payee` | Rename a payee or change its default category, mode, default tags, location or logo (`finance:write`) |
| `delete_payee` | Permanently delete a payee; its transactions stay, unlinked (`finance:delete`) |
| `delete_payee` | Permanently delete a payee; its transactions stay, unlinked (`finance:delete`) |
| `merge_payees` | Merge one payee into another; the source is deleted (`finance:delete`) |
| `merge_payees` | Merge one payee into another; the source is deleted (`finance:delete`) |
| `set_payees_categorization_mode` | Set the categorization mode of every payee at once (`finance:write`) |
| `set_payees_categorization_mode` | Set the categorization mode of every payee at once (`finance:write`) |
| `bulk_delete_payees` | Permanently delete up to 2000 payees, optionally ignoring their names later (`finance:delete`) |
| `bulk_delete_payees` | Permanently delete up to 2000 payees, optionally ignoring their names later (`finance:delete`) |
| `get_ignored_payee_names` | Names that are never turned into payees automatically |
| `get_ignored_payee_names` | Names that are never turned into payees automatically |
| `ignore_payee_name` | Add a name to the ignored list; `force` also deletes its payee (`finance:write` + `finance:delete` with `force`) |
| `ignore_payee_name` | Add a name to the ignored list; `force` also deletes its payee (`finance:write` + `finance:delete` with `force`) |
| `unignore_payee_name` | Remove a name from the ignored list (`finance:write`) |
| `unignore_payee_name` | Remove a name from the ignored list (`finance:write`) |
| `apply_payee_tags_to_transactions` | Add a payee's default tags to all its existing transactions; adds only (`finance:write`) |
| `apply_payee_tags_to_transactions` | Add a payee's default tags to all its existing transactions; adds only (`finance:write`) |
| `create_payee_alias` | Add another name that links to a payee (`finance:write`) |
| `create_payee_alias` | Add another name that links to a payee (`finance:write`) |
| `delete_payee_alias` | Delete one alias of a payee (`finance:delete`) |
| `delete_payee_alias` | Delete one alias of a payee (`finance:delete`) |
| `list_custom_currencies` | List the user's custom currencies (code, name, symbol, decimals, logo) |
| `list_custom_currencies` | List the user's custom currencies (code, name, symbol, decimals, logo) |
| `create_custom_currency` | Define a custom currency such as points or a token; needs a rate source for base values (`finance:write`) |
| `create_custom_currency` | Define a custom currency such as points or a token; needs a rate source for base values (`finance:write`) |
| `update_custom_currency` | Change a custom currency's name, decimals, symbol, or logo; decimals locked while in use (`finance:write`) |
| `update_custom_currency` | Change a custom currency's name, decimals, symbol, or logo; decimals locked while in use (`finance:write`) |
| `delete_custom_currency` | Delete an unused custom currency and its exchange rates (`finance:delete`) |
| `delete_custom_currency` | Delete an unused custom currency and its exchange rates (`finance:delete`) |
| `search_coingecko_coins` | Find the CoinGecko coinId for a rate source by name or symbol |
| `search_coingecko_coins` | Find the CoinGecko coinId for a rate source by name or symbol |
| `get_currency_rate_history` | A custom currency's stored rates, latest first, with the rate in force |
| `get_currency_rate_history` | A custom currency's stored rates, latest first, with the rate in force |
| `set_currency_rate_source` | Set a currency's rate source (provider, manual, peg, CoinGecko, HTTP); re-values saved rows (`finance:write`) |
| `set_currency_rate_source` | Set a currency's rate source (provider, manual, peg, CoinGecko, HTTP); re-values saved rows (`finance:write`) |
| `test_currency_rate_source` | Preview an HTTP rate source for one day without saving it (`finance:write`) |
| `test_currency_rate_source` | Preview an HTTP rate source for one day without saving it (`finance:write`) |
| `set_exchange_rates` | Set the user's own rates for pairs, each with its opposite; custom pairs take a date (`finance:write`) |
| `set_exchange_rates` | Set the user's own rates for pairs, each with its opposite; custom pairs take a date (`finance:write`) |
| `set_exchange_rates` | Set the user's own rates for pairs, each with its opposite (`finance:write`) |
| `delete_exchange_rates` | Remove the user's own rates for pairs, each with its opposite (`finance:delete`) |
| `delete_exchange_rates` | Remove the user's own rates for pairs, each with its opposite (`finance:delete`) |
| `delete_exchange_rates` | Remove the user's own rates for pairs, each with its opposite (`finance:delete`) |
| `delete_exchange_rates` | Remove the user's own rates for pairs, each with its opposite (`finance:delete`) |
| `get_user_currencies` | Base currency, held currencies with their rate settings, and today's rates to the base |
| `get_user_currencies` | Base currency, held currencies with their rate settings, and today's rates to the base |
| `get_user_currencies` | Base currency, held currencies with their rate settings, and today's rates to the base |
| `get_user_currencies` | Base currency, held currencies with their rate settings, and today's rates to the base |
| `list_supported_currencies` | Every ISO currency the app supports (code, name, decimals) |
| `list_supported_currencies` | Every ISO currency the app supports (code, name, decimals) |
| `list_supported_currencies` | Every ISO currency the app supports (code, name, decimals) |
| `list_supported_currencies` | Every ISO currency the app supports (code, name, decimals) |
| `get_exchange_rate` | Rate of a pair on a day, or the global rates of the day |
| `get_exchange_rate` | Rate of a pair on a day, or the global rates of the day |
| `get_exchange_rate` | Rate of a pair on a day, or the global rates of the day |
| `get_exchange_rate` | Rate of a pair on a day, or the global rates of the day |
| `add_user_currencies` | Add currencies the user holds, with optional flat rate and live-rate flag (`finance:write`) |
| `add_user_currencies` | Add currencies the user holds, with optional flat rate and live-rate flag (`finance:write`) |
| `add_user_currencies` | Add currencies the user holds, with optional flat rate and live-rate flag (`finance:write`) |
| `add_user_currencies` | Add currencies the user holds, with optional flat rate and live-rate flag (`finance:write`) |
| `update_user_currency` | Change a held currency's flat rate or market-vs-manual rate; re-values balances (`finance:write`) |
| `update_user_currency` | Change a held currency's flat rate or market-vs-manual rate; re-values balances (`finance:write`) |
| `update_user_currency` | Change a held currency's flat rate or market-vs-manual rate; re-values balances (`finance:write`) |
| `update_user_currency` | Change a held currency's flat rate or market-vs-manual rate; re-values balances (`finance:write`) |
| `delete_user_currency` | Stop holding an unused ISO currency; not the base currency (`finance:delete`) |
| `delete_user_currency` | Stop holding an unused ISO currency; not the base currency (`finance:delete`) |
| `delete_user_currency` | Stop holding an unused ISO currency; not the base currency (`finance:delete`) |
| `delete_user_currency` | Stop holding an unused ISO currency; not the base currency (`finance:delete`) |
| `change_base_currency` | Set the base currency; a change recalculates history and blocks edits until done (`finance:write`) |
| `change_base_currency` | Set the base currency; a change recalculates history and blocks edits until done (`finance:write`) |
| `change_base_currency` | Set the base currency; a change recalculates history and blocks edits until done (`finance:write`) |
| `change_base_currency` | Set the base currency; a change recalculates history and blocks edits until done (`finance:write`) |
| `get_base_currency_change_status` | State of the running or last base-currency change |
| `get_base_currency_change_status` | State of the running or last base-currency change |
| `get_base_currency_change_status` | State of the running or last base-currency change |
| `get_base_currency_change_status` | State of the running or last base-currency change |
| `get_category_transaction_count` | Count transactions filed under a category; check before `delete_category` |
| `get_budget` | One tracker with its limit, categories and stats (income, expense, balance, limit used) |
| `get_budget_transactions` | Transactions a category tracker counts, newest first; manual trackers use `search_transactions` with `budgetIds` |
| `get_total_balance` | Total balance on one date across all accounts, net of credit limits if that setting is on |
| `get_net_worth_history` | Net worth over a range: assets and liabilities by kind, weekly to yearly points |
| `get_net_worth_drivers` | What moved net worth per period: savings, investment growth, dividends, fees |
| `get_investment_contributions` | Money moved into portfolios per period, split per portfolio |
| `get_venture_contributions` | Net contributed to each venture deal over a range |
| `get_pivot_report` | Spending or income as rows (category, payee, tag) by time columns, with totals |
| `get_cumulative_stats` | Running monthly totals of expenses, income or savings vs the previous period |
| `get_earliest_transaction_date` | Date of the first transaction on record; start date for reports |
| `get_portfolio` | Read one portfolio by id |
| `get_portfolios_overview` | Summaries and annualized returns of all portfolios |
| `get_security_prices` | Stored closing prices of one security, optionally in a date range |
| `create_holding` | Add a security to a portfolio from a search result or securityId (`finance:write`) |
| `delete_holding` | Remove a security from a portfolio, with `force` its transactions too (`finance:delete`) |
| `restore_portfolio` | Restore a deleted portfolio (`finance:write`) |
| `transfer_between_portfolios` | Move cash from one portfolio to another (`finance:write`) |
| `exchange_portfolio_currency` | Exchange one cash currency for another inside a portfolio (`finance:write`) |
| `set_portfolio_transfer_adjustment` | Flag a transfer as an adjustment, not a contribution (`finance:write`) |
| `delete_portfolio_transfer` | Delete a portfolio transfer and reverse its cash effect (`finance:delete`) |
| `link_transactions_to_venture_event` | Link bank transactions to a venture event as its cash (`finance:write`) |
| `link_transactions_to_venture_event` | Link bank transactions to a venture event as its cash (`finance:write`) |

<<<<<<< ours
| `link_transactions_to_venture_event` | Link bank transactions to a venture event as its cash (`finance:write`) |
| `replace_venture_event_links` | Replace the transactions linked to a venture event (`finance:write`) |
| `replace_venture_event_links` | Replace the transactions linked to a venture event (`finance:write`) |
| `replace_venture_event_links` | Replace the transactions linked to a venture event (`finance:write`) |
| `delete_venture_event_link` | Remove one transaction link from a venture event (`finance:delete`) |
| `delete_venture_event_link` | Remove one transaction link from a venture event (`finance:delete`) |
| `delete_venture_event_link` | Remove one transaction link from a venture event (`finance:delete`) |
<<<<<<< ours
| `adjust_account_balance` | Set an account to a target balance via an adjustment transaction (`finance:write`) |
| `archive_account` | Archive or unarchive an account; handles side effects (`finance:write`) |
| `delete_account` | Permanently delete an account and all its transactions (`finance:delete`) |
| `unlink_account_from_bank_connection` | Disconnect a bank-connected account; it becomes manual and keeps history (`finance:write`) |
| `get_account_groups` | List account groups (nested folders) with parent, path, child groups and accounts |
| `create_account_group` | Create an account group, optionally nested under a parent (`finance:write`) |
| `update_account_group` | Rename an account group or change its parent or logo (`finance:write`) |
| `move_account_group` | Move an account group under another group or to the top level (`finance:write`) |
| `delete_account_group` | Delete an account group; its accounts are kept, only ungrouped (`finance:delete`) |
| `add_account_to_group` | Put an account into a group; an account is in one group at a time (`finance:write`) |
| `remove_accounts_from_group` | Take accounts out of a group (`finance:write`) |
| `get_transaction_groups` | List transaction groups with counts/dates or full embedded transactions; `groupId` reads one group |
| `create_transaction_group` | Bundle related transactions into a group (e.g. split bill) (`finance:write`) |
| `update_transaction_group` | Rename or add a note to an existing group (`finance:write`) |
| `delete_transaction_group` | Delete a group — transactions kept (`finance:delete`) |
| `add_transactions_to_group` | Add transactions to an existing group (`finance:write`) |
| `remove_transactions_from_group` | Remove transactions from a group, optionally dissolving it (`finance:write`) |
| `get_subscriptions` | List subscriptions/bills with frequency, amount, and linked count |
| `get_subscription_by_id` | Single subscription with linked transactions and next payment date |
| `create_subscription` | Create a subscription, bill, or installment — expense by default or income via transactionType (`finance:write`) |
| `update_subscription` | Update subscription fields (`finance:write`) |
| `delete_subscription` | Delete a subscription and its transaction links (`finance:delete`) |
| `toggle_subscription_active` | Activate or deactivate a subscription (`finance:write`) |
| `detect_subscription_candidates` | Scan 12 months of transactions to auto-detect recurring patterns (`finance:write`) |
| `list_subscription_candidates` | List auto-detected candidates sorted by confidence score |
| `dismiss_subscription_candidate` | Dismiss a pending candidate (`finance:write`) |
| `link_transactions_to_subscription` | Mark transactions as payment instances of a subscription (`finance:write`) |
| `unlink_transactions_from_subscription` | Remove transaction links from a subscription (`finance:write`) |
| `get_upcoming_subscription_payments` | Upcoming payments sorted by next expected date |
| `get_subscriptions_summary` | Monthly/yearly cost, expected monthly income, and per-direction active counts in base currency |

> > > > > > > theirs
> > > > > > > | `accept_subscription_candidate` | Accept a detected candidate, optionally linking its samples to a subscription (`finance:write`) |
> > > > > > > | `list_subscription_match_suggestions` | Past transactions a subscription's matching rules would match but that are not linked yet |
> > > > > > > | `get_subscription_periods` | A subscription's billing periods with status and the transaction behind each paid one |
> > > > > > > | `preview_subscription_payment` | What paying a period would book (converted amount, already-recorded payments); changes nothing |
> > > > > > > | `pay_subscription_period` | Mark a period paid by linking a transaction or booking a new one (`finance:write`) |
> > > > > > > | `skip_subscription_period` | Skip a billing cycle without paying it (`finance:write`) |
> > > > > > > | `unlink_subscription_period_transaction` | Detach a period's transaction; the transaction and the paid status stay (`finance:write`) |
> > > > > > > | `revert_subscription_period` | Undo a paid or skipped period; may delete the transaction the app booked (`finance:write` + `finance:delete`) |
> > > > > > > | `get_transaction_automations` | List automation rules with evaluation order, enabled state, match counts, and pause reason |
> > > > > > > | `preview_transaction_automation` | Dry-run automation conditions against recent transactions; nothing is modified |
> > > > > > > | `create_transaction_automation` | Create a rule that sets category, tags, payee, or note on matching transactions (`finance:write`) |
> > > > > > > | `update_transaction_automation` | Change a rule name, conditions, actions, or enabled state (`finance:write`) |
> > > > > > > | `delete_transaction_automation` | Permanently delete an automation rule (`finance:delete`) |
> > > > > > > | `reorder_transaction_automations` | Set the top-to-bottom evaluation order of the automation rules (`finance:write`) |
> > > > > > > | `apply_transaction_automation` | Run a saved rule on up to 500 existing transactions; non-matching ids are skipped (`finance:write`) |
> > > > > > > | `get_transaction_templates` | List transaction templates: named presets for new transactions |
> > > > > > > | `create_transaction_template` | Create a template: type, account, pinned amount, category, payee, tags (`finance:write`) |
> > > > > > > | `update_transaction_template` | Change a template; `null` clears a field, `tagIds` replaces the tags (`finance:write`) |
> > > > > > > | `delete_transaction_template` | Permanently delete a template (`finance:delete`) |
> > > > > > > | `create_transaction` | Create income, expense, or transfer with optional splits/tags/payee/original-currency amount (`finance:write`) |
> > > > > > > | `update_transaction` | Update amount, date, category, payee, tags, note, splits, or original-currency amount (`finance:write`) |
> > > > > > > | `delete_transaction` | Permanently delete a transaction; transfer pairs are deleted together (`finance:delete`) |
> > > > > > > | `create_attachment_upload_url` | Get a short-lived URL to upload receipt files (JPEG/PNG/WebP/PDF) to a transaction over HTTP (`finance:write`) |
> > > > > > > | `bulk_update_transactions` | Update category, payee, note, or tags on multiple transactions at once (`finance:write`) |
> > > > > > > | `split_transaction` | Split a transaction across multiple categories (`finance:write`) |
> > > > > > > | `delete_split` | Delete a single split by split ID (`finance:delete`) |
> > > > > > > | `link_transfer` | Link two existing transactions as a transfer pair (`finance:write`) |
> > > > > > > | `unlink_transfer` | Unlink a transfer pair by transferId (`finance:write`) |
> > > > > > > | `link_refund` | Mark a transaction as a refund of another (`finance:write`) |
> > > > > > > | `unlink_refund` | Remove the refund link between two transactions (`finance:write`) |
> > > > > > > | `get_refunds` | Refund links: of one transaction, one pair, or a paged list; both sides carry their payee |
> > > > > > > | `get_refund_recommendations` | Suggest transactions a refund could link to (saved transaction or form data) |
> > > > > > > | `get_transfer_recommendations` | Suggest the other leg of a transfer (saved transaction or form data) |
> > > > > > > | `list_transfer_suggestions` | Scan a period for likely transfer pairs with a confidence score; reads only |
> > > > > > > | `dismiss_transfer_suggestion` | Dismiss a suggested pair as not a transfer (`finance:write`) |
> > > > > > > | `get_reconciliation_history` | Past duplicate removals and merges, newest first, with the removed rows and survivors |
> > > > > > > | `list_stuck_pending_transactions` | Bank transactions pending over 7 days, each with the booked row that likely replaced it |
> > > > > > > | `remove_duplicate_transactions` | Remove duplicates from the books; restorable, but without their links (`finance:write`) |
> > > > > > > | `restore_removed_transactions` | Bring back removed or merged transactions, without the links they lost (`finance:write`) |
> > > > > > > | `merge_duplicate_transactions` | Merge 2 to 4 duplicates of one account into a survivor that takes their links (`finance:write`) |
> > > > > > > | `keep_pending_as_booked` | Confirm stuck pending bank transactions as booked (`finance:write`) |
> > > > > > > | `assign_tags_to_transaction` | Assign tags to a transaction (`finance:write`) |
> > > > > > > | `remove_tags_from_transaction` | Remove tags from one or more transactions (`finance:write`) |
> > > > > > > | `create_category` | Create a new category, optionally nested (`finance:write`) |
> > > > > > > | `update_category` | Rename, recolor, or change a category's icon (`finance:write`) |
> > > > > > > | `delete_category` | Delete a category; supply replacement for linked transactions (`finance:delete`) |
> > > > > > > | `create_tag` | Create a new transaction tag (`finance:write`) |
> > > > > > > | `update_tag` | Rename, recolor, or update a tag (`finance:write`) |
> > > > > > > | `delete_tag` | Permanently delete a tag and unlink it from all transactions (`finance:delete`) |
> > > > > > > | `get_tag_reminders` | Tag reminders: amount threshold or existence check, scheduled or real-time; filter by tag or reminder |
> > > > > > > | `create_tag_reminder` | Create a tag reminder (amount threshold in the base currency, or existence check) (`finance:write`) |
> > > > > > > | `update_tag_reminder` | Change a reminder; `null` clears the schedule, `isEnabled` pauses it (`finance:write`) |
> > > > > > > | `delete_tag_reminder` | Permanently delete a tag reminder (`finance:delete`) |
> > > > > > > | `get_notifications` | In-app notifications with total and unread count; filter by status or type, or read one by id |
> > > > > > > | `mark_notifications_read` | Mark one notification read, or all if no id; read-only accounts allowed (`finance:write`) |
> > > > > > > | `dismiss_notification` | Dismiss a notification from the list and the unread count (`finance:write`) |
> > > > > > > | `get_user_settings` | App settings: language, notifications, dashboard, layout, saved views, FIRE inputs; no AI part |
> > > > > > > | `update_user_settings` | Patch app settings; arrays replaced whole; `fire` needs the FIRE planner (`finance:write`) |
> > > > > > > | `get_payees` | List payees (merchants) with transaction count, net flow and top category; filter by name |
> > > > > > > | `get_payee` | One payee with its aliases and stats |
> > > > > > > | `create_payee` | Create a payee (`finance:write`) |
> > > > > > > | `update_payee` | Rename a payee or change its default category, mode, default tags, location or logo (`finance:write`) |
> > > > > > > | `delete_payee` | Permanently delete a payee; its transactions stay, unlinked (`finance:delete`) |
> > > > > > > | `merge_payees` | Merge one payee into another; the source is deleted (`finance:delete`) |
> > > > > > > | `set_payees_categorization_mode` | Set the categorization mode of every payee at once (`finance:write`) |
> > > > > > > | `bulk_delete_payees` | Permanently delete up to 2000 payees, optionally ignoring their names later (`finance:delete`) |
> > > > > > > | `get_ignored_payee_names` | Names that are never turned into payees automatically |
> > > > > > > | `ignore_payee_name` | Add a name to the ignored list; `force` also deletes its payee (`finance:write` + `finance:delete` with `force`) |
> > > > > > > | `unignore_payee_name` | Remove a name from the ignored list (`finance:write`) |
> > > > > > > | `apply_payee_tags_to_transactions` | Add a payee's default tags to all its existing transactions; adds only (`finance:write`) |
> > > > > > > | `create_payee_alias` | Add another name that links to a payee (`finance:write`) |
> > > > > > > | `delete_payee_alias` | Delete one alias of a payee (`finance:delete`) |
> > > > > > > | `list_custom_currencies` | List the user's custom currencies (code, name, symbol, decimals, logo) |
> > > > > > > | `create_custom_currency` | Define a custom currency such as points or a token; needs a rate source for base values (`finance:write`) |
> > > > > > > | `update_custom_currency` | Change a custom currency's name, decimals, symbol, or logo; decimals locked while in use (`finance:write`) |
> > > > > > > | `delete_custom_currency` | Delete an unused custom currency and its exchange rates (`finance:delete`) |
> > > > > > > | `search_coingecko_coins` | Find the CoinGecko coinId for a rate source by name or symbol |
> > > > > > > | `get_currency_rate_history` | A custom currency's stored rates, latest first, with the rate in force |
> > > > > > > | `set_currency_rate_source` | Set a currency's rate source (provider, manual, peg, CoinGecko, HTTP); re-values saved rows (`finance:write`) |
> > > > > > > | `test_currency_rate_source` | Preview an HTTP rate source for one day without saving it (`finance:write`) |
> > > > > > > | `set_exchange_rates` | Set the user's own rates for pairs, each with its opposite; custom pairs take a date (`finance:write`) |
> > > > > > > | `delete_exchange_rates` | Remove the user's own rates for pairs, each with its opposite (`finance:delete`) |
> > > > > > > | `get_user_currencies` | Base currency, held currencies with their rate settings, and today's rates to the base |
> > > > > > > | `list_supported_currencies` | Every ISO currency the app supports (code, name, decimals) |
> > > > > > > | `get_exchange_rate` | Rate of a pair on a day, or the global rates of the day |
> > > > > > > | `add_user_currencies` | Add currencies the user holds, with optional flat rate and live-rate flag (`finance:write`) |
> > > > > > > | `update_user_currency` | Change a held currency's flat rate or market-vs-manual rate; re-values balances (`finance:write`) |
> > > > > > > | `delete_user_currency` | Stop holding an unused ISO currency; not the base currency (`finance:delete`) |
> > > > > > > | `change_base_currency` | Set the base currency; a change recalculates history and blocks edits until done (`finance:write`) |
> > > > > > > | `get_base_currency_change_status` | State of the running or last base-currency change |
>>>>>>> theirs
||||||| base
| `adjust_account_balance` | Set an account to a target balance via an adjustment transaction (`finance:write`) |
| `archive_account` | Archive or unarchive an account; handles side effects (`finance:write`) |
| `delete_account` | Permanently delete an account and all its transactions (`finance:delete`) |
| `unlink_account_from_bank_connection` | Disconnect a bank-connected account; it becomes manual and keeps history (`finance:write`) |
| `get_account_groups` | List account groups (nested folders) with parent, path, child groups and accounts |
| `create_account_group` | Create an account group, optionally nested under a parent (`finance:write`) |
| `update_account_group` | Rename an account group or change its parent or logo (`finance:write`) |
| `move_account_group` | Move an account group under another group or to the top level (`finance:write`) |
| `delete_account_group` | Delete an account group; its accounts are kept, only ungrouped (`finance:delete`) |
| `add_account_to_group` | Put an account into a group; an account is in one group at a time (`finance:write`) |
| `remove_accounts_from_group` | Take accounts out of a group (`finance:write`) |
| `get_transaction_groups` | List transaction groups with counts/dates or full embedded transactions; `groupId` reads one group |
| `create_transaction_group` | Bundle related transactions into a group (e.g. split bill) (`finance:write`) |
| `update_transaction_group` | Rename or add a note to an existing group (`finance:write`) |
| `delete_transaction_group` | Delete a group — transactions kept (`finance:delete`) |
| `add_transactions_to_group` | Add transactions to an existing group (`finance:write`) |
| `remove_transactions_from_group` | Remove transactions from a group, optionally dissolving it (`finance:write`) |
| `get_subscriptions` | List subscriptions/bills with frequency, amount, and linked count |
| `get_subscription_by_id` | Single subscription with linked transactions and next payment date |
| `create_subscription` | Create a subscription, bill, or installment — expense by default or income via transactionType (`finance:write`) |
| `update_subscription` | Update subscription fields (`finance:write`) |
| `delete_subscription` | Delete a subscription and its transaction links (`finance:delete`) |
| `toggle_subscription_active` | Activate or deactivate a subscription (`finance:write`) |
| `detect_subscription_candidates` | Scan 12 months of transactions to auto-detect recurring patterns (`finance:write`) |
| `list_subscription_candidates` | List auto-detected candidates sorted by confidence score |
| `dismiss_subscription_candidate` | Dismiss a pending candidate (`finance:write`) |
| `link_transactions_to_subscription` | Mark transactions as payment instances of a subscription (`finance:write`) |
| `unlink_transactions_from_subscription` | Remove transaction links from a subscription (`finance:write`) |
| `get_upcoming_subscription_payments` | Upcoming payments sorted by next expected date |
| `get_subscriptions_summary` | Monthly/yearly cost, expected monthly income, and per-direction active counts in base currency |

> > > > > > > theirs
> > > > > > > | `accept_subscription_candidate` | Accept a detected candidate, optionally linking its samples to a subscription (`finance:write`) |
> > > > > > > | `list_subscription_match_suggestions` | Past transactions a subscription's matching rules would match but that are not linked yet |
> > > > > > > | `get_subscription_periods` | A subscription's billing periods with status and the transaction behind each paid one |
> > > > > > > | `preview_subscription_payment` | What paying a period would book (converted amount, already-recorded payments); changes nothing |
> > > > > > > | `pay_subscription_period` | Mark a period paid by linking a transaction or booking a new one (`finance:write`) |
> > > > > > > | `skip_subscription_period` | Skip a billing cycle without paying it (`finance:write`) |
> > > > > > > | `unlink_subscription_period_transaction` | Detach a period's transaction; the transaction and the paid status stay (`finance:write`) |
> > > > > > > | `revert_subscription_period` | Undo a paid or skipped period; may delete the transaction the app booked (`finance:write` + `finance:delete`) |
> > > > > > > | `get_transaction_automations` | List automation rules with evaluation order, enabled state, match counts, and pause reason |
> > > > > > > | `preview_transaction_automation` | Dry-run automation conditions against recent transactions; nothing is modified |
> > > > > > > | `create_transaction_automation` | Create a rule that sets category, tags, payee, or note on matching transactions (`finance:write`) |
> > > > > > > | `update_transaction_automation` | Change a rule name, conditions, actions, or enabled state (`finance:write`) |
> > > > > > > | `delete_transaction_automation` | Permanently delete an automation rule (`finance:delete`) |
> > > > > > > | `reorder_transaction_automations` | Set the top-to-bottom evaluation order of the automation rules (`finance:write`) |
> > > > > > > | `apply_transaction_automation` | Run a saved rule on up to 500 existing transactions; non-matching ids are skipped (`finance:write`) |
> > > > > > > | `get_transaction_templates` | List transaction templates: named presets for new transactions |
> > > > > > > | `create_transaction_template` | Create a template: type, account, pinned amount, category, payee, tags (`finance:write`) |
> > > > > > > | `update_transaction_template` | Change a template; `null` clears a field, `tagIds` replaces the tags (`finance:write`) |
> > > > > > > | `delete_transaction_template` | Permanently delete a template (`finance:delete`) |
> > > > > > > | `create_transaction` | Create income, expense, or transfer with optional splits/tags/payee/original-currency amount (`finance:write`) |
> > > > > > > | `update_transaction` | Update amount, date, category, payee, tags, note, splits, or original-currency amount (`finance:write`) |
> > > > > > > | `delete_transaction` | Permanently delete a transaction; transfer pairs are deleted together (`finance:delete`) |
> > > > > > > | `create_attachment_upload_url` | Get a short-lived URL to upload receipt files (JPEG/PNG/WebP/PDF) to a transaction over HTTP (`finance:write`) |
> > > > > > > | `bulk_update_transactions` | Update category, payee, note, or tags on multiple transactions at once (`finance:write`) |
> > > > > > > | `split_transaction` | Split a transaction across multiple categories (`finance:write`) |
> > > > > > > | `delete_split` | Delete a single split by split ID (`finance:delete`) |
> > > > > > > | `link_transfer` | Link two existing transactions as a transfer pair (`finance:write`) |
> > > > > > > | `unlink_transfer` | Unlink a transfer pair by transferId (`finance:write`) |
> > > > > > > | `link_refund` | Mark a transaction as a refund of another (`finance:write`) |
> > > > > > > | `unlink_refund` | Remove the refund link between two transactions (`finance:write`) |
> > > > > > > | `get_refunds` | Refund links: of one transaction, one pair, or a paged list; both sides carry their payee |
> > > > > > > | `get_refund_recommendations` | Suggest transactions a refund could link to (saved transaction or form data) |
> > > > > > > | `get_transfer_recommendations` | Suggest the other leg of a transfer (saved transaction or form data) |
> > > > > > > | `list_transfer_suggestions` | Scan a period for likely transfer pairs with a confidence score; reads only |
> > > > > > > | `dismiss_transfer_suggestion` | Dismiss a suggested pair as not a transfer (`finance:write`) |
> > > > > > > | `get_reconciliation_history` | Past duplicate removals and merges, newest first, with the removed rows and survivors |
> > > > > > > | `list_stuck_pending_transactions` | Bank transactions pending over 7 days, each with the booked row that likely replaced it |
> > > > > > > | `remove_duplicate_transactions` | Remove duplicates from the books; restorable, but without their links (`finance:write`) |
> > > > > > > | `restore_removed_transactions` | Bring back removed or merged transactions, without the links they lost (`finance:write`) |
> > > > > > > | `merge_duplicate_transactions` | Merge 2 to 4 duplicates of one account into a survivor that takes their links (`finance:write`) |
> > > > > > > | `keep_pending_as_booked` | Confirm stuck pending bank transactions as booked (`finance:write`) |
> > > > > > > | `assign_tags_to_transaction` | Assign tags to a transaction (`finance:write`) |
> > > > > > > | `remove_tags_from_transaction` | Remove tags from one or more transactions (`finance:write`) |
> > > > > > > | `create_category` | Create a new category, optionally nested (`finance:write`) |
> > > > > > > | `update_category` | Rename, recolor, or change a category's icon (`finance:write`) |
> > > > > > > | `delete_category` | Delete a category; supply replacement for linked transactions (`finance:delete`) |
> > > > > > > | `create_tag` | Create a new transaction tag (`finance:write`) |
> > > > > > > | `update_tag` | Rename, recolor, or update a tag (`finance:write`) |
> > > > > > > | `delete_tag` | Permanently delete a tag and unlink it from all transactions (`finance:delete`) |
> > > > > > > | `get_tag_reminders` | Tag reminders: amount threshold or existence check, scheduled or real-time; filter by tag or reminder |
> > > > > > > | `create_tag_reminder` | Create a tag reminder (amount threshold in the base currency, or existence check) (`finance:write`) |
> > > > > > > | `update_tag_reminder` | Change a reminder; `null` clears the schedule, `isEnabled` pauses it (`finance:write`) |
> > > > > > > | `delete_tag_reminder` | Permanently delete a tag reminder (`finance:delete`) |
> > > > > > > | `get_notifications` | In-app notifications with total and unread count; filter by status or type, or read one by id |
> > > > > > > | `mark_notifications_read` | Mark one notification read, or all if no id; read-only accounts allowed (`finance:write`) |
> > > > > > > | `dismiss_notification` | Dismiss a notification from the list and the unread count (`finance:write`) |
> > > > > > > | `get_user_settings` | App settings: language, notifications, dashboard, layout, saved views, FIRE inputs; no AI part |
> > > > > > > | `update_user_settings` | Patch app settings; arrays replaced whole; `fire` needs the FIRE planner (`finance:write`) |
> > > > > > > | `get_payees` | List payees (merchants) with transaction count, net flow and top category; filter by name |
> > > > > > > | `get_payee` | One payee with its aliases and stats |
> > > > > > > | `create_payee` | Create a payee (`finance:write`) |
> > > > > > > | `update_payee` | Rename a payee or change its default category, mode, default tags, location or logo (`finance:write`) |
> > > > > > > | `delete_payee` | Permanently delete a payee; its transactions stay, unlinked (`finance:delete`) |
> > > > > > > | `merge_payees` | Merge one payee into another; the source is deleted (`finance:delete`) |
> > > > > > > | `set_payees_categorization_mode` | Set the categorization mode of every payee at once (`finance:write`) |
> > > > > > > | `bulk_delete_payees` | Permanently delete up to 2000 payees, optionally ignoring their names later (`finance:delete`) |
> > > > > > > | `get_ignored_payee_names` | Names that are never turned into payees automatically |
> > > > > > > | `ignore_payee_name` | Add a name to the ignored list; `force` also deletes its payee (`finance:write` + `finance:delete` with `force`) |
> > > > > > > | `unignore_payee_name` | Remove a name from the ignored list (`finance:write`) |
> > > > > > > | `apply_payee_tags_to_transactions` | Add a payee's default tags to all its existing transactions; adds only (`finance:write`) |
> > > > > > > | `create_payee_alias` | Add another name that links to a payee (`finance:write`) |
> > > > > > > | `delete_payee_alias` | Delete one alias of a payee (`finance:delete`) |
> > > > > > > | `list_custom_currencies` | List the user's custom currencies (code, name, symbol, decimals, logo) |
> > > > > > > | `create_custom_currency` | Define a custom currency such as points or a token; needs a rate source for base values (`finance:write`) |
> > > > > > > | `update_custom_currency` | Change a custom currency's name, decimals, symbol, or logo; decimals locked while in use (`finance:write`) |
> > > > > > > | `delete_custom_currency` | Delete an unused custom currency and its exchange rates (`finance:delete`) |
> > > > > > > | `search_coingecko_coins` | Find the CoinGecko coinId for a rate source by name or symbol |
> > > > > > > | `get_currency_rate_history` | A custom currency's stored rates, latest first, with the rate in force |
> > > > > > > | `set_currency_rate_source` | Set a currency's rate source (provider, manual, peg, CoinGecko, HTTP); re-values saved rows (`finance:write`) |
> > > > > > > | `test_currency_rate_source` | Preview an HTTP rate source for one day without saving it (`finance:write`) |
> > > > > > > | `set_exchange_rates` | Set the user's own rates for pairs, each with its opposite; custom pairs take a date (`finance:write`) |
> > > > > > > | `delete_exchange_rates` | Remove the user's own rates for pairs, each with its opposite (`finance:delete`) |
> > > > > > > | `get_user_currencies` | Base currency, held currencies with their rate settings, and today's rates to the base |
> > > > > > > | `list_supported_currencies` | Every ISO currency the app supports (code, name, decimals) |
> > > > > > > | `get_exchange_rate` | Rate of a pair on a day, or the global rates of the day |
> > > > > > > | `add_user_currencies` | Add currencies the user holds, with optional flat rate and live-rate flag (`finance:write`) |
> > > > > > > | `update_user_currency` | Change a held currency's flat rate or market-vs-manual rate; re-values balances (`finance:write`) |
> > > > > > > | `delete_user_currency` | Stop holding an unused ISO currency; not the base currency (`finance:delete`) |
> > > > > > > | `change_base_currency` | Set the base currency; a change recalculates history and blocks edits until done (`finance:write`) |
> > > > > > > | `get_base_currency_change_status` | State of the running or last base-currency change |
=======
>>>>>>> theirs

Call `get_user_profile` **first** — it reveals the user's base currency, which
is required to interpret `ref*` fields (refAmount, refBalance) that normalize
multi-currency data.

## Data conventions

- All monetary amounts are decimals (e.g. `42.50` means $42.50), not cents.
- Fields prefixed with `ref` are converted to the user's base currency.
  Use them for cross-account totals when accounts have different currencies.
- Transaction types: `income`, `expense`, `transfer`. Transfers are **not**
  income or expense — exclude them from spend/earn aggregations.
- The two legs of a linked transfer share a `transferId`; `get_transactions` with that
  `transferId` reads both. To find unlinked pairs, `list_transfer_suggestions` scans a
  period and `get_transfer_recommendations` suggests one transaction's other leg;
  `link_transfer` links a pair and `dismiss_transfer_suggestion` rejects a wrong one.
- Duplicate cleanup is reversible. `remove_duplicate_transactions` and
  `merge_duplicate_transactions` soft-delete rows, `get_reconciliation_history` lists
  them and `restore_removed_transactions` brings them back, but a restored row does not
  get back the budget, group and subscription links it lost. Bank rows pending for over
  a week show up in `list_stuck_pending_transactions` with the booked row that likely
  replaced each.
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
  `get_budgets`, `get_budget` and the like read trackers, a limit on a set of
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
- Sharing and bank connections are read-only here. `list_share_invitations`,
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
