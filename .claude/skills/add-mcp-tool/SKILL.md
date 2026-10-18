---
name: add-mcp-tool
description: Add a new tool to the MoneyMatter MCP server. Auto-triggers when the user asks to "add MCP tool", "new MCP tool", "expose X via MCP", or when exposing any existing backend service to MCP clients. Handles every metafile the drift tests check.
allowed-tools: Read, Write, Edit, Grep, Glob, Bash
---

# Add MCP Tool

Adds a new tool to the MCP server at `https://mcp.moneymatter.app/mcp` without breaking any drift check.

## When to use

- User asks to add/expose a new MCP tool
- User wants an existing backend service callable by MCP clients (Claude Desktop, ChatGPT, etc.)
- Any time the tool list at `packages/frontend/public/.well-known/mcp/server-card.json` needs to grow

## Architecture at a glance

Each MCP tool is a thin wrapper over an existing backend service:

```
Service (@services/...)
  ↓ called by
MCP tool file (packages/backend/src/services/mcp/tools/<name>.ts)
  ↓ registered in
createMcpServer() (packages/backend/src/services/mcp/server.ts)
```

Three metafiles stay in sync via drift tests (a fourth drift test checks that every tool file is registered in `server.ts`):

- `packages/frontend/public/.well-known/mcp/server-card.json` — machine-readable tool list
- `packages/frontend/public/skills/connect-moneymatter/SKILL.md` — human-readable agent skill
- `packages/frontend/public/.well-known/agent-skills/index.json` — contains `sha256` of the SKILL.md above

## Checklist (complete every step)

When adding tool `my_new_tool`:

### 1. Create the tool file

Path: `packages/backend/src/services/mcp/tools/my-new-tool.ts` (kebab-case filename)

Use this template. Adjust imports, tool name, description, `inputSchema`, service call, and `tool:` string in `trackMcpToolUsed`. A read tool drops the guard lines; a write tool keeps the ones its REST route has (see "Mirror the REST route" and "Write guard order" below).

```typescript
import { FEATURES } from '@bt/shared/types'; // only for a feature-gated tool
import { recordId } from '@common/lib/zod/custom-types';
import { trackMcpToolUsed } from '@js/utils/posthog';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SOME_RATE_LIMIT } from '@services/common/user-rate-limits'; // only for a rate-limited route
import { myService } from '@services/path/to/my-service';
import { z } from 'zod';

import {
  assertBaseCurrencyUnlocked,
  enforceUserRateLimit,
  getUserId,
  jsonContent,
  requireFeatureAccess,
  requireScope,
} from './helpers';

const inputSchema = {
  someId: recordId().describe('...'),
  optionalFilter: z.string().optional().describe('...'),
};

export function registerMyNewTool(server: McpServer) {
  server.registerTool(
    'my_new_tool',
    {
      description: 'What it returns and when an agent should call it. One sentence plus a hint on key fields.',
      inputSchema,
    },
    async (args, extra) => {
      const userId = getUserId({ extra });
      requireScope({ extra, scope: 'finance:write' }); // write and delete tools only
      await assertBaseCurrencyUnlocked({ userId }); // unless the REST route has no checkBaseCurrencyLock
      requireFeatureAccess({ extra, feature: FEATURES.budget_plan }); // only when the REST route has requireFeature
      await enforceUserRateLimit({ userId, limit: SOME_RATE_LIMIT }); // only when the REST route is rate-limited
      trackMcpToolUsed({ userId, tool: 'my_new_tool', clientId: extra.authInfo?.clientId });

      const result = await myService({ userId, ...args });
      return jsonContent({ data: result });
    },
  );
}
```

Rules:

