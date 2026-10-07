# Bank Data Providers - Architecture Overview

## System Purpose

The bank-data-providers system is a modular framework for connecting users' bank accounts and syncing financial data. It supports multiple providers (Monobank, Enable Banking, LunchFlow) through a unified interface using the Provider Pattern and Registry Pattern.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                           API ROUTES                            │
│                    (bank-data-providers.route.ts)               │
└────┬────────────────────────────────────────────────────────────┘
     │
     ├─ POST /:providerType/connect
     ├─ GET/DELETE /connections/:connectionId
     ├─ GET /connections/:connectionId/available-accounts
     ├─ POST /connections/:connectionId/sync-selected-accounts
     ├─ POST /connections/:connectionId/sync-transactions
     ├─ POST /sync/trigger
     ├─ GET /sync/status
     └─ POST /enablebanking/oauth-callback
     │
┌────▼────────────────────────────────────────────────────────────┐
│                      CONTROLLERS LAYER                          │
│          (src/controllers/bank-data-providers/)                 │
└────┬────────────────────────────────────────────────────────────┘
     │
┌────▼────────────────────────────────────────────────────────────┐
│                       SERVICES LAYER                            │
│        (src/services/bank-data-providers/)                      │
│                                                                 │
│  ┌─ CONNECTION SERVICES ────┐  ┌─ SYNC SERVICES ─────────────┐ │
│  │ connect-provider         │  │ sync-manager                │ │
│  │ list-external-accounts   │  │ sync-status-tracker (Redis) │ │
│  │ connect-selected-accounts│  │ account-prioritizer         │ │
│  │ disconnect-provider      │  └─────────────────────────────┘ │
│  │ sync-transactions        │                                  │
│  └──────────────────────────┘                                  │
│                                                                 │
│  ┌─ PROVIDER INTERFACE ─────────────────────────────────────┐  │
│  │ IBankDataProvider (types.ts)                             │  │
│  │ BaseBankDataProvider (abstract base class)               │  │
│  │ BankProviderRegistry (singleton)                         │  │
│  └──────────────────────────────────────────────────────────┘  │
└────┬────────────────────────────────────────────────────────────┘
     │
     ├─────────────────────────────┬──────────────────────────────┐
     ▼                             ▼                              │
┌────────────────────┐  ┌─────────────────────────┐  ┌──────────────────┐
│  MONOBANK PROVIDER │  │  ENABLE BANKING PROVIDER│  │ LUNCHFLOW PROVIDER│
│                    │  │                         │  │                  │
│ • Simple API token │  │ • OAuth2 + JWT flow     │  │ • API key auth   │
│ • BullMQ queue     │  │ • Direct sync           │  │ • Direct sync    │
│ • 60s rate limit   │  │ • Consent tracking      │  │ • No date filter │
└────────────────────┘  └─────────────────────────┘  └──────────────────┘
```

## Core Concepts

### Provider Registry (Singleton)

All providers register at app startup via `initializeBankProviders()`. Services look up providers dynamically:

```typescript
const provider = bankProviderRegistry.get(BANK_PROVIDER_TYPE.MONOBANK);
await provider.fetchAccounts(connectionId);
```

### Database Models

| Model                         | Purpose                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| `BankDataProviderConnections` | Stores connection metadata, encrypted credentials, consent info |
| `Accounts`                    | User accounts linked via `bankDataProviderConnectionId`         |
| `Transactions`                | Transactions with `originalId` for deduplication                |

### Sync Status (Redis)

```
account:{accountId}:sync-status → { status, startedAt, completedAt, error }

States: IDLE → QUEUED → SYNCING → COMPLETED
                  ↓
               FAILED
```

---

## Flow 1: Connection

### Monobank (Simple Token)

```
User provides API token
       ↓
POST /monobank/connect
       ↓
MonobankProvider.connect()
  • Validate token via API call
  • Encrypt and store credentials
  • Return connectionId
       ↓
Connection immediately ACTIVE
```

### Enable Banking (OAuth2)

```
User provides: appId, privateKey, bankName, bankCountry
       ↓
