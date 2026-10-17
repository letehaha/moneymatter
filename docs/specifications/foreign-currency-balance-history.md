# Foreign-Currency Balance History

How the app stores daily balance snapshots for accounts held in a currency other than the user's base currency.

> **TL;DR**
> For an account whose currency differs from the owner's **base currency** (their main display currency), each row in the `Balances` table equals _account balance at that day × that day's exchange rate_. A dedicated service, `revalueBalanceHistory`, recomputes an account's whole history from scratch. Every write path that can change account's balance schedules it, and a nightly cron re-runs it for every eligible account, so any missed write path or calculation shifts are healed.

Terms used throughout: **`Balances`** table holds one row per account per day, amount in the owner's base currency. **`refAmount`** is a transaction's amount converted to the base currency at the rate of the transaction's own day. **Native units** are amounts in the account's own currency.

## 1. The Problem This Solves

Firstly, let's take a look how it was handled previously (in a wrong way).

Daily `Balances` rows used to be built by summing each transaction's `refAmount` to calculate next days values. Each conversion held the rate of the transaction's own day, so calculated values kept the value of the latest calculated tx date.

If at some point user had a big gap between two transactions in the account, the next transaction write calculated **`Balances`** row based on the new exchange rate, but the gap between two transactions (for example 1 year) wasn't fulfilled with exchange depreciation values. So if exchange rate depreciated a lot during 1 year, the new 5 euro transaction can cause a huge drop in account's "valuation".

Example: An account with EUR as base currency holds a GBP fixed-deposit. A 50,000 GBP deposit from two years ago sits in storage at that day's value – 60,000 EUR – and carries forward unchanged while the pound loses 20% against the euro over the same stretch. Today's balance, computed as pounds held × today's rate, comes out to 48,000 EUR. The 12,000 EUR gap between the two lands on the chart as a one-day loss labeled "No significant transactions for this date" – no transaction records this "loss" and no rows in **`Balances`** table do it either – it just magically "dropped" in valuation for "no reason" from the user's perspective.

The same setup produces a second symptom: an account holding **zero pounds**, all deposits withdrawn, shows a stored balance of **12,000 EUR**. That number is the deposit converted at the old rate minus the same amount converted at the new rate. The correct stored value is 0.

### The new logic

For every eligible account, the stored balance for day D equals the native units the account held on day D multiplied by the base-currency rate for day D. Currency movement spreads across the whole history as a slope, and stored history joins today's spot value continuously.

Transaction `refAmount` values keep their per-day historical rates. Income and expense statistics report spend over a period, and converting each expense at the rate of its own day is the correct input for that. **The new logic** changes the fact that now eligible
accounts are all getting daily snapshots, instead of relying on summing `refAmount`s
after each write events. Each time transactions/accounts getting a write event – the
`revalueBalanceHistory` gets scheduled to reevaluate **`Balances`** table based on the
new values.

## 2. Scope: Which Accounts Get Revalued at transaction change action

`isRevaluedAccount({ account, baseCurrencyCode })` is the single predicate, exported so
callers can select the incremental path without calling the rebuild first. It returns
true when all three hold:

- `account.type === 'system'` (a manual account the user types into).
- The account category is not a dedicated-flow category (`loan`, `vehicle`, `property`), which own their balance rows through their own projection logic.
- `account.currencyCode !== baseCurrencyCode`.

Everything else keeps the incremental cascade that patches later days with the transaction's `refAmount`. Bank-synced accounts (`monobank`, `enable-banking`, `walutomat`) are excluded. Same-currency accounts are excluded because their rate is 1, so the stored conversion equals the live one on every day.

## 3. Batching: One Rebuild Per Account

A 1,000-row CSV or YNAB import touches one account a thousand times, and each touch
schedules a rebuild. Batching collapses those into one full-history rebuild.

`runWithBalanceRevalueBatch(fn)` opens an `AsyncLocalStorage` scope holding a `Set`
of account IDs. Inside that scope, `scheduleBalanceRevalue({ accountId })` adds to
the set and returns. The deduped rebuilds run once each after `fn` settles. They
also run when `fn` throws, because the rows that already committed still need
revaluing, and the original error is rethrown afterwards. A failed rebuild is
logged under `BALANCE_REVALUE_BATCH_FAILED` and left to the nightly sweep, and
the request still returns its result. Nested scopes merge into the outermost one.

