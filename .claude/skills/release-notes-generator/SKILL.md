---
name: release-notes-generator
description: Generates GitHub release notes by comparing commits since the last tag. Use when user says "prepare release", "release notes", "next release", "release text", "prepare next release text", or "create release".
allowed-tools: Bash, Read, Skill
---

# Release Notes Generator

Generates formatted release notes for the next GitHub release by analyzing commits and PRs since the last tag, following the project's established release format.

## Mode

This skill is a **direct execution workflow** — no questions needed. Gather all context from git history and PRs, produce the release text, then run it through the `stop-slop` skill (Step 6) before showing it to the user.

## When to Use

- User asks to prepare release notes or release text
- User mentions "next release", "prepare release", "release notes"
- User wants to create a new GitHub release

## Instructions

### Step 1: Determine Last Release

Run these commands to identify the latest release tag and its format:

```bash
# Get the latest tag
git tag --sort=-creatordate | head -1

# View the latest release body to match its format
gh release view <latest-tag>
```

Also view 1-2 previous releases to understand the format pattern.

### Step 2: Collect Changes Since Last Release

```bash
# All commits (including merges) since last tag
git log <latest-tag>..HEAD --oneline

# Non-merge commits only — these are the primary source of truth for understanding changes
git log <latest-tag>..HEAD --oneline --no-merges

# Merged PRs with authors and URLs (needed for the Code Changes section)
gh pr list --state merged --base dev --limit 30 --json number,title,url,author,mergedAt | jq -r '.[] | "#\(.number) @\(.author.login) \(.mergedAt) \(.title) \(.url)"'
```

Feature and fix PRs are merged into `dev`; the only PR with `--base main` is the
`Release vX.Y.Z` PR itself, which is the release being written up rather than a
change within it.

Filter PRs to only those merged AFTER the latest tag date.

### Step 3: Understand Changes

For each PR, use a **priority chain** to understand what changed:

1. **PR description** (check first) — if the PR body is non-empty, use it as the primary source
2. **Commit messages** (fallback) — if PR description is empty, read the commit messages within that PR
3. **Diff stat** (last resort) — if commits are also unclear, check the changed files

```bash
# Check PR description first
gh pr view <number> --json title,body

# If empty, read commit messages
git log <latest-tag>..HEAD --oneline --no-merges

# Last resort — check what files changed
git show <commit-hash> --stat
```

Categorize by commit prefix:

- `feat:` commits = new user-facing functionality
- `fix:` commits = bug fixes
- `refactor:` / `chore:` commits = internal improvements

For `fix:` commits, the priority chain above is **not enough** — it tells you what was changed, not who the bug hit. Before writing the fix line, also check the linked issue (`gh issue view <n>`, often referenced as "Closes #N" in the PR body) and, when the condition is still unclear, read the actual call site to see when the broken path was taken. See the bug-fix scope rule under Format rules — a fix line that can't name the affected flow and condition isn't ready to ship.

#### Collect credits (mandatory)

Releases regularly include work from other people. Never assume a PR is by `@letehaha`; build the credit list from data:

1. **PR authors**: take `@author` from the Step 2 PR list for every PR. That login goes in its Code Changes line.
2. **First-time contributors**: for every author other than `letehaha`, check whether a PR of theirs was merged before this release:
   ```bash
   gh pr list --state merged --author <login> --limit 100 --json number,mergedAt --jq 'sort_by(.mergedAt)|.[0]|"#\(.number) \(.mergedAt)"'
   ```
   If their earliest merged PR is in this release, list them under `## New Contributors` with that PR.
3. **Bug reporters**: every issue or discussion referenced by a PR body or a commit message ("Closes #N", "Fixes #N", "Refs discussion #N") has a reporter. This includes commits pushed to `dev` without a PR. Find each reporter:
   ```bash
   git log <latest-tag>..HEAD --no-merges --format='%h %B' | grep -iE '#[0-9]+'
   gh issue view <n> --json author --jq .author.login
   gh api graphql -f query='{repository(owner:"letehaha",name:"moneymatter"){discussion(number:<n>){author{login}}}}' --jq .data.repository.discussion.author.login
   ```
   Skip `letehaha`. Thank everyone else at the end of the matching fix or feature line: `Thanks to @<login> for the report.`

Present this credit list to the user next to the notes (Step 8), so a missing name is easy to spot.

Group changes into these categories (skip empty ones):

1. **Feature highlights** — new user-facing functionality (describe what it does for the user, not the code)
2. **Bug fixes** — fixes to existing behavior
3. **Other improvements** — SEO, performance, refactoring, chore work

### Step 4: Determine Release Version

- Look at the latest tag (e.g., `v0.10.6`)
- **Default: always increment the patch version** (e.g., `v0.10.6` → `v0.10.7`), regardless of the scope of changes.
- **Only bump minor or major when the user explicitly asks for it** in their request (e.g., "minor bump", "make it a minor release", "major release"). Do NOT decide this on your own.
- **Exception — strong candidate for a bigger bump**: if the release is a clear, strong candidate for more than a patch (e.g., a major new user-facing feature or a breaking change), still generate the notes with the patch version by default, but add a short note to the user suggesting it might warrant a minor/major bump and letting them decide. Do not apply the bigger bump unless they confirm.