POST /enablebanking/connect
       ↓
EnableBankingProvider.connect()
  • Validate private key format
  • Generate OAuth state (CSRF protection)
  • Call startAuthorization() → returns auth URL
  • Store pending connection (isActive = false)
  • Return connectionId
       ↓
Frontend redirects user to auth URL
       ↓
User authorizes at bank
       ↓
POST /enablebanking/oauth-callback
       ↓
EnableBankingProvider.handleOAuthCallback()
  • Validate state parameter
  • Exchange code for session
  • Store sessionId in credentials
  • Set isActive = true
       ↓
Connection now ACTIVE
```

### LunchFlow (API Key)

```
User provides API key
       ↓
POST /lunchflow/connect
       ↓
LunchFlowProvider.connect()
  • Validate API key via test connection
  • Encrypt and store credentials
  • Return connectionId
       ↓
Connection immediately ACTIVE
```

---

## Flow 2: Account Selection & Creation

This is a **two-stage process**:

### Stage 1: List Available Accounts

```
GET /connections/{connectionId}/available-accounts
       ↓
listExternalAccounts() service
       ↓
provider.fetchAccounts(connectionId)
       ↓
Returns account list (NOT saved to DB)
       ↓
Frontend displays for user selection
```

### Stage 2: Connect Selected Accounts

```
POST /connections/{connectionId}/sync-selected-accounts
Body: { accountExternalIds: ["acc1", "acc2"] }
       ↓
connectSelectedAccounts() service
       ↓
For each selected account:
  • Check if exists (by externalId + connectionId)
  • If exists: re-enable (isEnabled = true)
  • If new: create Accounts record with:
    - Proper ref amounts (calculateRefAmount)
    - Link to connection
    - Balance, currency, metadata
       ↓
Enqueue the initial transaction sync on the `account-sync` queue
       ↓
Return created accounts (sync still running in the background)
```

**Key file:** `connection/connect-selected-accounts.ts`

This is where accounts are actually created with proper `refInitialBalance` and `refCurrentBalance` calculations.

The response returns as soon as account creation commits — a first backfill can run for minutes. Clients poll `GET /sync/status` for per-account progress.

---

## Flow 3: Transaction Sync

### Monobank: Queue-Based (BullMQ)

```
syncTransactionsForAccount()
       ↓
MonobankProvider.syncTransactions()
       ↓
Set status = QUEUED
       ↓
Calculate 31-day batches (rate limit constraint)
       ↓
Queue jobs via BullMQ (1 job per batch)
       ↓
Return immediately: { jobGroupId, totalBatches }
       ↓
BACKGROUND (BullMQ Worker):
  For each batch:
    • Fetch transactions from API
    • Check duplicates by originalId
    • Create Transaction records
    • Update account balance
  When done: status = COMPLETED
```

**Why queue-based?**

- Monobank has 1 request per 60 seconds rate limit
- Historical sync can need 10+ requests
- Can't block HTTP response for 10+ minutes

### Enable Banking: Direct Sync

```
syncTransactionsForAccount()
       ↓
EnableBankingProvider.syncTransactions()
       ↓
Set status = SYNCING
       ↓
Fetch all transactions (paginated on continuation_key until the ASPSP
stops returning one; an incremental sync starts at the latest stored
transaction, the oldest payment still pending on the previous sync, or
the oldest stored pending row from the last 14 days, whichever is
earliest; an initial sync also negotiates the lookback window
by retrying 1095 → 730 → 365 → 90 days on date-range rejections)
       ↓
Drop PDNG/HOLD payloads unless the user setting
`importPendingBankTransactions` is on (off by default)
       ↓
Sort by date ascending, pre-booking (PDNG/HOLD) before BOOK within the
same date so a same-batch booked copy finds its pending row already stored
       ↓
