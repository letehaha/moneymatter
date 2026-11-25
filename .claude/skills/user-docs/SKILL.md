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
- Taking screenshots of the running app is the explicit purpose of this skill, so browser automation is allowed here — but only with the capture toolkit below, not for general "visual verification".
- No git commits.

## 1. Find what to change

- A feature changed: search the articles for its UI labels and route, e.g. `grep -rn "Plan & billing\|/settings/plan-billing" packages/docs/src/content/docs`. Every `<Screenshot src=…>` on those pages is a retake candidate.
- New feature: pick the section (sidebar groups autogenerate from directories, ordered by `sidebar.order` in frontmatter), or add a directory and a sidebar group in `astro.config.mjs`.
- `npm run screenshots:missing` (in `packages/docs`) lists every referenced screenshot that has no file, with its `alt` and `hint`.

## 2. Write the article

- Match the existing articles: second person, short paragraphs, UI labels in **bold** exactly as the English UI shows them, numbered procedures inside `<Steps>`.
- Plus-only features: `sidebar: { badge: { text: 'Plus', variant: 'tip' } }` in frontmatter and `<Badge text="Plus" variant="tip" />` inline.
- Screenshot tag — `alt` is what the image actually shows; `hint` tells a human how to recapture it:
  ```mdx
  <Screenshot
    src="/screenshots/settings/change-password.png"
    alt="The Password tab with the current, new and confirm password fields filled in, the strength meter, and the password requirements box."
    hint="Open /settings/security/password… Crop to the tab content."
  />
  ```
- **Fact-check every claim against the code**, not memory: labels from `packages/frontend/src/i18n/locales/chunks/en/**` (read via the `i18n-editor` agent — locale files are hook-blocked), behaviour from the component, limits and rules from the backend service. Drift found before: a button documented as "Select period" actually shows the chosen range ("Current month") unless the provider can't load history; a popover documented as listing per-account statuses only does so while a sync runs.

## 3. Capture screenshots

Prerequisites: the dev frontend and backend are running (ports come from the root `.env.development.local`: `PORT`, `APPLICATION_PORT`), root `npm install` done (Playwright resolves from the root `node_modules`).

```bash
cd packages/docs
npm run screenshots:seed
```

The seed is idempotent. It signs up or signs in the test user, sets USD as base currency, connects **SimpleFIN's public demo** (Savings + Checking with real-looking synced transactions), creates the manual **Everyday Checking** account with three expenses, attaches a fake receipt JPG and invoice PDF to "Office chair", adds a passkey through a virtual authenticator, dismisses Quick Start, adds the Net Worth widget and saves the session to `scripts/capture/.state.json`. `DOCS_USER_EMAIL=… npm run screenshots:seed` seeds a separate user.

Then write a small per-shot script in your scratch/temp directory (not in the repo) importing the toolkit by absolute path:

```js
import { APP, bothThemes, clipAround, innermost, open, shot } from '<repo>/packages/docs/scripts/capture/helper.mjs';
import { ENTITLEMENTS, mockEntitlements } from '<repo>/packages/docs/scripts/capture/mocks.mjs';

const { browser, page } = await open({ height: 1300 });
await page.goto(APP + '/settings/security/password');
await page.getByPlaceholder('Enter new password').fill('Correct-Horse-42!');
const card = innermost({ page, has: ['Security Settings', page.getByText('Password requirements')] });
await bothThemes({
  page,
  capture: ({ dark }) => shot({ page, target: card, src: '/screenshots/settings/change-password.png', dark }),
});
await browser.close();
```

Conventions:

- **Always both themes** via `bothThemes`; it emulates the OS color scheme, which the app follows.
- **Element crops** pass `target` (30px padding so shadows and rounded corners show). Several elements (trigger + popover, header + strip) → `clip: await clipAround({ locators: [...] })`. Full window only when the hint says so.
- Default viewport 1440×1000 at 2× scale. If `shot` says the target is taller than the viewport, `open({ height: 1300 })`.
- **Open every image you wrote with the Read tool** before moving on: check the crop edges (no half-cut cards, no sidebar or header slivers), stray toasts, broken logos, and that it matches the `alt`.

### Reaching specific states

| State                                                           | How                                                                                                                                                                                                                |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| First run (`/welcome`, empty dashboard with Quick Start)        | Use a fresh `DOCS_USER_EMAIL`; sign up with `open({ fresh: true })` and capture before running the seed (the seed confirms the currency and dismisses Quick Start).                                                |
| Bank connection, synced transactions, bank-synced edit dialog   | Seeded SimpleFIN demo.                                                                                                                                                                                             |
| Link a manual account to a bank                                 | Seeded **Everyday Checking** + the demo's unconnected account. Open the dialog, never submit it.                                                                                                                   |
| Another active session                                          | Second `chromium.launch()` context with an iPhone Safari `userAgent` that signs in, then capture the sessions tab from the main context.                                                                           |
| Active subscription, trial ended / read-only                    | `mockEntitlements({ page, entitlements: ENTITLEMENTS.activePlusYearly() })` or `ENTITLEMENTS.trialEnded()`; for the "See plans" toast add `mockPlanRequiredOnSave({ page })` and save an edit.                     |
| Plus-only feature offering its day trial (Analytics, Watchlist) | `mockEntitlements({ page, entitlements: ENTITLEMENTS.essentialNoTrials() })`                                                                                                                                       |
| Enable Banking consent expiring/expired                         | `mockEnableBankingConsent({ page, connectionId, daysLeft })` on the seeded SimpleFIN connection.                                                                                                                   |
| Anything else unreachable                                       | Find the response the component reads (its store or `useQuery`), rewrite just that response with `page.route` → `route.fetch()` → `route.fulfill({ response, json })`. Add it to `mocks.mjs` if it will be reused. |

### Gotchas

- Sign-up always lands on "Check your email", but with `RESEND_API_KEY` empty the account can sign in immediately.
- Never wait for `networkidle`: the app keeps an SSE stream open. Use `locator.waitFor()` plus short fixed waits.
- `getByText` matches the sidebar first (account names, "SimpleFIN"); scope with `innermost`, `.last()`, or a nearby unique text.
- `getByText` does not see `<textarea>`/`<input>` values — target the field element.
- Select triggers can lose their `combobox` role once open; take bounding boxes before clicking.
- Headless Chrome's default user agent gets bank/brand logos blocked; `open()` already sets a normal one.
- Background toasts (e.g. "AI provider rate limit reached") can land in a frame — close them or retake.

## 4. Finish

```bash
cd packages/docs
npm run screenshots:optimize   # palette PNG, rewrites in place; the Docker build runs it too
npm run screenshots:missing    # should be 0, or only what you deliberately left
npm run build                  # validates MDX and every internal link
```

Report which pages changed, which screenshots were (re)taken, any doc statements corrected against the code, and anything you mocked.
