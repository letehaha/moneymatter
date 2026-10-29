# Project Rules & Conventions

- **Backend work**: Read `.claude/docs/backend-conventions.md` before writing backend code
- **Frontend work**: Read `.claude/skills/frontend-rules/SKILL.md` before writing frontend code

## Testing Patterns

**CRITICAL**: E2E tests in this project NEVER call services directly. They ONLY make HTTP endpoint calls through the test helpers.

Examples:

- ❌ WRONG: `await syncHistoricalPrices(securityId)`
- ✅ CORRECT: `await helpers.createHolding({ payload: { portfolioId, securityId } })` (which triggers sync internally)
- ❌ WRONG: `await someService.doSomething()`
- ✅ CORRECT: `await helpers.makeRequestToEndpoint()`

Always test through the actual API endpoints to ensure full integration testing.

**CRITICAL: E2E Tests Required for New Backend Endpoints**

- Every new backend endpoint (route + controller + service) **MUST** include an e2e test before the work is considered complete.
- **Auto-trigger**: After implementing a new endpoint, automatically write e2e tests as the next step – don't wait to be asked.
- Minimum coverage: **happy path**, **empty state**, and at least one **error case**.
- Follow the `e2e-test-creator` skill conventions (`.claude/skills/e2e-test-creator/SKILL.md`) for structure and patterns.
- Run the tests automatically after writing them – do not wait for user confirmation.

**Bug Fix Workflow: Test-First Approach**

- When a bug is reported, do **NOT** start by trying to fix it.
- **First**, write a test that reproduces the bug (the test should fail) if it's suitable. For backend use e2e tests, for frontend if it's a util/composable write unit-test.
- **Then**, use subagents to fix the bug and prove it with a passing test.

**CRITICAL: Running Tests**

- **Run e2e tests automatically** after implementing changes that affect backend logic (new endpoints, bug fixes, refactors). Do not wait for user confirmation – just run them.
- **NEVER** use `npx jest` directly. Always use the npm scripts.
- **ALWAYS** use the `test-runner` subagent to run tests. The main agent must NEVER run tests directly.
- Backend e2e tests: `npm run test:e2e` from `packages/backend/`
- To run a specific test file: `npm run test:e2e -- --testPathPattern='<pattern>'`
- Example: `npm run test:e2e -- --testPathPattern='subscriptions/subscriptions.e2e'`
- **NEVER** run e2e tests in parallel (no concurrent test-runner agents for e2e). The Docker-based test environment does not support parallel runs. To test multiple files, combine them in a single `--testPathPattern` regex.
- Example (multiple files): `npm run test:e2e -- --testPathPattern='subscriptions/(subscriptions|matching-disambiguation).e2e'`

Other instructions:

1. File names should always be in kebab-case
2. All functions should _always_ use object-like params.
   - Never: function(arg1, arg2, arg3)
   - Always: function({ arg1, arg2, arg3 })
3. When planning the implementation don't limit yourself to 3-4 questions and 1 round.
   Ask as many questions with as many rounds as needed to collect all important information
4. Use this map of suagents for different tasks:
   - running any unit or e2e tests – use test-runner
   - running any linter – use linter
     – planning doing any websearch – use websearch
     – if asked to do any code review – use code-change-reviewer