For each transaction:
  • Generate deterministic externalId (SHA256 hash)
  • Match against existing rows with the four-tier matcher (see below)
  • CNCL/RJCT → delete the matched pre-booking row (kept when it has
    dependent rows); never creates one. SCHD never reaches this loop
  • Matched, stored booked + incoming pre-booking → no writes (stale re-send)
  • Matched → re-anchor originalId, merge externalData (pendingHash +
    merchantName backfill), flip pre-booking → BOOK, re-stamp time when the
    flip changed it, refresh the note while it is still sync-generated;
    on that flip the booked payload's direction overwrites the row's type
  • Unmatched → create Transaction record
       ↓
Update account balance
       ↓
Set status = COMPLETED
```

**Four-tier match** (`findExistingTransactionForSync`), strongest evidence first:

1. **entry_reference** — the ASPSP promises it is unique and immutable per account
2. **originalId** — the stored hash; the steady state when the bank returns stable fields. It also matches `externalData.pendingHash`, the hash a row carried during its pending life, so a `PDNG` payload the ASPSP re-sends after booking resolves back onto the booked row instead of creating a duplicate
3. **IBAN fingerprint** — same amount/currency/type within ±2 days, same counterparty IBAN, and only against rows that carry no stored entry_reference
4. **Pending upgrade** — a booked payload adopts a stored `PDNG`/`HOLD` row with the same amount/currency/type dated up to 14 days before the booked payload or 2 days after it (transfers can sit pending well over a week; a pending copy never trails its booking by more than date drift). The IBAN gate is conditional: when the incoming booked payload carries a counterparty IBAN, candidates carrying the same one win, IBAN-less candidates dated within 5 days are the fallback (ASPSPs often omit the counterparty on the pending payload and fill it at booking; the short window keeps an unrelated same-amount card reservation from being taken as the transfer's pending copy), and a candidate with a different IBAN is never matched; when the payload carries none — the card-purchase case — no IBAN filtering happens. The candidate pool excludes rows with a `transferId` or `refundLinked`, and rows with an entry_reference unless the incoming payload carries one too. The whole tier is skipped when a single pre-sync count says the account holds no pre-booking rows at all; that pre-check re-arms mid-run as soon as this run stores one. When no same-type row qualifies, the same pool is searched with the opposite type, since some ASPSPs flag a pending payment with the wrong direction; such a row is adopted only when it is dated within ±2 days of the booked payload and its raw payload names the same counterparty account on the same creditor/debtor side as the booked payload (own account ids ignored), which keeps a purchase and its refund apart

Tier 3 runs before tier 4 because IBAN equality is the stronger signal — an incoming transfer lands on a row sharing its IBAN before tier 4 falls back to an IBAN-less pending.

**Why direct?**

- Enable Banking has generous rate limits
- Pagination runs inside one sync call and finishes fast
- Completes within HTTP timeout

### LunchFlow: Direct Sync (Post-Fetch Filtering)

```
syncTransactionsForAccount()
       ↓
LunchFlowProvider.syncTransactions()
       ↓
Set status = SYNCING
       ↓
Fetch ALL transactions (API has no date-range support)
       ↓
Filter out pending transactions (null IDs)
       ↓
Post-fetch date filtering:
  • Find latest existing transaction date in DB
  • Discard API transactions older than that date
       ↓
For each remaining transaction:
  • Primary dedup: check by originalId
  • Secondary dedup: check externalData.originalSource.originalId
  • Create Transaction record
       ↓
Update account balance
       ↓
Set status = COMPLETED
```

**Why post-fetch filtering?**

- LunchFlow API does NOT support date-range query parameters
- Without filtering, every sync re-processes all historical transactions
- Post-fetch filtering avoids duplicates when manual transactions exist (see Flow 6)

---

## Flow 4: Auto-Sync

```
POST /sync/trigger (or scheduled trigger)
       ↓
syncAllUserAccounts()
       ↓
Fetch all user's bank-connected accounts, grouped by connection
       ↓
enqueueAccountSync() per connection: accounts set to QUEUED, jobs added
       ↓
`account-sync` BullMQ worker (concurrency 5) picks jobs up
       ↓
