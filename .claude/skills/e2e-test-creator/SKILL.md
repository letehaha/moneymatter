---
name: e2e-test-creator
description: Creates backend e2e tests for new or existing endpoints. Auto-triggers after implementing a new API endpoint. Also runs when asked to add test coverage or triggered by "/e2e-test-creator". Follows project conventions for test structure, helpers, and assertions.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash, AskUserQuestion
---

# E2E Test Creator

Creates properly structured e2e tests for backend API endpoints following this project's exact conventions.

## Mode

This skill is primarily a **reference guide** — read the conventions below and write tests directly based on the endpoint just implemented. However, if there's ambiguity about what scenarios to cover (e.g., complex business logic, unclear edge cases), it's fine to ask the user a brief clarifying question before writing.

## When to Use

- **Auto-trigger**: After implementing any new backend endpoint (route + controller + service), always write e2e tests as part of the implementation workflow
- When user explicitly asks to add e2e test coverage
- When triggered via `/e2e-test-creator`

## Step 1: Gather Context

Before writing any test, read these files to understand what you're testing:

1. The **service** being tested (to understand input/output types and logic)
2. The **controller** (to understand the Zod schema / endpoint contract)
3. The **route** (to confirm the HTTP method and path)
4. The **test helpers** file for that domain (`packages/backend/src/tests/helpers/<domain>.ts`)
5. Any **existing e2e tests** for the same domain (to colocate or extend)

## Step 2: Ensure Test Helper Exists

Every endpoint needs a corresponding test helper function. If one doesn't exist, create it first.

### Test Helper Pattern

Location: `packages/backend/src/tests/helpers/<domain>.ts`

```typescript
import type { myService as apiMyService } from '@services/<domain>/my-service';
import { makeRequest } from './common';

export async function myEndpoint<R extends boolean | undefined = undefined>({
  raw,
  // ... endpoint-specific params
}: {
  raw?: R;
  // ... param types
} = {}) {
  return makeRequest<Awaited<ReturnType<typeof apiMyService>>, R>({
    method: 'get', // or post, put, patch, delete
    url: '/<domain>/endpoint',
    raw,
  });
}
```

Key rules:

- Use **type-only** import for the service function (for return type inference)
- Use the generic `<R>` pattern for the `raw` parameter
- Pass query params via `payload` for GET requests (makeRequest converts them to query string)

## Step 3: Write the Test File

### File Location & Naming

- **Colocate** with the service: `packages/backend/src/services/<domain>/<feature>.e2e.ts`
- **Or extend** an existing test file if there's already one for that domain
- Naming: `kebab-case.e2e.ts`

### Test Structure

```typescript
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';
// Import enums/types needed for test data
import { SOME_ENUM } from '@bt/shared/types';

describe('Feature Name', () => {
  // Group by logical concern
  describe('GET /endpoint', () => {
    it('returns expected data for happy path', async () => {
      // ARRANGE: create prerequisite data via helpers
      const account = await helpers.createAccount({ raw: true });

      // ACT: call the endpoint being tested
      const result = await helpers.myEndpoint({ raw: true });

      // ASSERT: verify the response
      expect(result.someField).toBe(expectedValue);
    });

    it('returns empty/default when no data exists', async () => {
      const result = await helpers.myEndpoint({ raw: true });
      expect(result.count).toBe(0);
    });

    it('filters by query parameter', async () => {
      // Create mixed data
      await helpers.createThing({ type: 'a', raw: true });
      await helpers.createThing({ type: 'b', raw: true });

      // Filter
      const result = await helpers.myEndpoint({ type: 'a', raw: true });
      expect(result.length).toBe(1);
    });
  });
});
```

### Required Minimum Coverage (every endpoint)

1. **Happy path** — the main use case returns correct data
2. **Empty state** — what happens when there's no data (e.g., no subscriptions yet returns zeros)
3. **Error case** — at least one: invalid input, not-found resource, or unauthorized access (use `raw: false` for status code checks)

### Additional Coverage (add when relevant)

- **Filtering** — if the endpoint accepts query params, test each filter
- **Cross-currency** — if the endpoint does currency conversion, test with a non-base currency
- **Edge cases** — boundary values, null fields, inactive records
- **Data isolation** — the endpoint only returns data for the authenticated user

## Key Rules

### NEVER call services directly

```typescript
// WRONG
const result = await getSubscriptionsSummary({ userId: 1 });

// CORRECT
const result = await helpers.getSubscriptionsSummary({ raw: true });
```

