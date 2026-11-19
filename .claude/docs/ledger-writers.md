# Ledger Writers

**Read this when** you plan any change that touches transactions, account balances or balance history, before you write the plan. Backend paths are relative to `packages/backend/src/`; layering rules live in [backend-conventions.md](./backend-conventions.md), money handling in rule 6 of the root `CLAUDE.md`.

## Rules the ledger must keep

- Only **real** rows move a balance: `isPlanned = false` and not trashed; **planned** rows count once they flip to real, and **trashed** rows (soft-deleted via `deletedAt`, the model is `paranoid`) count only after a restore.
- A manual account (`type = system`) keeps `currentBalance = initialBalance + Σ signed real rows`, while a bank account (any provider `type`) gets `currentBalance` and its daily history from the bank, never from a sum of our rows.
- `Balances` holds one row per account per day in the user's base currency, and `refInitialBalance`, `refCurrentBalance`, `refAmount` are base-currency mirrors that must move with their native fields.
- **Seam**: when a manual account is linked forward-only, its seam starts at UTC midnight of the link day; rows before it are the user's history, the bank owns everything from it on (`services/accounts/seam.ts`).
- The seam exists only once `seamBalance` (S) is stored on a bank-typed account (a DB CHECK forbids S on `system`); until then the account is fully locked, and after it only manual rows dated before the seam may be edited, trashed or restored, and they must stay before it.
- `initialBalance = seamBalance − Σ signed real rows before the link day` holds once the scheduled rebuild runs; the nightly sweep heals a failed one. A pre-seam change re-derives `initialBalance` and the pre-seam history from S, while S, the bank-owned `currentBalance` and `Balances` rows from the link day on never move.

## Everything that writes transactions, accounts or balance history

**One transaction** (REST and MCP share these services)