Frontend polls GET /sync/status for progress
```

One job per account, except batch-capable providers (SimpleFIN), which get one
job per connection so a single windowed fetch covers every account. Monobank's
job fans out into its own rate-limited queue. Job ids are deterministic
(`account-sync-<accountId>` / `account-sync-<connectionId>`), so re-triggering a
sync that is still queued or running is a no-op.

**Key file:** `sync/account-sync-queue.ts`

---

## Flow 5: Disconnect Provider

**CRITICAL**: Disconnecting a provider MUST reset all linked accounts to `system` type. Without this, accounts retain their provider-specific type (e.g. `lunchflow`) and cannot be relinked because the UI only shows the "Link" button for `system`-type accounts.

### With `removeAssociatedAccounts=false` (default)

```
DELETE /connections/{connectionId}?removeAssociatedAccounts=false
       ↓
disconnectProvider() service
       ↓
For each linked account:
  unlinkAccountFromBankConnection()
    • Account type → system
    • bankDataProviderConnectionId → null
    • externalId → null
    • Store connection history in externalData
    • All transactions: accountType → system
    • originalId → null, preserved in externalData.originalSource (for
      relink dedup). File-imported rows (externalData.importDetails) keep
      their originalId and get no snapshot
       ↓
provider.disconnect(connectionId)
  • Provider-specific cleanup (e.g. revoke OAuth session)
  • Delete BankDataProviderConnections record
```

### With `removeAssociatedAccounts=true`

```
DELETE /connections/{connectionId}?removeAssociatedAccounts=true
       ↓
Permanently delete all linked accounts (and their transactions via CASCADE)
       ↓
provider.disconnect(connectionId)
```

### Reconnecting after a disconnect

A fresh connection that selects the same external account goes through `connectSelectedAccounts()`, not `linkAccountToBankConnection()`. It finds the unlinked account by `externalData.connectionHistory.previousConnection` (`providerType` + `externalId`), sets its type back to the provider type, and types its formerly synced transactions as provider rows with the same `restoreRelinkedTransactionsAccountType()` call the account-level relink uses (see Flow 6).

**Key file:** `connection/disconnect-provider.ts`, `connection/connect-selected-accounts.ts`, `accounts/unlink-from-bank-connection.ts`, `accounts/restore-relinked-transactions-account-type.ts`

---

## Flow 6: Unlink → Manual Edits → Relink (Account-Level)

This is the per-account unlink/relink flow (distinct from full provider disconnect).

```
1. User unlinks a single account (POST /accounts/{id}/unlink)
       ↓
   unlinkAccountFromBankConnection()
     • Account type → system
     • externalId → null, bankDataProviderConnectionId → null
     • Store connection history in externalData.connectionHistory
     • Transactions: accountType → system
     • originalId → null, preserved in externalData.originalSource.
       File-imported rows (externalData.importDetails) keep their originalId
       (OFX duplicate detection keys on it) and get no snapshot
       ↓
2. User may add manual transactions while account is unlinked
       ↓
3. User relinks account (POST /accounts/{id}/link)
       ↓
   linkAccountToBankConnection()
     • Account type → provider type (e.g. lunchflow)
     • Set externalId and bankDataProviderConnectionId
     • Transactions whose originalSource.importedFrom is this provider:
       accountType → provider type (soft-deleted rows included, planned
       rows excluded, hooks off).
       Manual and file-imported rows stay system; so do rows synced by a
       different provider. originalId stays null until a sync with the
       originalSource dedup re-anchors it (every provider except Monobank)
       ↓
4. Transaction sync runs
       ↓
   Two-tier deduplication prevents duplicates (LunchFlow, SimpleFIN, Walutomat):
     Primary: check by originalId (fast path)
     Secondary: check externalData.originalSource.originalId (covers unlink→relink)
     Enable Banking folds the originalSource check into tier 2 of its
     four-tier matcher (see Flow 3)
       ↓
   Date-based filtering (all providers):
     Find latest existing transaction date → skip older API transactions
     This ensures manual transactions added during unlink period are preserved
     and only truly new bank transactions are imported
     Note: Monobank/Enable Banking filter via API params; LunchFlow filters post-fetch
