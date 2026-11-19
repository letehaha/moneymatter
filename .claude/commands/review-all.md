Run a comprehensive review of the current branch changes by spawning multiple reviewers in parallel, then fix what's relevant to the current feature.

## Steps

### 0. Activate ponytail ultra

Before anything else, invoke the `ponytail:ponytail` skill via the `Skill` tool with args `ultra`. It stays active for the whole command, including the fix phase.

### 1. Gather context

**Scope:** default to the **whole PR** (committed + uncommitted work vs `<base>`, as described below). If the user says to review only the uncommitted diff (e.g. "uncommitted", "working tree", "unstaged"), restrict the file list and diff to `git status --short` + `git diff HEAD` and skip the committed-changes step.

**Base branch:** default to `dev` (the integration branch), never `main`. If the user specified a different base branch in their invocation, use that instead. Everywhere below, `<base>` refers to this resolved branch.

Get the list of changed files on the current branch, covering **both committed and uncommitted** work:

- Committed changes since the branch diverged: `git diff <base>...HEAD --name-only`
- Uncommitted work (staged + unstaged + untracked): `git status --short`

When the branch sits on the current `<base>` tip, `git diff <base> --name-only` captures committed + staged + unstaged in one diff; add untracked new files from `git status`. But if `<base>` has advanced past the branch's merge-base, that two-dot diff pulls in unrelated base-only changes — diff against the merge-base instead: `git diff $(git merge-base <base> HEAD) --name-only`. Build the review diff from this combined set.

Determine:

- Whether frontend files (`packages/frontend/`) are affected
- Whether backend files (`packages/backend/`) are affected
- Whether shared files (`packages/shared/`) are affected
- Whether the iOS checkout exists: `IOS="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/../budget-tracker-ios"; test -d "$IOS/MoneyMatterMobile"`
- Store the full file list — you'll pass it to each reviewer's prompt

### 2. Spawn reviewers in parallel

Spawn the following reviewers using the `Agent` tool **in a single message with multiple tool calls** so they run concurrently. Each reviewer gets the **full changed file list** in its prompt.

**Always spawn:**

| Name                    | subagent_type                             | Role                                                                                                                      |
| ----------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `code-simplifier`       | `pr-review-toolkit:code-simplifier`       | Reuse opportunities, unnecessary complexity, dead code                                                                    |
| `code-reviewer`         | `pr-review-toolkit:code-reviewer`         | Project guidelines, style, best practices, naming, architecture                                                           |
| `test-analyzer`         | `pr-review-toolkit:pr-test-analyzer`      | Test coverage quality, missing tests, edge cases                                                                          |
| `silent-failure-hunter` | `pr-review-toolkit:silent-failure-hunter` | Silent failures, swallowed errors, bad fallbacks, missing error handling                                                  |
| `type-analyzer`         | `pr-review-toolkit:type-design-analyzer`  | Type design quality, encapsulation, invariant expression                                                                  |
| `architecture-analyzer` | `general-purpose`                         | Architecture deepening opportunities — invoke the `improve-codebase-architecture` skill and apply it to the changed files |

**Note for `architecture-analyzer`:** its prompt must explicitly instruct it to invoke the `improve-codebase-architecture` skill via the `Skill` tool first, then scope the resulting analysis to the changed files only (not the whole codebase). Findings should focus on architectural deepening opportunities introduced or worsened by the diff.

**Conditionally spawn (only if frontend files changed):**

| Name               | subagent_type     | Role                                                                                                                                              |
| ------------------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `frontend-checker` | `general-purpose` | Frontend conventions compliance — read `.claude/skills/frontend-rules/SKILL.md`, then review all changed frontend files against those conventions |

**Conditionally spawn (only if backend or `packages/shared/` files changed, and the iOS checkout exists):**

