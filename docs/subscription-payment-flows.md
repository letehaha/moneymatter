# Subscription Payment Flows

How a subscription period becomes "paid", and when that creates a transaction.

> **TL;DR**
> A subscription may book a transaction only on a **manual (`system`) account**. Bank-connected accounts get their transactions from the bank sync, so on those a period can only be marked paid (status only) or linked to a synced transaction.

---

## 1. Ways a period gets paid

| Mode            | What happens                                                       | Allowed on bank accounts   |
| --------------- | ------------------------------------------------------------------ | -------------------------- |
| **Mark only**   | Period → `paid`, no transaction.                                   | Yes                        |
| **Create**      | Builds a transaction from the subscription and links it.           | **No** (422)               |
| **Link**        | Links an existing transaction (manual or synced).                  | Yes                        |
| **Auto-record** | Hourly cron runs **Create** for every due period.                  | **No** (see §4)            |
| **Matching**    | Rules link incoming transactions (e.g. from bank sync) to periods. | Yes – the bank-account way |

Reverting a period deletes the transaction only if it was app-created (**Create** / **Auto-record**); linked transactions are left untouched. An app-created transaction whose account is bank-linked at revert time is also left in place, detached from the period.

---

## 2. "Mark paid" button (frontend)

`subscription-mark-paid-dialog.vue` → `triggerPay`

```mermaid
flowchart TD
    Start(["Mark paid clicked"]) --> HasAcc{"Subscription has an account?"}
    HasAcc -->|No| ModeDialog["Dialog: choose mode"]
    ModeDialog -->|Mark only| MarkOnly["Mark only"]
    ModeDialog -->|Create a transaction| Pick["Pick a manual account, amount, date"]
    Pick --> CreateLink["Create, and save the account onto the subscription"]
    HasAcc -->|Yes| IsBank{"Bank-connected account?"}
    IsBank -->|Yes| MarkOnly
    IsBank -->|No| Fixed{"Fixed amount in the account currency?"}
    Fixed -->|Yes| OneClick["Create in one click"]
    Fixed -->|No| AmountDialog["Dialog: enter amount (cross-currency pre-filled)"]
    AmountDialog --> CreateTx["Create"]
```

The account picker lists only manual accounts (`txTargetableSourceAccountsActiveFirst`), the same list as the Add Transaction dialog.

---

## 3. Backend enforcement

`POST /subscriptions/:id/periods/:periodId/pay` → `markPeriodPaid` (one DB transaction).

```mermaid
flowchart TD
    Req(["pay request"]) --> PeriodStatus{"Period already paid or skipped?"}
    PeriodStatus -->|Yes| E409["409"]
    PeriodStatus -->|No| AccParam{"accountId passed?"}
    AccParam -->|Yes| SaveAcc["Save it onto the subscription"]
    AccParam -->|No| PayMode{"Mode"}
    SaveAcc --> PayMode
    PayMode -->|Create| Build["buildTransactionFromSubscription"]
    Build --> CT["createTransaction resolves the real account type"]
    CT -->|Bank account| E422["422 manualOnConnectedAccount, everything rolls back"]
    CT -->|Manual account| Paid["Period marked paid, next period ensured"]
    PayMode -->|Link| Paid
    PayMode -->|Mark only| Paid
```

The builder deliberately omits `accountType`: passing one would skip `createTransaction`'s account-type check. That is how bank-account transactions slipped through before (#698).

---

## 4. Auto-record guards

Auto-record and bank accounts must never be combined, otherwise the cron fails on every tick.

```mermaid
flowchart LR
    SaveSub(["Create or update subscription with autoRecord on"]) --> IsBankAcc{"Account is bank-connected?"}
    IsBankAcc -->|Yes| Reject["422"]
    IsBankAcc -->|No| Saved["Saved"]
    LinkAcc(["Manual account linked or reconnected to a bank connection"]) --> TurnOff["autoRecord silently turned off"]
```

| Where                                | Guard                                                                      |
| ------------------------------------ | -------------------------------------------------------------------------- |
| Edit-automation dialog               | Record mode offers only manual accounts; a saved bank account blocks Save. |
| Subscription create / update service | `assertAutoRecordAccountIsManual` → 422.                                   |
| `linkAccountToBankConnection`        | Sets `autoRecord = false` on the account's subscriptions.                  |
| `connectSelectedAccounts` (re-link)  | Sets `autoRecord = false` on the account's subscriptions.                  |
| Migration                            | One-off: turns off `autoRecord` on subscriptions already on bank accounts. |

After auto-record is turned off, the user keeps the **Mark paid** button (status only) and can set up **Matching** to link synced transactions automatically.