```

### Why Two-Tier Dedup?

When an account is unlinked, `originalId` is set to `null` on every transaction except file-imported ones. The original value is preserved in `externalData.originalSource.originalId`. On relink + sync (LunchFlow, SimpleFIN, Walutomat):

1. **Primary dedup** (by `originalId`) won't match — the field is null
2. **Secondary dedup** checks `externalData.originalSource.originalId` via JSONB query
3. If found, restores `originalId` so future syncs use the fast primary path

### Why Relink Restores the Row Type

`Transactions.accountType` is a per-row snapshot, separate from `Accounts.type`, and it drives the balance hooks and the reconciliation guards. A formerly synced row left as `system` on a bank-typed account is hidden from the stuck-pending list, rejected by reconciliation remove/merge/restore, and has no delete action in the UI. Relink therefore types those rows as the provider again, on both relink paths: `linkAccountToBankConnection()` and the reconnect in `connectSelectedAccounts()` (Flow 5).

Moving a transaction to another account, either directly or as the opposite leg of a transfer whose destination account changes, sets its `originalSource.importedFrom` to `null` and keeps `originalSource.originalId`. Linking the new account to the same provider therefore leaves the moved row `system`, and the sync dedup still finds the row if it moves back.

The retype excludes planned rows.

### Why Date-Based Filtering Matters

If a user unlinks, adds a manual transaction dated today, then relinks — without date filtering, the sync would re-process all historical transactions from the API. With filtering:

- System finds the latest transaction date (the manual one)
- Only processes API transactions on or after that date
- Old bank transactions are skipped (they already exist via secondary dedup or are too old)
- New bank transactions after the manual one are imported normally

---

## Flow 7: Auth Failure Tracking

Providers that use API keys (LunchFlow) track consecutive authentication failures:

```
API call fails with ForbiddenError
       ↓
handleAuthError()
  • Increment consecutiveAuthFailures in metadata
  • If failures >= 2: deactivate connection (isActive = false)
  • Store deactivationReason = 'auth_failure'
       ↓
On next successful API call:
  resetAuthFailures()
  • Reset counter to 0
```

User can reactivate by updating credentials via `refreshCredentials()`.

---

## Provider Comparison

| Feature           | Monobank        | Enable Banking      | LunchFlow            |
| ----------------- | --------------- | ------------------- | -------------------- |
| Authentication    | API Token       | OAuth2 + JWT        | API Key              |
| Connection Flow   | Single-step     | Multi-step OAuth    | Single-step          |
| Session Expiry    | Never           | 90-360 days         | Never                |
| Transaction Sync  | Queue (BullMQ)  | Direct              | Direct               |
| Rate Limit        | 60s per request | Generous            | Generous             |
| Account IDs       | Stable          | Change on reconnect | Stable               |
| Matching Strategy | By externalId   | By IBAN + currency  | By externalId        |
| Date Filtering    | API-supported   | API-supported       | Post-fetch (runtime) |
| Period Sync       | Supported       | Supported           | Not supported        |
| Webhook Support   | Planned         | Not available       |

---

## Key Implementation Details

### Transaction Amount Handling

Amounts are **always stored as positive values**. The `transactionType` field determines expense vs income:

```typescript
// Monobank - API returns signed amounts
amount: Math.abs(data.amount),
transactionType: data.amount > 0 ? 'income' : 'expense',

