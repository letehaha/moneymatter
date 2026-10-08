# Backend Conventions

## Architecture

Strict **route → controller → service** pattern. No business logic in routes or controllers.

```
src/
├── routes/{feature}.route.ts
├── controllers/{feature}.controller.ts
└── services/{feature}/{action}.service.ts
```

## Path Aliases

Defined in `packages/backend/tsconfig.json`:

- `@routes/*` → `src/routes/*`
- `@controllers/*` → `src/controllers/*`
- `@services/*` → `src/services/*`
- `@models/*` → `src/models/*`
- `@middlewares/*` → `src/middlewares/*`
- `@common/*` → `src/common/*`
- `@js/*` → `src/js/*`
- `@crons/*` → `src/crons/*`
- `@tests/*` → `src/tests/*`
- `@root/*` → `src/*`
- `@bt/shared/*` → `../../shared/src/*`

## Route Layer

```typescript
import { Router } from 'express';
import { authenticateSession } from '@middlewares/better-auth';
import featureController from '@controllers/feature.controller';

const router = Router();

router.get('/', authenticateSession, featureController);

export default router;
```

## Controller Layer

Always use `createController` factory. Keep controllers thin — delegate to services.

```typescript
import { createController } from '@controllers/helpers/controller-factory';
import * as featureService from '@services/feature.service';
import { z } from 'zod';

const schema = z.object({
  params: z.object({ id: recordId() }).optional(), // custom Zod types from @common/lib/zod/custom-types
  query: z.object({}).optional(),
  body: z.object({}).optional(),
});

export default createController(schema, async ({ user, params, query, body }) => {
  const data = await featureService.doSomething({ userId: user.id, ...params });
  return { data }; // return { data, statusCode? }
});
```

## Service Layer

- Always use **object-based parameters** with interfaces
- Use `withTransaction` for **writes only** — services that modify data (create / update / delete / link / unlink, or any multi-statement mutation). Plain reads (`get*`, `list*`, `find*`) are single-statement queries and do **not** need a transaction; wrapping them adds overhead and confuses the read-vs-write contract at a glance.
- Use functions, never classes
- Error types from `@js/errors`: `NotFoundError`, `ValidationError`, `ConflictError`, `NotAllowedError`, `Unauthorized`
- For `findOne(...) → throw NotFoundError` use the `findOrThrowNotFound` helper from `@common/utils/find-or-throw-not-found` instead of hand-rolling the null check. It keeps the call site short and the throw consistent.
- Throw with an i18n key, not a literal English string: `t({ key: 'feature.thingNotFound' })`. Errors surface in user-facing UI eventually and the i18n loader handles missing-key fallback.

```typescript
// Read — no transaction wrapper
import { findOrThrowNotFound } from '@common/utils/find-or-throw-not-found';
import { t } from '@i18n/index';
import * as FeatureModel from '@models/feature.model';

export const getFeatureById = ({ userId, id }: { userId: number; id: string }) =>
  findOrThrowNotFound({
    query: FeatureModel.findOne({ where: { id, userId } }),
    message: t({ key: 'feature.featureNotFound' }),
  });
```

```typescript
// Write — withTransaction wraps the mutation
import { withTransaction } from '@services/common/with-transaction';

const createFeatureImpl = async ({ userId, name }: { userId: number; name: string }) => {
  // …multi-step mutation that must be atomic…
};

export const createFeature = withTransaction(createFeatureImpl);
```

## API Response Format

```typescript
// Success
{ status: API_RESPONSE_STATUS.success, response: unknown }

// Error
{ status: API_RESPONSE_STATUS.error, error: { message: string, code?: string, details?: unknown } }
```

## Common Middleware

- `authenticateSession` — authentication (better-auth sessions)
- Request validation is built into `createController` (422 on a Zod failure). `validateEndpoint(schema)` exists only to reject a bad request ahead of earlier middleware such as rate limiters (see `landing.route.ts`)

## Shared Types

- API envelope, error codes, their `details` payloads and generic request primitives: `packages/shared/src/types/api.ts`
- A new enum, model, request/response type or limit goes in `packages/shared/src/types/<domain>.ts`, where the domain is the backend routes/services feature that owns it — all kinds together
- No file is organised by kind (no `enums.ts`, `models.ts`, `endpoints.ts`)
- Import flat: `import { ... } from '@bt/shared/types'`
- A domain becomes a folder only when it has separable sub-features (e.g. `transactions/`, `stats/`)
- `investments/` and `venture/` predate this rule (kind-named files, deep imports) — not a pattern to copy
- Non-domain constants live in `packages/shared/src/const/`

## E2E Tests

**Location**: E2E tests live **in the service layer**, colocated with the service file they test:

```
src/services/{feature}/action.e2e.ts
```

Examples:

- `src/services/accounts/delete-account.e2e.ts`
- `src/services/transactions/get-transactions.e2e.ts`
- `src/services/budgets/budget-crud.e2e.ts`

**Never** place e2e tests in the controllers layer. Even when testing a full HTTP endpoint, the test file belongs next to the corresponding service.

## E2E Test Helpers

Test helpers live in `packages/backend/src/tests/helpers/`. Always type the return value:

```typescript
import { createInvestmentTransaction as _createInvestmentTransaction } from '@services/investments/transactions/create.service';

export async function createInvestmentTransaction<R extends boolean | undefined = false>({
  payload,
  raw,
}: {
  payload: ReturnType<typeof buildInvestmentTransactionPayload>;
  raw?: R;
}) {
  return makeRequest<Awaited<ReturnType<typeof _createInvestmentTransaction>>, R>({
    method: 'post',
    url: '/investments/transaction',
    payload,
    raw,
  });
}
```

## Database

- Use Sequelize for all DB operations
- Always use transactions for multi-step operations (`withTransaction`)
- Define proper indexes