- Tool name is **snake_case** (matches MCP convention) and must exactly equal the string in `server-card.json`.
- Register function is `register<PascalCase>`. File is `<kebab-case>.ts`.
- `inputSchema` is a **plain object of Zod schemas** (no outer `z.object(...)`), declared as a **module-scope `const`**, never inline inside `registerTool()`. Every MCP session builds its own `McpServer`, so an inline shape is rebuilt per session (zod v4 schemas are ~30 KB each).
- For tools with no inputs: omit `inputSchema` and drop the `args` parameter — handler becomes `async (extra) => {...}`.
- Always call `getUserId({ extra })` first — it enforces auth and returns `userId`.
- Write guard order: `getUserId` → `requireScope` → `assertBaseCurrencyUnlocked` → `requireFeatureAccess` (when gated) → `enforceUserRateLimit` (when rate-limited) → `trackMcpToolUsed` → service.
- Always call `trackMcpToolUsed({ userId, tool, clientId: extra.authInfo?.clientId })` after the guards, before the service call.
- Wrap the final response in `jsonContent({ data })`. Money instances auto-serialize to decimals via `toJSON()` in `JSON.stringify`.
- Use `z.enum([...])` for enum args — match the style in `search-transactions.ts`.
- Dates: pass ISO strings in and convert with `new Date(args.date)` if the underlying service expects a `Date`.

### Naming, scopes and guards

- **Names:** read tools start with `get_`, `list_`, `search_` or `preview_`, and nothing else does. Read tools call no scope helper (the `/mcp` route already requires `finance:read`).
- **Scopes:** every other tool calls `requireScope`. `finance:write` is the default. `delete_*` tools, and tools that permanently remove data without `delete_` in the name (`merge_payees`, `bulk_delete_*`), use `finance:delete` and are listed in `DESTRUCTIVE_TOOLS` in `tool-scopes-drift.unit.ts` when the name lacks the prefix. A soft delete that a restore tool undoes is a `finance:write` tool. A tool whose delete path is optional (for example `ignore_payee_name` with `force`) uses `finance:write` normally and `finance:delete` on the delete path; list it in `CONDITIONAL_DELETE_TOOLS` in `tool-scopes-drift.unit.ts` (beside `DESTRUCTIVE_TOOLS`) instead.
- **Read-only and demo users:** `requireScope` rejects both. The only exception is a tool on a route in `READ_ONLY_ROUTES` (`middlewares/entitlements.ts`), which REST lets a read-only user call: it passes `allowReadOnly: true`, and is listed in `READ_ONLY_ROUTE_TOOLS` (with the route in a comment) in `tool-scopes-drift.unit.ts`, so the exemption cannot spread.
- **Base-currency lock:** `assertBaseCurrencyUnlocked({ userId })` right after `requireScope` mirrors `checkBaseCurrencyLock`. The lock follows the REST route, not the tool's name or scope:
  - a write tool whose route has no lock goes into `LOCK_EXEMPT_TOOLS` (with the route in a comment);
  - a read-named tool whose route carries the lock (`preview_transaction_automation`) calls `getUserId` → `assertBaseCurrencyUnlocked` → `trackMcpToolUsed`, and goes into `LOCK_GUARDED_READ_TOOLS`.
- **Feature gates:** `requireFeatureAccess({ extra, feature })` where the route has `requireFeature`. It reads the features that `services/mcp/auth.ts` puts in the auth info and throws the same message as REST's 402.
- **Rate limits:** where the REST route is rate-limited, put the budget in `services/common/user-rate-limits.ts`, read it from both `middlewares/rate-limit.ts` and the tool, and call `enforceUserRateLimit({ userId, limit })`, so the two paths share one counter per user.

### Mirror the REST route

Every tool is a thin wrapper over the service its REST route uses. Parity with REST is the rule: the same service, validation, lock, feature gate, rate limit and read-only handling, and the same serializer (slimmed for MCP in `serializers.ts` where the output is large). When a controller holds logic a tool needs (validation, orchestration), move it into a service or a shared schema that both the controller and the tool call. Never copy it into the tool.