| Name                 | subagent_type     | Role                                                                                                                                                                    |
| -------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ios-compat-checker` | `general-purpose` | Backend API changes that break already-shipped iOS builds — read `.claude/docs/ios-api-compat.md`, then check every wire-facing change against the iOS sources it names |

**Note for `ios-compat-checker`:** its prompt must give it `<base>`, the resolved iOS path and the changed backend + shared files, and tell it to follow the doc's "How to check a candidate" steps and "Reporting" format (which replaces the format below). It is read-only in both repos. Every candidate gets a certain verdict from the Swift code, never "might break". If the iOS checkout is missing, don't spawn it and say so in the report.

Each reviewer's prompt should ask for findings in this format:

```
- **file:line** — description
```

If no issues found, the reviewer should report "No issues found."

### 2a. Large diffs: split reviewers by load

Skip this step for small diffs. Spawn the reviewers above, each with the whole diff.

1. **Filter mechanical files first.** Pull these out of the review set:
   - lockfiles
   - generated code
   - i18n locale JSON
   - pure renames/moves (`git diff -M --name-status`, `R100`)
   - test fixtures/snapshots

   One `haiku` agent gets the filtered list and only checks "is this really mechanical?" It flags anything that isn't, and that file goes back into the review set.

2. **Measure the real code.** Use `git diff --stat` on what's left.
3. **Split when it's too big for one agent.** The limit is roughly **25 files or ~1500 changed lines**, whichever hits first.
4. **What splits and how:**
   - `code-reviewer` and `silent-failure-hunter`: split **by area**. Slice along app boundaries (e.g. backend services, backend routes/controllers, frontend pages, frontend components, shared types). Keep each slice within the per-agent limit. Each agent gets its slice's diff plus the full file list for context.
   - `frontend-checker`: split **by rule group** (styling/colors/fonts, components, UI states/data flow). Also split by area if the frontend slice itself exceeds the limit.
   - `code-simplifier` and `test-analyzer`: split by area only if one agent's share would exceed ~2× the limit.
   - `type-analyzer` and `architecture-analyzer`: **never split**. They catch cross-file problems (coupling, duplicated invariants), and area slices hide those. On a large diff, give them the file list plus `git diff --stat` and let them read only what they need. Do not paste the full diff.
   - `ios-compat-checker`: **never split by area**. One changed model, enum or serializer reaches endpoints in several areas, and its load is the wire-facing subset (routes, controllers, serializers, models, shared types, error and auth code), not the diff size. Give it the backend + shared file list plus `git diff --stat`. Only if that subset alone exceeds the limit, split by route domain (the mounts in `setup-routes.ts`).
5. **Ceiling.** The hard ceiling is the session's workflow size guideline (currently under 50 agents). It is not a fixed small number.
6. **Confirm big runs.** If the plan needs more than ~15 agents, show the user the slices, the agent count and a rough token cost (~100k per reviewer). Ask before spawning.
7. **Flag oversized PRs.** If the real code after filtering still needs more than ~10 area slices, add a line to the final report suggesting the PR be split. Name the natural seams you saw.

### 3. Compile final report

Once all reviewers have returned, compile into a single organized report:

- **Code Simplification** — from code-simplifier
- **Code Quality** — from code-reviewer
- **Test Coverage** — from test-analyzer
- **Silent Failures** — from silent-failure-hunter
- **Type Design** — from type-analyzer
- **Architecture** — from architecture-analyzer
- **Frontend Rules Compliance** — from frontend-checker, or "N/A — no frontend changes"
- **iOS Compatibility** — from ios-compat-checker, or "N/A — no backend/shared changes", or "Skipped — iOS checkout not found at `<path>`". List `BREAKS`, `SAFE ON MAIN ONLY` and `UNDETERMINED` items in full; collapse `SAFE` ones into one line naming the endpoints checked.

For each section, list actionable items grouped by file. If a section has no issues, mark it as clean. At the end, add a **Summary** with total issue count per category. Put iOS `BREAKS` first in the Summary: they block the release however small the diff. Note that since reviewers ran independently, some findings may overlap across sections — call out duplicates in the summary. When reviewers were split (step 2a), merge each split reviewer's slices back into its own section, and dedupe findings that point at the same file and line.

### 4. Triage: strip findings unrelated to the current feature

Determine what the current feature is from the branch name, commit messages, and the diff. Then split every finding into:

- **In scope** — caused or touched by this branch's changes.
- **Out of scope, critical** — pre-existing bugs, security issues, data-loss risks, or broken behavior that this branch did not introduce. Keep only genuinely critical items here; drop non-critical out-of-scope findings entirely.
- **Out of scope, non-critical** — drop silently.

iOS compatibility findings never drop:

- `BREAKS` or `SAFE ON MAIN ONLY` caused by this branch is **in scope**, whatever the feature is.
- A mismatch that already exists on `<base>` is **out of scope, critical**.
- `UNDETERMINED` goes to the user in step 6 with the reason.

### 5. Fix in-scope findings

Fix every in-scope finding, deduplicated across sections. Use subagents (`opus`) for non-trivial code changes; pass them the `strip-code-comments` rules. After fixes, run the `linter` agent, and the `test-runner` agent for any affected backend e2e or frontend unit tests. Never commit.

If a finding is disputable (reviewer is wrong, or the fix would be a scope change), skip it and say why in the final report instead of fixing it.

**iOS compatibility findings** follow the policy in `.claude/docs/ios-api-compat.md`; pass that doc to the fixing subagent.

- Fix on the backend only. Never edit the iOS repo: shipped builds don't get the change.
- Fix additively: put the old field, endpoint or accepted input back beside the new one; restore an old status or error code and move the new information to an added field. Assert the kept contract in that endpoint's e2e test.
- Don't fix what can't be made additive: an intended behaviour change (e.g. editability rules), a new enum value in an existing field, a status or error code whose new value is the point, anything that needs client gating. Leave the code as is and carry it to step 6.

### 6. Final report

Three sections, in this order:

1. **Fixed** — what was changed, grouped by file, plus anything skipped with a one-line reason. Include lint/test results.
2. **iOS compatibility, needs decision** — every iOS finding not fixed in step 5. For each: the endpoint, what an old build does when it hits it (decode failure, wrong screen state, sign-out), and the options from the policy (new contract beside the old one, client gating, or accepting the break). If none, say so; if the reviewer did not run, say why.
3. **Critical, out of scope** — the out-of-scope critical findings from step 4, as a separate summary for the user to decide on. Do not fix these. If none, say so.
