---
name: user-docs
description: Write or update the end-user documentation at docs.moneymatter.app (packages/docs, Astro Starlight) and capture its light/dark screenshots from the local dev app with a throwaway test user. Use when a feature is added or its UI/behaviour changes and the docs or screenshots need to follow, when asked to "update the docs", "add a docs page", "retake screenshots", or when `npm run screenshots:missing` lists gaps.
---

# User docs & screenshots

The docs site is `packages/docs` — a standalone npm project (not a root workspace). Articles are `src/content/docs/<section>/*.mdx`; screenshots are `public/screenshots/<section>/<name>.png` plus `<name>.dark.png`.

## Hard rules

- **Never use the `mcp__moneymatter__*` tools** for docs work. They act on the owner's real production account.
- **Never sign in as the owner or reuse their session.** Only the throwaway test user (`docs-test@example.com`), created by the seed script.
- **No direct database access.** The local DB also holds the owner's data. Create data through the API as the test user; reach unreachable states by mocking responses in the browser (see `mocks.mjs`), never by editing rows.
- Taking screenshots of the running app is the explicit purpose of this skill, so browser automation is allowed here — but only with the capture toolkit in `capture.md`, not for general "visual verification".
- No git commits.

## 1. Find what to change

- A feature changed: search the articles for its UI labels and route, e.g. `grep -rn "Plan & billing\|/settings/plan-billing" packages/docs/src/content/docs`. Every `<Screenshot src=…>` on those pages is a retake candidate.
- New feature: pick the section (sidebar groups autogenerate from directories, ordered by `sidebar.order` in frontmatter), or add a directory and a sidebar group in `astro.config.mjs`.
- `npm run screenshots:missing` (in `packages/docs`) lists every referenced screenshot that has no file, with its `alt` and `hint`.

## 2. Split the work

- **Writing** an article: read `writing.md` (this folder). **Capturing** screenshots: read `capture.md`. An agent that only writes never needs `capture.md`, and the reverse.
- **With subagents**, one agent per topic (a page or a few related ones). Brief each with the **Hard rules** above, only its own items from the audit or drift list, and the one file it needs; not this whole skill or the full list.
- **Budget ~60–80 tool calls per agent.** Each call re-reads the agent's whole context, so a 200-call agent costs several times a 70-call one. If a topic needs more, split it.
- **Batch reads:** several files or ranges in one Bash call (`sed -n '40,90p' a.vue; sed -n '1,60p' b.ts`), one `grep -E 'a|b|c'` instead of three greps, `npm run ui-label -- x y z` for several labels at once.

## 3. Finish

```bash
cd packages/docs
npm run screenshots:optimize   # palette PNG, rewrites in place; the Docker build runs it too
npm run screenshots:missing    # should be 0, or only what you deliberately left
npm run build                  # validates MDX and every internal link
```

Report which pages changed, which screenshots were (re)taken, any doc statements corrected against the code, and anything you mocked.