**Refined inputs:** the SDK's `inputSchema` is a plain shape of Zod fields, so a rule that spans fields (an either-or, a mutually exclusive pair, a `superRefine`) cannot sit in it. Expose the shared schema's `.shape` as `inputSchema` and run the full shared schema (or an `assert…Args` helper like `assertOriginalCurrencyArgs`) in the handler, on the schema's own fields only: when the tool adds ids beside a strict body schema, destructure them off first (`const { planId, ...body } = args; schema.parse(body)`), or the strict parse rejects the ids. The unit test asserts that the **tool** rejects, not the shape.

### 2. Register the tool in `server.ts`

Add the import (alphabetical) and call it inside `createMcpServer()`:

```typescript
import { registerMyNewTool } from './tools/my-new-tool';
// ...
registerMyNewTool(server);
```

### 3. Update `server-card.json`

Path: `packages/frontend/public/.well-known/mcp/server-card.json`

Append to the `tools[]` array:

```json
{
  "name": "my_new_tool",
  "description": "Short third-person description. Match what clients see."
}
```

The `name` MUST match the string in step 1 exactly. The drift test compares sorted arrays by string equality.

### 4. Update the connect-moneymatter SKILL.md

Path: `packages/frontend/public/skills/connect-moneymatter/SKILL.md`

Add a row to the "Available tools" table in the section that matches the `// comment` group the tool is registered under in `server.ts` (one `###` section per group, in the same order). Use the SAME column layout (keep table alignment padded) and state the scope as the existing rows do.

If the new tool introduces a new data convention (e.g. investments vs regular transactions), also add a bullet under "Data conventions".

### 5. Recompute SKILL.md sha256

```bash
shasum -a 256 packages/frontend/public/skills/connect-moneymatter/SKILL.md
```

Take the hex digest and update it in `packages/frontend/public/.well-known/agent-skills/index.json`:

```json
{
  "skills": [
    {
      "name": "connect-moneymatter",
      ...
      "sha256": "<paste digest here>"
    }
  ]
}
```

Forgetting this step breaks `agent-skills-drift.unit.ts`.

### 6. Write the unit test and run the gate

Add `tools/<area>-tools.unit.ts` with the capture helper from `@tests/helpers/mcp-tools`, and `jest.mock` the services (their import chains open Redis connections at module scope):

```typescript
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';

const [tool] = captureTools({ register: registerMyNewTool });
const result = await tool.handler(
  { someId },
  makeExtra({ scopes: ['finance:read', 'finance:write'], features: [FEATURES.budget_plan] }),
);
```

For every tool, cover:

- the input schema accepts a valid input and rejects an invalid one (`z.object(tool.config.inputSchema!)`);
- a write tool throws without its scope, while the lock is set (unless exempt), without the feature when gated, and when its limiter refuses, with the service mock not called; a tool on a `READ_ONLY_ROUTES` route passes for a read-only user, and every other write tool throws for one;
- the handler calls the service with `userId` and the mapped arguments, and returns `jsonContent` of the result.

Run the gate:

```bash
cd packages/backend
npm run test:unit -- --testPathPattern='services/mcp/'
```

It covers four drift suites and every tool unit test:

- `server-card-drift` — tool names in the files equal `server-card.json`;
- `agent-skills-drift` — the SKILL.md sha256;
- `tool-scopes-drift` — scopes, `DESTRUCTIVE_TOOLS`, the lock lists and `READ_ONLY_ROUTE_TOOLS`;
- `server-registration-drift` — every `registerX` is imported and called exactly once in `server.ts`.

If any fail:

- **`tools array` mismatch** → name in source and `server-card.json` don't match. Check for typos.
- **`every tool has a non-empty description`** → description missing in `server-card.json`.
- **`sha256 matches`** → re-run `shasum -a 256` and paste again.
- **`every skill URL resolves`** → `SKILL.md` file path is wrong.
- **lock or scope case** → the tool lacks `assertBaseCurrencyUnlocked` or `requireScope`; or it belongs in `LOCK_EXEMPT_TOOLS`, `LOCK_GUARDED_READ_TOOLS`, `DESTRUCTIVE_TOOLS` or `READ_ONLY_ROUTE_TOOLS` after you checked its route.
- **registration case** → `server.ts` lacks the import or the `registerX(server)` call.