- Create: `services/transactions/create-transaction.ts`; picks `accountType` for manual writes and may merge into a matching planned row.
- Update: `services/transactions/update-transaction/update-transaction.ts`; also rewrites the opposite transfer leg (never a bank leg's time or amount: such an edit is refused) and can flip planned/real.
- Delete: `services/transactions/delete-transaction.ts` → `services/transactions/trash/trash-transaction.ts`; soft delete of every leg, `BeforeDestroy` hook runs. Every row delete passes `assertRowDeletableOnAccount` (`services/accounts/seam.ts`) in `deleteTransactionById`, transfer twins and payment legs included.
- Transfer link/unlink: `services/transactions/transactions-linking/{link-transactions,unlink-transfer-transactions}.ts`; changes two existing rows at once.
- Payment legs: `services/transactions/payment-legs/sync-payment-legs.ts`; editing a main row rewrites amount, type and time of its legs on other accounts.

**Bulk**: `services/transactions/bulk-update.ts` (category, note, payee, tags, then re-syncs payment legs); `services/transactions/bulk-delete.ts` (one DB transaction for the whole selection).

**Trash**

- Restore: `services/transactions/trash/restore-trashed.ts`; clears `deletedAt` with hooks off, then calls `Transactions.applyRestoredBalance`. On a seam account a manual row comes back only when it is dated before the seam (a planned one on either side).
- Purge: `services/transactions/trash/delete-trashed.ts`, also run by `crons/transactions-trash-purge.ts`; hard delete with hooks off, outside a request in the cron.

**Imports and undo**

- CSV: `services/import-export/csv-import/execute-import/index.ts`, run by the queue worker `services/import-export/core/queue/create-import-job-queue.ts` outside a request; seam filter `services/import-export/csv-import/drop-rows-from-bank-seam.ts` on top of `services/import-export/core/bank-seam.ts`. Once its batch row exists it re-reads each existing target under the account row lock and fails the job (`bank-link-changed`) when a target's bank link or seam differs from the one its rows were split at, or when the review step's `skippedAfterBankSeam` differs from the worker's.
- Other importers: `services/import-export/{ynab-import,budget-bakers-wallet-import,ms-money-import,ofx-import,statement-parser,investment-transactions-parser}/`; targets via `services/import-export/core/resolve/create-accounts-if-needed.ts` and `services/import-export/core/assert-import-target-not-bank-linked.ts`. OFX, Microsoft Money, Wallet and the statement parser take a seam account like CSV: they drop its rows (and any transfer with a leg on it) dated from the seam on and run the same `bank-link-changed` re-check (`services/import-export/core/bank-seam.ts`).
- Opening-balance absorb: `services/import-export/core/reconcile-account-balances.ts`; folds the import delta into `initialBalance` at finalize.
- Undo: `services/import-export/delete-batch.service.ts` (+ `services/import-export/delete-batch-queue.ts`); bulk-deletes live rows, hard-deletes trashed ones, reverses the absorb; a seam account instead gets its pre-seam history rebuilt inline, inside the undo transaction. A batch holding a row on a seam account dated on or after its seam is refused up front, in `delete-batch.service.ts` (`importExport.batchDeleteBankLinkedAccount`).

**Bank sync** (all outside a request)

- Providers: `services/bank-data-providers/{monobank,enablebanking,lunchflow,simplefin,akahu,walutomat}/*.provider.ts`; insert and update bank rows, several with hooks off; manual period load via `controllers/bank-data-providers/connections/load-transactions-for-period.ts`.
- Shared utils: `services/bank-data-providers/utils/` (`write-bank-balance-with-history.ts` writes balance + today's row, `clamp-sync-start-to-link.ts`, `find-sync-anchor.ts` (newest live row, else newest trashed row, else the seam start; only an account with none of them backfills), `auto-link-transfers.ts`, `merge-account-external-data.ts` raw SQL).
- Workers: `services/bank-data-providers/monobank/transaction-sync-queue.ts` (one job per 31-day chunk; also runs the deferred link absorb) and `services/bank-data-providers/sync/account-sync-queue.ts` (inline providers and the SimpleFIN batch); scheduled by `crons/bank-accounts-sync.ts`.
- Sync vs unlink: no row lock is held across bank network I/O. Every sync fetches first, then writes under `lockLinkedBankAccount` (`services/accounts/lock-account-row.ts`), which re-checks that the account is still linked to the syncing connection: inline providers after `work()` in `runSyncWithStatus` (`base-provider.ts`; a failed check rolls back the whole sync and raises `AccountUnlinkedDuringSyncError`, logged at info with the account marked COMPLETED), the Monobank worker per chunk, SimpleFIN per account. Unlink takes the same row lock, so bank rows never land on an unlinked account; a skipped Monobank chunk marks the account COMPLETED and leaves the connection's `lastSyncAt` alone.

**Reconciliation**: `services/transactions/reconciliation/{merge,remove,restore}-transactions.ts` (hooks off via `helpers.ts`, bank rows only; each schedules one rebuild per account via `scheduleRevalueOfAccounts`); `services/transactions/reconciliation/{stuck-pending,match-stuck-pending}.ts`; `crons/stuck-pending-check.ts` only notifies.

**Planned rows**: flipped by update-transaction and `services/transactions/planned-matching/merge-into-planned.ts`; the model hook applies or withdraws the amount on the flip.

**Subscriptions**: `services/subscriptions/{mark-period-paid,revert-period,settle-period-on-match,process-auto-record}.ts` create, flip or unlink rows; auto-record runs from `crons/subscription-auto-record.ts`, outside a request.

**Account-level**

- Edit, delete: `services/accounts.service.ts` (`updateAccount` moves `initialBalance` on a `currentBalance` edit); guard `services/accounts/assert-account-update-allowed.ts`.
- Balance adjustment: `services/accounts/balance-adjustment.ts` (creates a real row); `services/accounts/absorb-balance-adjustment.ts` moves `initialBalance` instead.
- Archive, disconnect: `services/accounts/archive-account.ts`, `services/bank-data-providers/connection/disconnect-provider.ts`; both run unlink on each linked account.
- Link forward-only: `services/accounts/link-to-bank-connection.ts` → `services/accounts/absorb-link-residual.ts` + `stampSeamBalance`; queued providers defer both via `pendingAbsorb`, which `runPendingLinkAbsorb` runs after the sync (Monobank worker, `runSyncWithStatus` in `services/bank-data-providers/base-provider.ts`, SimpleFIN batch sync, unlink) only while the account is still bank-linked. The inline link and the queued absorb share `absorbLinkResidualWithRateFallback`: without a rate for the base-currency restamp it moves only the native opening balance, even when the link asked for an adjustment row, and logs `LINK_ABSORB_RATE_FALLBACK` with `requestedResidualTarget`; the queued one still stamps S and clears the marker. Any other error propagates to the caller's transaction.
- Unlink: `services/accounts/unlink-from-bank-connection.ts`; locks the account (FOR NO KEY UPDATE), settles a still-pending link absorb through `runPendingLinkAbsorb` (which stamps S), rebuilds the history before the link day once more (restamping `refInitialBalance` when that rebuild has no rate) and drops any stored S before the retype (`clearSeam` in `services/balances/revalue-balance-history.service.ts`), retypes rows to `system` with hooks off, keeps `externalData.bankConnection.linkedAt`.
- Connect and relink: `services/bank-data-providers/connection/connect-selected-accounts.ts`; reuses a matching account and retypes rows via `services/accounts/restore-relinked-transactions-account-type.ts`. Every relink requires the provider balance and starts a new forward-only link day: fresh `linkedAt` and `pendingAbsorb`, the bank balance written inline, and S stamped by the absorb after the sync, never carried from the previous link. A relink (or link) whose provider could not report the balance is refused rather than anchored on a guess.
- Import guard: link, unlink (so archive and disconnect too) and the connect-flow relink throw `LockedError` while the user has any unfinished import batch: no `finishedAt` and younger than the 3h `unfinishedImportCutoff()` (`services/import-export/core/unfinished-import.ts`, shared with import undo), so a crashed import blocks them for up to 3h. Each takes the account row lock before that check, the lock the CSV import's re-check waits on.
- Sharing: `services/sharing/auth/authorize-account-write.service.ts` (who may write); `services/sharing/household/convert-cross-user-transfers.service.ts` (hooks off).

**Balance pipeline**

- Hooks: `models/transactions.model.ts` (`AfterCreate`, `AfterUpdate` incl. planned flips, `BeforeDestroy`, `isBalanceOwnedBySeam`) → `services/accounts/update-balance-for-changed-tx.ts` and `models/balances.model.ts`; a bank row dated before the link day schedules the pre-seam rebuild too, with no seam-crossing error. A manual row (`accountType: system`, importers included) entering the ledger from the seam on, by create, restore or the planned→real flip, is refused (`refuseOnOrAfterSeam`).
- Rebuild: `services/balances/revalue-balance-history.service.ts`; deferred to a batch scope opened in `controllers/helpers/controller-factory.ts`, `routes/mcp.route.ts` and some workers, inline elsewhere and once the scope has drained. The scope also memoises each account's seam attributes (`findSeamAccount`); `stampSeamBalance` and `clearSeam` drop the entry.
- Nightly sweep: `crons/balance-revalue-sweep.ts`; rebuilds foreign-currency accounts and every bank account holding S (`getSeam` decides), no request context.
- Rates and mirrors: `crons/exchange-rates/index.ts` and `services/user-exchange-rate/{update,remove}-exchange-rates.service.ts` → `services/accounts/{remeasure-ref-balances,restamp-ref-initial-balance}.ts`, `services/user-exchange-rate/revalue-accounts-in-currencies.ts`.
- Base-currency change: `services/currencies/change-base-currency.service.ts` via `services/currencies/base-currency-change-queue.ts`; hooks off plus raw SQL on `Balances`.
- Loans: `services/loans/recompute-loan-balance.service.ts` is the only writer of a loan account's history.

**Other entry points**

- MCP: `services/mcp/tools/`; each tool calls the services above, inside the batch scope of `routes/mcp.route.ts`.
- Automations `services/transaction-automations/` and extract-message `services/document-extraction/extract-message.service.ts`; no balance fields, saves go through create/update.
- Investments: `services/investments/portfolios/transfers/`, `services/investments/portfolios/purge-deleted.service.ts` (`crons/purge-deleted-portfolios.ts`); loans `services/loans/{link-loan-payments,unlink-loan-payment}.service.ts`.
- Backup restore and demo: `services/backup/restore/restore-backup.service.ts` (+ `services/backup/restore/{bulk-insert,restore-queue}.ts`) and `services/demo/apply-demo-template.service.ts` insert verbatim or by raw SQL, no hooks; `services/user/wipe-user-data.service.ts` deletes everything.

**Writes that bypass model hooks**: grep `hooks: false`, `updateTransactions` / `destroyTransactions` (`models/transactions-query/index.ts`), static `Model.update` / `.destroy` / `bulkCreate` without `individualHooks: true`, and `sequelize.query` with `UPDATE`/`INSERT`/`DELETE` on `Transactions`, `Accounts` or `Balances`.

## Account states to walk through

- Manual; linked from the provider; manual linked forward-only before its first sync finishes (`pendingAbsorb`, no S); linked with a seam; unlinked but still carrying `externalData.bankConnection`; relinked; archived; foreign currency without a rate; shared.
- An action started in one state and finished in another: an import, sync or queued job running across a link or unlink, a row trashed in one state and restored in another.

## Before you call it done

- Did you check every writer group above, including the hook-bypassing ones?
- Which rows count in your sums, and do trashed and planned rows behave on restore and flip?
- What happens in a queue worker or cron, with no request, user or batch scope?
- Is there an e2e test through HTTP for each writer group you touched?
- Do the UI lock (`packages/frontend/src/common/utils/bank-row-permissions.ts`) and the API lock agree?