**Bump the app version.** Set `"version"` in `packages/frontend/package.json` to the new version without the `v` prefix (e.g. `"0.10.7"`). The UI shows this value, and it has to be committed before the `Release vX.Y.Z` PR merges: the image for the merge commit is built from it. Edit the file only; the user commits it.

### Step 5: Generate Release Text

Follow the **exact format** observed from recent releases. The format is:

```markdown
## What's Changed

### [Feature/Section Title]

[2-4 sentence description of the main feature, written for end users — what it does, how to use it]

### [Another Section if needed]

[Description]

### Bug Fixes / Other Improvements (if applicable)

- [Concise description of fix/improvement]
- [Another one]

### Code Changes

- [commit type]: [PR title] by @<pr-author-login> in [PR URL]
- [repeat for each PR]

## New Contributors

- @<login> made their first contribution in [first PR URL]

**Full Changelog**: https://github.com/letehaha/moneymatter/compare/<previous-tag>...<new-tag>
```

**Format rules:**

- Use `##` for the top "What's Changed" heading
- Use `###` for section titles within
- **Add a relevant emoji before each `###` section title** to visually separate features. Pick emojis that match the feature's purpose (e.g., 🔔 for notifications, 🔗 for linking, 👀 for monitoring, ✨ for improvements, 📝 for code changes).
- Feature descriptions should be user-facing (what changed for the user, not code details)
- **Product name**: Always refer to the product as **MoneyMatter**, never "Budget Tracker" or "budget-tracker". The first mention in the release notes must be a markdown link: `[MoneyMatter](https://moneymatter.app)`. Subsequent mentions can be plain "MoneyMatter".
- **Write for a non-technical reader. Describe the outcome, not the implementation.** The audience includes developers, but it is not written for them — someone who just uses the app to track money must understand every sentence without knowing how it was built. Describe what the user now experiences or can do; never how it was achieved.
  - Do NOT name technologies, storage layers, or mechanisms: no "IndexedDB", "cached locally", "request", "round trip", "endpoint", "query", "index", "payload", "SSE", "chunk", "bundle", "zod", "schema", "migration", "DB connections", "client-side", "server-side".
  - Do NOT quantify internals: no "loads from a single request instead of many", "reduced from N calls to 1", "deferred to idle".
  - Say the felt effect instead. Examples of the rewrite:
    - ❌ "Dashboard widgets that used to fan out into many requests now load from a single one and slice the data in the browser, and lists are cached locally so returning to a page is instant instead of a fresh round trip."
    - ✅ "The dashboard loads faster, and pages you visit often now open instantly."
    - ❌ "Fixed stale asset errors after a new version deploys by hardening frontend chunk preload."
    - ✅ "The app no longer breaks after a new version ships — it picks it up cleanly."
    - ❌ "Coerce resourceId string to number in the zod schema."
    - ✅ "Household invitations no longer fail with an error."
  - Performance work in particular: state that the affected screens are faster and leave it there. A list of what was optimized under the hood is implementation detail, however impressive.
  - Rule of thumb: if a sentence would only make sense to someone who has seen the code, rewrite it or drop it.
- **Bug-fix lines must state the real scope of the bug — never a bare "X no longer fails".** Plain language (rule above) means dropping the _mechanism_, not the _facts_. A line like "Household invitations no longer fail with an error" is useless: it doesn't say who was affected, under what conditions, or whether the reader hit it — and it implies the whole feature was broken when usually only one path was.
  - Before writing any fix line, establish from the issue, PR body, or the code itself: **which flow broke**, **under what condition** (always for that flow? only cross-currency? only on mobile? only after a specific action?), and **what was _not_ affected**. Do not guess this from the commit subject — read the call site.
  - Then write the line so a user can tell whether it applied to them:
    - ❌ "Household invitations no longer fail with an error." — vague; implies all sharing was broken
    - ✅ "Inviting someone to your household no longer gets rejected as invalid input. Sharing individual accounts and budgets was never affected."
    - ❌ "Fixed transaction list loading." — which list, when?
    - ✅ "The transactions list on mobile no longer gets stuck loading when you scroll past the first page."
  - Precision about **when** something broke matters as much as what: if it only happened in a specific situation, say the situation. If it happened every time for that flow, it's fine to say so plainly — but verify that's true rather than assuming.
  - Naming the user-visible error text ("rejected as invalid input", "stuck loading") is good — that's what the user saw. Naming the cause ("zod schema", "string vs number coercion") is not — that's implementation.
- **NEVER mention baseline / table-stakes work in release notes.** These are expected and invisible to users — calling them out as features is noise. Do NOT write things like:
  - "translations for both languages are in place" / "i18n added" / "localization shipped"
  - "tests added" / "test coverage" / "e2e tests updated"
  - "types added" / "TypeScript types"
  - "accessibility improvements" (unless the release is explicitly _about_ an a11y overhaul)
  - "code refactored" / "cleanup" / "linting fixed"
  - "docs updated" / "comments added"
  - CI/build/deploy internals unless user-visible
    Release notes answer exactly two questions: **what's new** and **what's fixed**. If something doesn't change user experience, it doesn't belong. When in doubt, leave it out.