Outside a scope, `scheduleBalanceRevalue` runs the rebuild inline, joining the ambient CLS transaction so the rebuild commits together with the change that triggered it.

Scopes are opened at entrypoints:

- Every HTTP request, through `createController` in the controller factory.
- Cron job bodies (`subscription-auto-record`).
- Queue job bodies (import jobs, monobank transaction sync).

## 4. The Rebuild: `revalueBalanceHistory`

`revalueBalanceHistory({ accountId })` is the whole feature in one call. It returns
`'rebuilt'` or `'skipped'`, and `'skipped'` means it decided not to touch a single row –
the account is gone, has no base currency, fails `isRevaluedAccount`, or has no usable
rate (section 5).

Every run recomputes the account's **full** history, never a slice of it. That is what
makes it idempotent: running it twice in a row produces the same rows, and a run always
overwrites whatever an earlier run wrote. So a caller never has to reason about what
already happened – it just schedules a rebuild and the account ends up correct.

**Day buckets.** Every day is a UTC bucket. The SQL truncates transaction times at UTC,
the day walk steps UTC midnights, and `Balances.date` is a `YYYY-MM-DD` string. No
timezone drift creeps in between the three.

**Grid bounds.** The grid starts at the earliest of: today, the day before the account's
first transaction, and the account's oldest stored `Balances` row. The day before the
first transaction is where `initialBalance` lives, so the series starts from the money
the account actually opened with instead of from zero. The oldest stored row is included
so that rows an earlier (wrong) run wrote are inside the range and get replaced rather
than left behind. The grid ends at today, or at the last transaction's day when that one
is later – a backdated-into-the-future transaction still gets valued.

**The walk.** The rebuild loads per-day signed native deltas straight from
`real_transactions` (income counts positive, everything else negative), seeds the running
total with the account's `initialBalance`, then steps day by day: add that day's delta,
look up that day's rate, and store `roundHalfToEven(native units × rate)`. Nothing here
reads `refAmount` – the native amount is the source of truth and the rate is picked per
day, which is exactly what the old cascade could not do.

**Sparse output.** The read path forward-fills gaps, so a day whose value repeats the
previous day carries no information and is dropped. Two days always survive that filter:
the first day of the grid and today. Today's row is what makes the chart move with the
exchange rate on days the user made no transactions at all.

**Writes.** The rebuild deletes every row in its range and then inserts what it computed.
The delete matters: a day the rebuild no longer emits must not survive, because the
forward fill would read that leftover row as a real measurement and bend the chart around
it. The insert still uses `ON CONFLICT ... DO UPDATE` on top of that, because the 18:00
UTC remeasure can pin today's row in the window between the delete and the insert.

**Concurrency.** The rebuild takes a per-account advisory lock
(`pg_advisory_xact_lock`) held for its transaction. Two rebuilds of the same account
would otherwise interleave their writes and leave a grid mixing rows from two different
runs.

## 5. Rate Resolution

A flat user-defined rate wins for every day of the grid when one exists. `resolveCustomRate`
hands one back only when the user turned `liveRateUpdate` **off** for that currency in
`UsersCurrencies` **and** the target is their base currency – anything else returns `null`.
With a flat rate in hand the rebuild skips the market lookup entirely, so the whole history
gets re-priced at that single number.

Otherwise `buildDailyPairRateResolver` builds a per-day lookup from the `ExchangeRates`
table, which stores USD-pivot rows. The daily rate for a pair is derived by pivoting both
currencies through USD: the exact day's row, else the most recent earlier row, else the
earliest row known for that currency. That last fallback is what covers days older than
the app's rate coverage – any rate beats no rate there. Rates are truncated to 5 decimals
by `formatRate`, the same truncation `getExchangeRate` applies, so a rebuilt row matches
what every other conversion in the app produces for that day. A rate that truncates to 0
counts as missing, because multiplying by it would write a perfectly valid-looking history
of zero balances.