Delegate to the `test-runner` subagent (per CLAUDE.md rules).

**e2e:** the gate also runs the MCP e2e suites (`services/mcp/(connected-apps|mcp-scope-gate)`) plus the REST suites of the routes the tool wraps, in one batched run: `lockf -t 7200 /tmp/mm-e2e.lock npm run test:e2e -- --testPathPattern='...'`. Tools themselves cannot be called end to end, so a check that moves out of a controller into a service gets an e2e case first, run green against the unmoved code, and stays green after the move.

### 7. Lint check (optional but cheap)

Delegate to the `linter` subagent. Existing MCP tool files may show 4 `TS1005`-style errors from an `ioredis` env issue — that's pre-existing noise and not caused by new tools. Real errors look different (unused imports, mistyped service args, wrong Zod shape).

## Anti-patterns

- **Do not** bypass `getUserId` or skip `trackMcpToolUsed`. These are enforced across all existing tools.
- **Do not** skip `requireScope` on a write tool, or the lock check on a route that carries `checkBaseCurrencyLock`. The drift tests fail for both.
- **Do not** copy controller logic into a tool. Move it into a service or shared schema that both call.
- **Do not** call services with `raw: true` or reach past the service layer. Use the `@services/*` function as-is.
- **Do not** add custom auth logic — all auth flows through the OAuth bearer token resolved by `extra.authInfo`.
- **Do not** version-bump `serverInfo.version` unless the change is breaking (removing/renaming a tool, removing a field). Adding a new tool is additive and needs no version bump. The drift test compares `serverInfo.version` to the version constant in `server.ts` — keep them identical either way.
- **Do not** add an e2e test per tool: tools cannot be called end to end. The e2e gate is the MCP suites plus the REST suites of the wrapped routes.

## Reference examples

Representative tools to copy from:

- **No args**: `tools/get-user-profile.ts`
- **Single filter + pagination**: `tools/get-accounts.ts`
- **Many optional filters + pagination + enum**: `tools/search-transactions.ts`
- **Conditional branch based on args**: `tools/get-balance-history.ts`
- **Consolidated read** (one call assembles a view from a service): `tools/get-budget-plan-period.ts`
- **Gated write** (scope, feature gate, base-currency lock, shared body schema): `tools/create-budget-plan-group.ts`
- **Lock-exempt write** (no `assertBaseCurrencyUnlocked`, with the REST route named in a comment; also feature-gated): `tools/delete-attachment.ts`
- **Read-only-allowed write** (`allowReadOnly: true`, listed in `READ_ONLY_ROUTE_TOOLS`): `tools/mark-notifications-read.ts`

Helpers available from `./helpers`:

- `getUserId({ extra })` — throws if unauthenticated
- `requireScope({ extra, scope, allowReadOnly? })` — scope check; rejects demo and read-only users unless `allowReadOnly` (only the `READ_ONLY_ROUTES` tools)
- `assertBaseCurrencyUnlocked({ userId })` — refuses while a base-currency change runs; fails closed if Redis is down
- `requireFeatureAccess({ extra, feature })` — refuses when the plan lacks the feature
- `enforceUserRateLimit({ userId, limit })` — draws from a per-user budget shared with the REST middleware
- `jsonContent({ data })` — wraps in MCP content envelope
- `assertOriginalCurrencyArgs({ args })` — the original-currency pair rule of the transaction tools
- `parseScopes({ scopes })` — only useful in auth-adjacent code, not individual tools

Analytics: `trackMcpToolUsed` lives at `@js/utils/posthog`. It's a no-op outside production.