- **Order sections by user impact, not by technical scope.** The top of the release notes should be what end users care about most (visual changes, new UI features, new product capabilities). Dev-oriented or infrastructure-adjacent features (MCP metadata endpoints, `.well-known/` files, OAuth discovery, AI agent discoverability, API metadata, build/deploy improvements that _are_ user-visible but niche) belong **lower** in the document — after primary user features.
- **Release title selection**: The title should highlight the **biggest user-facing feature(s)**, not dev/infrastructure work. Never put dev-oriented features (like "AI discoverability," ".well-known endpoints," "OAuth metadata," "MCP server card") in the title unless that _is_ the headline release. Prefer user-visible features in the title: new UI, new workflows, new user-visible AI capabilities (e.g., categorization, tools the user interacts with).
- **When multiple related features fall under the same theme, use an umbrella phrase** in the title instead of naming just one. Example: if a release ships custom AI categorization _and_ investments MCP tools _and_ AI discoverability, the title should say "improved AI workflows" (covers all three) rather than "smarter AI categorization" (covers only one, undersells the rest). Umbrella phrases also scale better when contents shift late in the release cycle.
- If there's a single dominant feature, it can be the main section title (see v0.10.6 "Walutomat Integration" as reference)
- The "Code Changes" section lists all PRs with links, each credited to its real author from the credits list (never a hardcoded `@letehaha`)
- Include `## New Contributors` only when someone made their first contribution in this release
- Fix and feature lines that came from an outside report end with `Thanks to @<login> for the report.`
- Always end with the Full Changelog compare link
- Skip `chore:` commits from feature descriptions (but still list in Code Changes)

### Step 6: De-slop the Prose (mandatory)

Release notes go out to every user, so the draft gets an editing pass before anyone sees it.

**Invoke the `stop-slop` skill** (`Skill` tool, `skill: "stop-slop"`) and apply its rules to the draft from Step 5. This step is not optional and not something to approximate from memory — load the skill and follow what it says.

Run the pass over the **prose only**: section titles, feature descriptions, and bug-fix lines. Leave these alone:

- The "Code Changes" list — commit prefixes, PR titles, and URLs are verbatim by design
- The Full Changelog link
- Product/brand names and the required `[MoneyMatter](https://moneymatter.app)` link

Watch for the patterns that show up most in release notes specifically:

- Em dashes joining two clauses. Split the sentence or use a colon.
- Passive voice hiding who acted: "the countdown was fixed" → "the countdown now counts down correctly".
- Inanimate subjects doing human verbs: "the dashboard now understands your filters".
- Marketing adjectives: "seamless", "robust", "comprehensive", "powerful", "significantly".
- Three-beat lists where two items would do.
- Throat-clearing openers: "This release introduces…", "We've also added…".

Where a stop-slop rule collides with a rule from Step 5, **Step 5 wins**. In particular, keep the bug-fix scope requirement (which flow, under what condition, what was unaffected) even when stop-slop's density rule tempts you to cut it — specificity is the point of both rules.

Report the edit briefly to the user after Step 8: what you cut, and the stop-slop score.

### Step 7: Suggest Release Title

Suggest a title following the pattern: `v<version> – <short description>`

Examples from past releases:

- `v0.10.6 – Walutomat integration`
- `v0.10.5 – "Balance Trend" spikes markers`
- `v0.10.4 - Stats on budget's details page`

### Step 8: Present to User

Output the release text as a markdown code block so the user can copy it directly. Also state the suggested release title separately, and list the credits from Step 3 (PR authors other than `letehaha`, new contributors, reporters thanked).

Remind the user that the `packages/frontend/package.json` version bump from Step 4 must be committed to the `Release vX.Y.Z` PR before it merges.

**Do NOT create the release.** Only prepare the text and let the user decide when to publish.

## Examples

### Example 1: Feature-heavy release

User says: "prepare next release text"
Actions:

1. Find latest tag `v0.10.6`
2. Collect 6 PRs merged since then
3. Read commit messages: `feat: complete portfolio transfers`, `fix: balance trend calculation`, etc.
4. Identify portfolio transfers as main feature, several bug fixes
5. Generate formatted release text with feature description + bug fix list
   Result: Markdown release text + suggested title `v0.10.7 – Portfolio transfers & stats fixes`

### Example 2: Bug-fix-only release

User says: "create release notes"
Actions:

1. Find latest tag, collect changes
2. Read commit messages — all are `fix:` and `chore:` prefixed
3. No major features, only fixes
4. Use `[chore]` prefix in title, simpler format
   Result: Release text with bug fix list + suggested title `[chore] v0.10.8 – Bug fixes and improvements`

## Troubleshooting

### No commits found since last tag

Cause: HEAD is at the same commit as the latest tag
Solution: Inform the user there are no changes to release.

### `gh` command not found

Cause: GitHub CLI not installed
Solution: Ask user to install via `brew install gh`.