### Use `raw: true` for happy path, `raw: false` for error checks

```typescript
// Happy path — get extracted data directly
const data = await helpers.getSomething({ raw: true });
expect(data.name).toBe('expected');

// Error case — check HTTP status code
const res = await helpers.getSomething({ id: 'nonexistent' });
expect(res.statusCode).toBe(404);
```

### HTTP status codes

- `200` — success
- `404` — not found
- `409` — conflict (e.g., duplicate link)
- **`422`** — Zod validation errors (invalid params, query, body). **NOT `400`** — `createController` validates the request and returns `422 Unprocessable Entity` for schema validation failures.

### Money amounts

- Create with **cents**: `expectedAmount: 1599` (= $15.99)
- API responses return **decimals**: `expect(result.amount).toBe(15.99)`

### Test data setup

- Each test starts with a clean database (global `beforeEach` truncates tables)
- A default user with base currency AED is created automatically
- Create test-specific data at the top of each `it()` block via helpers
- Use `await Promise.all([...])` for independent data creation

### No test timeouts

- Default timeout is 15s per test, 20s for setup
- If a test needs more, there's likely a problem with the test or the endpoint

## Step 4: Verify

After writing the test, run it automatically using the `test-runner` subagent:

```bash
npm run test:e2e -- --testPathPattern='<pattern>'
```

Run from `packages/backend/`. Do NOT wait for user confirmation — run tests immediately after writing them.

## Example: Complete Test for a Summary Endpoint

```typescript
import { SUBSCRIPTION_FREQUENCIES, SUBSCRIPTION_TYPES } from '@bt/shared/types';
import { describe, expect, it } from '@jest/globals';
import * as helpers from '@tests/helpers';

describe('Subscriptions Summary', () => {
  describe('GET /subscriptions/summary', () => {
    it('returns summary with correct monthly cost', async () => {
      await helpers.createSubscription({
        name: 'Netflix',
        expectedAmount: 1500,
        expectedCurrencyCode: global.BASE_CURRENCY_CODE,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      const summary = await helpers.getSubscriptionsSummary({ raw: true });

      expect(summary.activeCount).toBe(1);
      expect(summary.estimatedMonthlyCost).toBe(15);
      expect(summary.projectedYearlyCost).toBe(180);
      expect(summary.currencyCode).toBe(global.BASE_CURRENCY_CODE);
    });

    it('returns zeros when no active subscriptions exist', async () => {
      const summary = await helpers.getSubscriptionsSummary({ raw: true });

      expect(summary.activeCount).toBe(0);
      expect(summary.estimatedMonthlyCost).toBe(0);
      expect(summary.projectedYearlyCost).toBe(0);
    });

    it('filters by subscription type', async () => {
      await helpers.createSubscription({
        name: 'Netflix',
        type: SUBSCRIPTION_TYPES.subscription,
        expectedAmount: 1500,
        expectedCurrencyCode: global.BASE_CURRENCY_CODE,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });
      await helpers.createSubscription({
        name: 'Electricity',
        type: SUBSCRIPTION_TYPES.bill,
        expectedAmount: 10000,
        expectedCurrencyCode: global.BASE_CURRENCY_CODE,
        frequency: SUBSCRIPTION_FREQUENCIES.monthly,
        startDate: '2025-01-01',
        raw: true,
      });

      const subsOnly = await helpers.getSubscriptionsSummary({
        type: SUBSCRIPTION_TYPES.subscription,
        raw: true,
      });
      expect(subsOnly.activeCount).toBe(1);
      expect(subsOnly.estimatedMonthlyCost).toBe(15);

      const billsOnly = await helpers.getSubscriptionsSummary({
        type: SUBSCRIPTION_TYPES.bill,
        raw: true,
      });
      expect(billsOnly.activeCount).toBe(1);
      expect(billsOnly.estimatedMonthlyCost).toBe(100);
    });
  });
});
```

## Troubleshooting

### Test timeout (exceeds 15s)

Cause: Endpoint is too slow or test has an unresolved promise
Solution: Check for missing `await` keywords, infinite loops, or endpoints that need optimization.

### "relation does not exist" error

Cause: Migration hasn't been applied to the test database
Solution: Verify migrations are up to date. The test setup should handle this automatically, but check for new migration files.

### Unexpected 422 instead of 400

Cause: `createController` returns 422 for Zod validation failures, not 400
Solution: Always expect `422` for schema validation errors. Use `400` only for custom validation in service logic.