// Enable Banking - uses credit_debit_indicator
const isExpense = tx.credit_debit_indicator === CreditDebitIndicator.DBIT;
amount: Math.abs(tx.amount),
transactionType: isExpense ? 'expense' : 'income',
```

### Transaction Deduplication

Each provider generates a unique `externalId` for transactions:

- **Monobank:** Uses API-provided `id`
- **Enable Banking:** when the payload carries an `entry_reference`, SHA256 of `{ accountExternalId, entry_reference }`. Otherwise SHA256 over accountExternalId, amount, currency, credit_debit_indicator, one date (priority `transaction_date` > `value_date` > `booking_date`) and the debtor/creditor IBANs. Remittance text is deliberately not hashed
- **LunchFlow:** Uses API-provided `id` (pending transactions with null IDs are filtered out)

**Two-tier dedup** (LunchFlow, SimpleFIN and Walutomat):

1. **Primary:** Check `originalId` column — fast, covers normal re-sync
2. **Secondary:** Check `externalData.originalSource.originalId` via JSONB query — covers unlink→relink flow where `originalId` was cleared to null but the value was preserved in `externalData`

If secondary dedup finds a match, it restores `originalId` so future syncs use the fast primary path.

**Enable Banking folds the `originalSource` check into its own four-tier matcher** (entry_reference → originalId hash / pendingHash / originalSource → IBAN fingerprint → pending upgrade, see Flow 3). The matcher exists because some ASPSPs populate `entry_reference` only on later syncs, shift the date that feeds the hash, and re-issue a `PDNG` card purchase as a `BOOK` row with a fresh reference and different remittance text — each of which would otherwise produce a duplicate. The `originalSource` branch covers unlink→relink for rows with no `entry_reference` and no counterparty IBAN, which no other tier can match; the sync loop's re-anchor step then restores `originalId`.

**Reconciliation of pre-existing duplicates:** `POST /connections/:id/reconcile-duplicates` runs `reconcileDuplicateTransactionsForAccount`, which buckets an account's transactions by (amount, currency, transactionType) and makes two passes:

- **Pass (a)** pairs booked rows with leftover pre-booking rows, nearest-first. The directional window accepts a booked row dated at or after its pending copy, up to 14 days later. The same conditional IBAN gate as tier 4 applies: a booked row with a counterparty IBAN pairs with pending rows carrying that exact IBAN, falls back to IBAN-less pending rows within 5 days when none does, and never pairs with a different IBAN; a booked row without one is not IBAN-filtered. A pending row that carries its own entry_reference is eligible only against a booked row that also carries one (the fresh-reference re-issue); a pending row without one pairs with any booked row. One booked row adopts at most one pending row. User edits on the pending copy (note, category + its `categorizationMeta` stamp, paymentType, locked payee) migrate onto the survivor; divergent edits on both sides skip the pair, and a skipped pair leaves both rows free to pair with someone else. A moved category always arrives with a manual stamp — synthesized when the pending row only had the legacy null-stamp signal — so the next AI run leaves it alone, and an orphan-only manual stamp moves even when both sides already share the category. The survivor also inherits the pending row's hash as `externalData.pendingHash`, so a re-sent `PDNG` payload resolves through tier 2 instead of recreating the duplicate. Any pending row pass (a) touched — merged or skipped — is excluded from pass (b), as is any booked row that received a merge.
- **Pass (b)** pairs a row that has an `entry_reference` with one that has none, within ±2 days and sharing a counterparty IBAN. It is stricter than pass (a) — the pairing evidence is circumstantial, so any scalar divergence aborts the merge instead of migrating. It compares against canonicals as pass (a) left them, so an edit pass (a) just migrated can block a later strict merge.

Both passes refuse to delete an orphan that has dependent rows (`transferId`, `refundLinked`, splits, tags, refunds in either direction, budgets, subscriptions, group membership), and both are idempotent. The endpoint returns `{ mergedCount, skippedCount, consideredPairs, unresolvedCount }` — `consideredPairs` counts pass-(a) pairs that survived the IBAN gate and the directional window, and `unresolvedCount` counts pairs and rows that produced neither a merge nor a skip (IBAN drops, entry_reference rejects, direction rejects, already-taken members, orphans with no partner).

### Enable Banking Reconnection

When consent expires and user reauthorizes:

1. Enable Banking assigns **new account UUIDs**
2. System matches accounts by **IBAN + currency** (stable identifiers)
3. Updates `externalId` on existing Accounts records
4. Transactions continue to link correctly

### Credential Security

```
Raw credentials → encryptCredentials() → Stored in DB (JSONB)
                                              ↓
                      getDecryptedCredentials() → Used in provider methods
