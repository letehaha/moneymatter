# Monobank Integration

## Overview

Monobank is a Ukrainian digital bank that provides API access via personal API tokens.

## Key Characteristics

### Authentication

- **Token Type:** Personal API token (no expiration)
- **Authentication Method:** `X-Token` header on all API requests
- **User Action Required:** User must generate token from Monobank app/website
- **Security:** Token is SHA256 hashed in the DB

### API Constraints

- **Rate Limit:** 1 request per 60 seconds
- **Response Caching:** Client info cached for 15 minutes to reduce API calls
- **Transaction History:** 31-day period per request
- **Historical Data:** No max date limit - can load full history via queued requests

## Connection Flow

### 1. User Provides Token

```
POST /bank-data-providers/monobank/connect
{
  "providerType": "monobank",
  "credentials": {
    "apiToken": "user-provided-token"
  }
}
```

**What happens:**

1. Validates token by making test API call to `getClientInfo`
2. Stores encrypted token in database
3. Connection is immediately active (no OAuth flow)

**Error handling:**

- Invalid token → `ForbiddenError`
- Rate limit exceeded → `TooManyRequests` error

### 2. Account Sync

- Fetches list of accounts from Monobank API
- Maps numeric currency codes (e.g., 980) to ISO codes (e.g., 'UAH')
- Creates user-friendly account names (e.g., "Black Card \*\*\*\*1234")
- User selects which accounts to sync
- Creates account records in database
- **Auto re-enables** previously disabled accounts if reconnected

### 3. Transaction Sync

- **Automatically triggered** when new account is connected
- Uses BullMQ job queue to respect rate limits
- Fetches transactions in 31-day chunks
- Processes in **descending order** (newest first) for better UX
- Works backward through history until all data loaded
- **Progress tracking** available via `GET /connections/:connectionId/sync-job-progress`

## Technical Details

### Rate Limiting Strategy

- All API calls go through queue system (BullMQ)
- Enforces 60-second delay between requests
- Exponential backoff for failed job retries
- Allows background historical sync without blocking user

### Transaction Sync Process

1. Find most recent transaction in database
2. If no transactions exist, start from 31 days ago
3. Queue job to fetch transactions (newest first)
4. Job fetches next 31-day chunk
5. Updates account balance from **most recent transaction** in batch
6. If more history exists, queue another job
7. Repeat until all history loaded

### Error Handling

- **Invalid API Token:** `ForbiddenError` returned to user
- **Rate Limit Exceeded:** `TooManyRequests` error with automatic retry
- **Job Failures:** BullMQ handles retries with exponential backoff
- **Specific Error Mapping:** Monobank errors mapped to application errors

### Data Storage

- **Connection:** Stores encrypted API token
- **Accounts:** Links to connection via `bankDataProviderConnectionId`
- **Transactions:** Standard transaction format with `originalId` from Monobank
- **Balance Consistency:** Updated from transaction data, not separate API calls

### File Structure

```
monobank/
├── api-client.ts              # HTTP client, caching, error handling
├── monobank.provider.ts       # Core business logic, data mapping
├── transaction-sync-queue.ts  # BullMQ queue and worker
└── docs/
    └── details.md            # This file
```

### Key Dependencies

- **axios:** HTTP client for Monobank API
- **BullMQ:** Job queue for transaction sync

## Features & Limitations

### ✅ Supported

- API token authentication
- Account listing and sync
- Transaction sync with progress tracking
- Rate limit handling
- Auto re-enabling disabled accounts
- Historical data sync (unlimited)

### ❌ Not Supported

- Webhooks (not yet implemented)

## Key Differences from Enable Banking

| Feature         | Monobank               | Enable Banking              |
| --------------- | ---------------------- | --------------------------- |
| Authentication  | API Token              | OAuth + Private Key         |
| Rate Limiting   | 60 seconds per request | No specific limit           |
| Connection Flow | Single-step            | Multi-step OAuth            |
| Session Expiry  | Never                  | Usually from 90 to 360 days |
| Queue System    | Yes (BullMQ)           | No                          |
| Historical Sync | 31-day chunks          | Full range per request      |
| Caching         | 15 min client info     | No caching                  |