5. **Tool Selection for Code Search:**

   **Use ast-grep when:**
   - Finding code patterns by **structure** (not just text):
     - Function calls with specific argument patterns
     - Class/interface definitions matching criteria
     - Conditionals without certain clauses (e.g., `if` without `else`)
   - **i18n migrations**: Distinguishing user-facing text from technical strings
     - Finds `<h1>Welcome</h1>` (needs i18n) vs `console.log('debug')` (doesn't)
     - Locates strings not wrapped in `$t()` or `t()`
   - **Refactoring**: Renaming/restructuring based on syntax tree
   - **Context-aware searches**: Code in specific syntactic positions

   **Use grep when:**
   - Simple literal searches (variable names, specific constants)
   - Cross-file-type searches (markdown, JSON, configs, code)
   - Exploratory searches (don't know exact structure yet)
   - Finding comments, documentation, string literals

   **Examples:**

   ```bash
   # ❌ Use ast-grep instead
   grep -r "useState" --include="*.tsx"  # Finds in comments, strings

   # ✅ Use ast-grep for structural search
   ast-grep --pattern 'useState($$$)' src/**/*.tsx

   # ✅ Use grep for simple search
   grep -r "API_ENDPOINT" --include="*.ts"

   # ✅ Use ast-grep for i18n
   ast-grep --pattern '<button>$TEXT</button>' src/**/*.vue
   ```

6. **Money Convention: `Money` class everywhere, decimals in API, decimals in Frontend**
   - The database stores monetary amounts as **cents** (INTEGER columns) or **decimal strings** (DECIMAL columns for investments).
   - All Sequelize models declare money fields with the `@MoneyField` decorator (from `@common/types/money-column`): `@MoneyField({ storage: 'cents' }) declare amount: Money;`. It registers attribute-level getters/setters that return `Money` instances (from `@common/types/money`). **Do NOT use `raw: true`** on queries that include Money fields – it bypasses getters and returns raw integers/strings instead of `Money`.
   - Use `Money` methods for all monetary operations:
     - Construction: `Money.fromCents(n)`, `Money.fromDecimal(n)`, `Money.zero()`
     - Arithmetic: `.add()`, `.subtract()`, `.multiply()`, `.divide()`, `.abs()`, `.negate()`
     - Output: `.toCents()` (for DB writes / cents arithmetic), `.toNumber()` (for API decimals), `.toJSON()` (auto-called by `res.json()`)
   - All API responses MUST return monetary amounts as **decimals** (not cents). `Money` auto-serializes via `toJSON()` in `res.json()`. For explicit conversion, use serializers with `centsToApiDecimal()` from `@common/types/money`.
   - Money fields on transactions: `amount`, `refAmount`, `commissionRate`, `refCommissionRate`, `cashbackAmount`
   - **Frontend ALWAYS works with decimals.** The API returns decimals, forms accept decimals, and the frontend sends decimals back. **NEVER** manually convert between cents and decimals in frontend code.
7. **i18n Files - use the `i18n-editor` subagent**
   - i18n locale files are BLOCKED from reading by the main agent (hook saves tokens) – always delegate to the `i18n-editor` subagent.
   - When a feature genuinely needs new translation keys (i.e. you just added a `$t('...')` reference that doesn't exist yet), proactively trigger the `i18n-editor` subagent to add them – do NOT ask for permission first. Briefly summarize what keys were added in your final response. Relay any glossary suggestions it reports; add the ones the user approves to `docs/i18n/glossary.json` (then `npm run i18n:crowdin:glossary` pushes them).
   - **`en` + `uk`, always together.** Every new or changed key is written to `en` and translated into `uk` in the same task, so `uk` never lags behind and needs no separate pre-release pass. Every other locale (`es`, `id`, `zh-CN`, `zh-TW`, anything added later) is community-translated in Crowdin – never write to those files; the next Crowdin download overwrites them.
   - Do NOT touch i18n files for unrelated work (don't "improve" existing translations, don't reorganize keys, don't bulk-translate English-only strings you encounter) – only add/update keys that the current task requires.
   - If a string's wording is non-obvious (e.g., domain terminology, formal vs. casual tone), ask the user for the copy before delegating to the subagent.
8. For Chrome extenstion use Brave browser, not Chrome
9. **Frontend env vars (`VITE_*`) must also be added to CI** – they are inlined at build time. Add as input + envkey in `.github/actions/frontend-docker-build/action.yml`, then pass the secret in `.github/workflows/image-to-docker-hub.yml`.
10. **CRITICAL: No Git Commits or Pushes**
    - **NEVER** run `git commit`, `git push`, or any command that creates commits or pushes to remote.
    - The user manages all git operations themselves. No exceptions.
11. **CRITICAL: Migrations – Modify Existing Before Creating New**
    - **NEVER** create a new migration file if you can modify an existing one that was created during the current development process and has **not been merged to `dev`** yet.
    - Check the current branch's unmerged migrations first (`git log dev..HEAD` or git status for new files). If the change logically belongs in an existing unmerged migration, update that migration instead of adding a new one.
    - Only create a separate migration when the existing one is already on `dev` or when the changes are genuinely unrelated.
    - `dev`, not `main`, is the line: once a migration is on `dev` it has run against other developers' and previews' databases, so amending it leaves those databases silently diverged from the file.
12. **VERY IMPORTANT: Stop Early When Stuck**
    - If something doesn't work as expected during implementation, you are allowed **1–2 attempts** to fix it.
    - After that – **STOP**. Do NOT keep trying workarounds, custom scripts, eval hacks, or speculative fixes.
    - Instead, **describe the problem to the user** and ask what to do next.
    - This applies to debugging, unexpected behavior, failing builds, type errors you can't resolve, etc.
    - Burning tokens on a long chain of guesses almost never helps. Asking the user is always better.
13. **Frontend Responsive Design: Container Width, Not Screen Width**
    - Most pages render inside a layout with a persistent sidebar, so the **content container is much narrower than the viewport** (e.g., a 768px screen leaves ~500px for content). Viewport-based breakpoints (`md:`, `lg:`, `@media (min-width: 768px)`, `window.innerWidth`, etc.) therefore fire at the wrong moments and produce broken layouts.
    - **Default to container-based responsiveness**: use Tailwind's container queries (`@container` + `@sm:`, `@md:`, `@lg:` variants), CSS `@container` queries, or `ResizeObserver` on the component's wrapper. Mark the nearest layout wrapper with `@container` so children can react to its actual width.
    - Only use screen/viewport breakpoints when the change genuinely depends on the **viewport itself** – sidebar collapse, mobile nav switch, top-level page shell. Inside a page, prefer container queries.
    - When in doubt, ask: "would this breakpoint behave correctly if the sidebar collapsed/expanded?" If no – it should be a container query.
14. **Comments describe current code, not history**
    - No "X was easy to trigger", "instead of quick-creating", "previously did Y", "replaced X with Y", "no longer". Comment must read cold – explain _why the current code is what it is_, standalone.
    - Change history goes in commits/PRs, not code.
    - Rare exception: if the abolished alternative is a footgun a future contributor will reach for, name it briefly as the **"abolished alternative"** – not "the old version".
    - Applies to backend, frontend, JSDoc, Vue templates, SQL migration headers.
15. **Dev server ports live in `.env.development.local`**
    - If the project root contains a `.env.development.local` file, the frontend and backend ports for the running dev servers are defined there (e.g. `VITE_PORT`, `APPLICATION_PORT`). Use those values when constructing URLs or hitting local endpoints.
    - Worktrees may use different ports than the main checkout – always read the worktree's own `.env.development.local`, do not assume the defaults from memory or other checkouts.
16. **Formatter is oxfmt – NEVER run Prettier**
    - Format with `npx oxfmt <files>`, check with `npx oxfmt --check <files>` (config: `.oxfmtrc.json`). Edits via Edit/Write are already auto-formatted by a hook.
    - Never run `prettier`/`npx prettier` in any form: it isn't installed, ignores `.oxfmtrc.json`, and rewrites whole files in a different style.
