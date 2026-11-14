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

Each MCP tool is a `defineTool` def wrapping an existing backend service:

```
Service (@services/...)
  ↓ called by run()
Tool def (packages/backend/src/services/mcp/tools/<name>.ts, `export const fooBarTool = defineTool({...})`)
  ↓ listed in
ALL_TOOLS (packages/backend/src/services/mcp/toolsets.ts), grouped by def.toolset
  ↓ registered by registerDefinedTool via
createMcpServer({ toolsets }) (packages/backend/src/services/mcp/server.ts)
```

`registerDefinedTool` (`define-tool.ts`) runs the guards, in this fixed order, then wraps the result:

```
getUserId → requireScope(finance:<access>) [write/delete] → requireFeature [feature] → assertBaseCurrencyUnlocked [lock] → trackMcpToolUsed → run → jsonContent({ data })
```

It also appends ` Requires finance:<access> scope.` to the description (plus the `conditionalDelete` path), wraps `input` in `z.strictObject` (built once per def) and sets `readOnlyHint: true` on reads and `destructiveHint: true` on deletes; writes leave `destructiveHint` unset, which the spec reads as destructive.

`npm run mcp:generate-metadata` (in `packages/backend`) generates these from `ALL_TOOLS`, `TOOLSET_DESCRIPTIONS`, `MCP_SCOPES_SUPPORTED` and `MCP_SERVER_INFO`; never edit them by hand:

- `packages/frontend/public/.well-known/mcp/server-card.json` — machine-readable tool list (each description is the first sentence of the def's)
- `scopes_supported` in `packages/frontend/public/.well-known/oauth-authorization-server` and `oauth-protected-resource`
- the tool tables between the `GENERATED TOOL TABLES` markers in `packages/frontend/public/skills/connect-moneymatter/SKILL.md`
- the `sha256` of that SKILL.md in `packages/frontend/public/.well-known/agent-skills/index.json`

## Checklist (complete every step)

When adding tool `my_new_tool`:

### 1. Create the tool file

Path: `packages/backend/src/services/mcp/tools/my-new-tool.ts` (kebab-case filename)

```typescript
import { FEATURES } from '@bt/shared/types'; // only for a feature-gated tool
import { recordId } from '@common/lib/zod/custom-types';
import { myService } from '@services/path/to/my-service';
import { z } from 'zod';

import { defineTool } from '../define-tool';

export const myNewToolTool = defineTool({
  name: 'my_new_tool',
  toolset: 'investments',
  access: 'write',
  feature: FEATURES.budget_plan, // only when the REST route has requireFeature
  description: 'What it returns and when an agent should call it. One sentence plus a hint on key fields.',
  input: {
    someId: recordId().describe('...'),
    optionalFilter: z.string().optional().describe('...'),
  },
  run: ({ userId, args }) => myService({ userId, ...args }),
});
```

Rules:

- Tool name is **snake_case**. The export is `<camelName>Tool`, the file `<kebab-name>.ts`.
- `input` is a **plain shape of Zod fields** (no outer `z.object(...)`). Omit it for a tool with no inputs.
- `run` gets `{ userId, args, extra }` and returns the data; never call `jsonContent`, `getUserId`, `requireScope`, `requireFeature`, `assertBaseCurrencyUnlocked` or `trackMcpToolUsed` for the def's own guards. Money instances serialize to decimals via `toJSON()`.
- `description` leaves out the `Requires finance:X scope.` sentence; it is appended from `access`. Its first sentence must stand alone: it is what the server card and the skill tables show.
- Argument checks go in `validate({ args })`: REST schema re-parses with refines, rules across fields, refusals that throw. It is pure (no guards, no I/O), runs after the guards and before `run`, and returns what `run` receives as `args`. The in-app chat runs it on a proposed call before the user approves the card, so a write or delete tool keeps no argument check in `run` (`tool-validate-drift`). Checks that are not about the arguments stay at the top of `run`: a conditional scope (`if (args.force) requireScope({ extra, scope: 'finance:delete' })`), `assertNotDemoUser({ extra })`, and anything that reads the database.
- Use `z.enum([...])` for enum args. Dates come in as ISO strings; convert with `new Date(args.date)` if the service expects a `Date`.

### Naming, access and guards

- **Names:** read tools start with `get_`, `list_`, `search_` or `preview_` and have `access: 'read'`; nothing else does (the `/mcp` route already requires `finance:read`).
- **Access:** `'write'` is the default. `delete_*` tools, and tools that permanently remove data without `delete_` in the name (`merge_payees`, `bulk_delete_*`), use `'delete'`, and the name goes into `DESTRUCTIVE_TOOLS` in `tool-scopes-drift.unit.ts` when it lacks the prefix. A soft delete that a restore tool undoes is `'write'`. A tool whose delete path is optional (`ignore_payee_name` with `force`) is `'write'`, checks `finance:delete` in `run`, names that path in `conditionalDelete` (`'with force'`), and goes into `CONDITIONAL_DELETE_TOOLS`.
- **Read-only and demo users:** the scope check rejects both, on every write and delete tool.
- **Base-currency lock:** `lock` defaults to `access !== 'read'` and follows the REST route's `checkBaseCurrencyLock`, not the tool's name. Set it only to override the default, with the route in a comment above it: `lock: false` for a write whose route has no lock (`delete_attachment`), `lock: true` for a read whose route carries it (`preview_transaction_automation`).
- **Feature gates:** `feature` where the route has `requireFeature`. Every budget-plan write needs `FEATURES.budget_plan` except `delete_budget_plan`, and goal writes need `FEATURES.goals`.

### Mirror the REST route

Every tool is a thin wrapper over the service its REST route uses. Parity with REST is the rule: the same service, validation, lock and feature gate, and the same serializer (slimmed for MCP in `serializers.ts` where the output is large). When a controller holds logic a tool needs (validation, orchestration), move it into a service or a shared schema that both the controller and the tool call. Never copy it into the tool.

**Refined inputs:** `input` is a plain shape, so a rule that spans fields (an either-or, a mutually exclusive pair, a `superRefine`) cannot sit in it. Use the shared schema's `.shape` as `input` and run the full shared schema in `validate`, on the schema's own fields only: when the tool adds ids beside a strict body schema, destructure them off first and return them with the parsed body (`const { planId, ...body } = args; return { planId, ...schema.parse(body) }`). The unit test asserts that the **tool** rejects, not the shape.

### 2. Add the def to `ALL_TOOLS` in `toolsets.ts`

Import it (alphabetical) and add it to `ALL_TOOLS`. Its `toolset` field decides where it is registered.

`core` is what every client loads, so it stays at 60 tools or fewer (`toolsets-drift`). Put a new tool in the optional toolset of its feature; it goes in `core` only when it's about accounts, transactions, categories, tags, payees or reports. A new toolset needs its id in `MCP_OPTIONAL_TOOLSETS` (`packages/shared/src/types/mcp.ts`), which gives it a `toolset:<id>` scope, plus its entry in `TOOLSET_DESCRIPTIONS` (`toolsets.ts`), its labels in `MCP_TOOLSET_LABELS` on the frontend, a row in the hand-written "Toolsets" table of the connect-moneymatter SKILL.md, and a row on the docs page.

### 3. Regenerate the metadata

```bash
cd packages/backend
npm run mcp:generate-metadata
```

It rewrites the server card, the OAuth mirrors, the SKILL.md tool tables and the SKILL.md `sha256`. Commit the regenerated files with the tool.

If the new tool introduces a new data convention (e.g. investments vs regular transactions), add a bullet under "Data conventions" in `packages/frontend/public/skills/connect-moneymatter/SKILL.md` (outside the generated region), then run the script again so the `sha256` follows.

### 4. Write the unit test and run the gate

Add `tools/<area>-tools.unit.ts` with the capture helper from `@tests/helpers/mcp-tools`, and `jest.mock` the services (their import chains open Redis connections at module scope):

```typescript
import { captureTools, makeExtra, parseToolResult } from '@tests/helpers/mcp-tools';

const [tool] = captureTools({ register: myNewToolTool });
const result = await tool.handler(
  { someId },
  makeExtra({ scopes: ['finance:read', 'finance:write'], features: [FEATURES.budget_plan] }),
);
```

For every tool, cover:

- the input schema accepts a valid input and rejects an invalid one (`tool.config.inputSchema!.safeParse(...)`; `.shape` for its keys);
- a write tool throws without its scope, while the lock is set (unless exempt), without the feature when gated, and when its limiter refuses, with the service mock not called, and for a read-only user;
- the handler calls the service with `userId` and the mapped arguments, and returns its result.

Run the gate:

```bash
cd packages/backend
npm run test:unit -- --testPathPattern='(services/mcp/|scripts/generate-mcp-metadata)'
```

It covers the drift suites and every tool unit test:

- `generate-mcp-metadata` (`src/scripts/generate-mcp-metadata.unit.ts`) — the committed server card, OAuth mirrors and SKILL.md equal what the generator produces, and the registry `server.json` matches the server version;
- `agent-skills-drift` — the SKILL.md sha256;
- `tool-scopes-drift` — `access`, `feature` and `lock` on the defs;
- `toolsets-drift` — every exported def in `ALL_TOOLS` once, `core` within its size, and the toolset scopes accepted by the OAuth provider;
- `tool-validate-drift` — no write or delete tool parses or asserts its arguments in `run`.

The chat's tool catalog (`services/mcp/tool-catalog.ts`) is built from `ALL_TOOLS`, so a new tool reaches it with no registration.

If any fail:

- **`Stale MCP metadata`** or **`sha256 matches`** → run `npm run mcp:generate-metadata`.
- **`every skill URL resolves`** → `SKILL.md` file path is wrong.
- **access, lock or feature case** → fix the def's field after checking its REST route, or list the name in `DESTRUCTIVE_TOOLS`.
- **registration case** → the def is exported but not in `ALL_TOOLS`.
- **toolset case** → `core` went over 60 tools.
- **`tool-validate-drift` case** → move the check from `run` into `validate` and have `run` use what it returns.

Delegate to the `test-runner` subagent (per CLAUDE.md rules).

**e2e:** the gate also runs the MCP e2e suites (`services/mcp/(connected-apps|mcp-scope-gate)`) plus the REST suites of the routes the tool wraps, in one batched run: `lockf -t 7200 /tmp/mm-e2e.lock npm run test:e2e -- --testPathPattern='...'`. Tools themselves cannot be called end to end, so a check that moves out of a controller into a service gets an e2e case first, run green against the unmoved code, and stays green after the move.

### 5. Lint check (optional but cheap)

Delegate to the `linter` subagent. Existing MCP tool files may show 4 `TS1005`-style errors from an `ioredis` env issue — that's pre-existing noise and not caused by new tools. Real errors look different (unused imports, mistyped service args, wrong Zod shape).

## Anti-patterns

- **Do not** run the def's own guards or `trackMcpToolUsed` inside `run`; `registerDefinedTool` does.
- **Do not** set `lock` to its default, or override it without reading the REST route.
- **Do not** copy controller logic into a tool. Move it into a service or shared schema that both call.
- **Do not** call services with `raw: true` or reach past the service layer. Use the `@services/*` function as-is.
- **Do not** add custom auth logic — all auth flows through the OAuth bearer token resolved by `extra.authInfo`.
- **Do not** version-bump `serverInfo.version` unless the change is breaking (removing/renaming a tool, removing a field). Adding a new tool is additive and needs no version bump. The version lives in `MCP_SERVER_INFO` (`server.ts`); the generator copies it into the card.
- **Do not** add an e2e test per tool: tools cannot be called end to end. The e2e gate is the MCP suites plus the REST suites of the wrapped routes.

## Reference examples

- **No args**: `tools/get-user-profile.ts`
- **Read with an argument branch**: `tools/get-tags.ts`
- **Many optional filters + pagination + enum**: `tools/search-transactions.ts`
- **Gated write with a REST re-parse**: `tools/update-budget-plan-group.ts`
- **Lock-exempt write**: `tools/create-attachment-upload-url.ts`, `tools/delete-attachment.ts`
- **Lock-guarded read**: `tools/preview-transaction-automation.ts`
- **Conditional delete scope**: `tools/ignore-payee-name.ts`

Helpers `run` may still use from `./helpers`: `requireScope` (conditional scopes only), `assertNotDemoUser`, `goalsForMcp`.