**Failure mode.** When the pair has no stored rate on either leg, or when some day inside
the grid resolves to no rate, the rebuild logs a warning, returns `'skipped'`, and touches
no row. The existing rows stay exactly as they are – a partially-valued history is worse
than a stale one – and the nightly sweep retries the account once the rates arrive.

## 6. Write Paths That Trigger a Rebuild

| Path                                                                  | Where                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transaction create, edit, delete                                      | `Balances.handleTransactionChange` (`models/balances.model.ts`). For a revalued account it calls `scheduleBalanceRevalue` in place of the incremental cascade and today's spot re-pin. A moved transaction schedules both the old and the new account.                       |
| Account edit (opening balance, currency)                              | `updateAccount` in `services/accounts.service.ts`. Each stored day has to be re-priced at its own rate, so `handleAccountChange` and `setTodayRowToSpot` are bypassed and the rebuild owns the history.                                                                      |
| Balance adjustment absorption                                         | `absorbBalanceAdjustment` in `services/accounts/absorb-balance-adjustment.ts`, same branch.                                                                                                                                                                                  |
| User exchange-rate update or removal, and the `liveRateUpdate` toggle | `update-exchange-rates.service.ts`, `remove-exchange-rates.service.ts` and `user.service.ts`, all through `revalueAccountsInCurrencies`, which fans out to every eligible account of that user held in the affected currencies.                                              |
| Base-currency change                                                  | `change-base-currency.service.ts` converts the other accounts row by row, but collects revalued account IDs and calls `revalueBalanceHistory` for them after its own transaction commits. Converting their rows one by one would only re-derive a blend of historical rates. |
| MCP tool calls                                                        | `routes/mcp.route.ts` wraps `transport.handleRequest` in `runWithBalanceRevalueBatch`, so a tool's writes get their queued rebuilds after the tool finishes rather than inline from inside a model hook.                                                                     |

## 7. Nightly Sweep

The sweep (`crons/balance-revalue-sweep.ts`) runs at **18:45 UTC**, after the 18:00 UTC
rate fetch has stored today's rates. Running it earlier would value today's row at
yesterday's rate, which is precisely the bug this whole document is about.

It selects **every** candidate account – category not in the dedicated-flow list, currency
different from the owner's default currency – regardless of type, and then splits by type:

- A `system` account gets the full `revalueBalanceHistory` rebuild.
- A bank-synced account gets only **today's** row rewritten, via `writeBankBalanceWithHistory`,
  as its last-known native balance × today's rate. The provider owns that account's history
  and the sweep never rebuilds it.

That second branch exists for the user's sake. A foreign-currency bank account that has not
synced for a while would otherwise sit flat at the rate of its last sync, and then jump the
whole accumulated currency move in one day when the next sync lands – the same cliff, just
sourced from the provider instead of from a transaction.

Accounts are processed **sequentially**. Rebuilding every foreign-currency account at once
floods the database connection pool. The job holds a distributed lock with a 4-hour TTL,
which comfortably exceeds a full sweep, so a second instance stays blocked instead of
starting on top of a running one.

A skipped account counts as a **failed** update in the job's report, with the reason
recorded as missing exchange-rate coverage. A skip is not a success – it means an account
still holds rows nobody has verified.

No one-time data migration shipped with this feature, and none is needed. The rebuild
covers full history and the sweep covers every candidate, so the first nightly run after
deploy rewrites every stored row on its own. An account the user touches before that gets
rewritten even sooner, by its write path.

## 8. Where the Data Surfaces

`GET /stats/combined-balance-history` reads the `Balances` rows, aggregates them across
accounts, and forward-fills days without rows. It feeds the dashboard's Balance Trend and
Net Worth widgets. The app has no per-account balance chart, so this aggregate is the only
place these rows reach the UI.

## 9. Deliberately Out of Scope

- Per-transaction conversion amounts. `refAmount` stays at its historical rate.
- Loan balance projection and vehicle depreciation, which own their own rows.
- Demo-data seeding, which builds balances itself. The nightly sweep rewrites its foreign-currency history anyway, which is acceptable for demo accounts.
- Bank-synced account **history**. Providers own it, and the sweep only re-pins today's row.
- Labeling the currency-revaluation share of a day's change in the chart's spike panel. Considered and dropped.