```

---

## File Structure

```
bank-data-providers/
├── docs/
│   └── architecture.md           # This file
├── connection/
│   ├── connect-provider.ts       # Initial connection
│   ├── list-external-accounts.ts # Stage 1: list accounts
│   ├── connect-selected-accounts.ts # Stage 2: create accounts
│   ├── sync-transactions-for-account.ts
│   ├── reconcile-duplicates-for-account.ts
│   ├── disconnect-provider.ts
│   └── get-connection-details.ts
├── sync/
│   ├── sync-manager.ts           # Auto-sync orchestration
│   ├── sync-status-tracker.ts    # Redis status tracking
│   └── account-prioritizer.ts    # Sync priority scoring
├── utils/
│   └── credential-encryption.ts
├── monobank/
│   ├── monobank.provider.ts      # Provider implementation
│   ├── api-client.ts             # HTTP client + caching
│   ├── transaction-sync-queue.ts # BullMQ queue + worker
│   ├── types.ts
│   └── docs/details.md
├── enablebanking/
│   ├── enablebanking.provider.ts # Provider implementation
│   ├── api-client.ts             # HTTP client + JWT
│   ├── aspsp.service.ts          # Bank listing
│   ├── types.ts
│   ├── utils/
│   │   ├── jwt-utils.ts              # JWT generation
│   │   ├── plan-edit-merge.ts        # Pure edit-preservation policy for reconcile
│   │   ├── plan-edit-merge.unit.ts   # Unit tests for the merge policy
│   │   ├── constants.ts              # Lookback schedule + match window sizes
│   │   ├── transaction-metadata.ts   # Stored-row externalData accessors/predicates
│   │   ├── transaction-metadata.unit.ts # Unit tests for the accessors
│   │   ├── transaction-hash.ts       # Transaction hashing + date priority
│   │   ├── transaction-hash.unit.ts  # Unit tests for hashing
│   │   ├── candidate-selection.ts    # IBAN gate + nearest-date pick
│   │   ├── candidate-selection.unit.ts # Unit tests for candidate selection
│   │   ├── consent.ts                # Consent validity end date
│   │   ├── balances.ts               # Balance type priority + payload shaping for logs
│   │   └── balances.unit.ts          # Unit tests for balance type priority
│   ├── enablebanking-dedup.e2e.ts # E2E: matcher tiers + reconciliation
│   ├── enablebanking-flow.e2e.ts # E2E: connect → sync flow
│   └── docs/details.md
├── lunchflow/
│   ├── lunchflow.provider.ts     # Provider implementation
│   ├── api-client.ts             # HTTP client
│   ├── types.ts
│   └── lunchflow-flow.e2e.ts     # E2E tests
├── types.ts                      # Shared interfaces
├── base-provider.ts              # Abstract base class
├── registry.ts                   # Provider registry singleton
└── initialize-providers.ts       # App startup registration
```

---

## API Endpoints Summary

| Endpoint                                  | Method | Purpose                                     |
| ----------------------------------------- | ------ | ------------------------------------------- |
| `/:providerType/connect`                  | POST   | Start connection                            |
| `/connections`                            | GET    | List user connections                       |
| `/connections/:id`                        | GET    | Connection details                          |
| `/connections/:id`                        | DELETE | Disconnect (see Flow 5)                     |
| `/connections/:id/reauthorize`            | POST   | Renew consent (Enable Banking)              |
| `/connections/:id/available-accounts`     | GET    | List accounts for selection                 |
| `/connections/:id/sync-selected-accounts` | POST   | Create accounts + sync                      |
| `/connections/:id/sync-transactions`      | POST   | Sync single account                         |
| `/connections/:id/sync`                   | POST   | Queue sync for the connection's accounts    |
| `/connections/:id/reconcile-duplicates`   | POST   | Collapse pre-existing duplicate pairs       |
| `/sync/trigger`                           | POST   | Trigger full sync                           |
| `/sync/status`                            | GET    | Get all sync statuses                       |
| `/enablebanking/oauth-callback`           | POST   | OAuth completion                            |
| `/enablebanking/countries`                | POST   | List available countries                    |
| `/enablebanking/banks`                    | POST   | List banks by country                       |
| `/accounts/:id/unlink`                    | POST   | Unlink account from connection (see Flow 6) |
| `/accounts/:id/link`                      | POST   | Link system account to connection           |
