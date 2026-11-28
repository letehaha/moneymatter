# Capturing screenshots

Part of the `user-docs` skill. Its **Hard rules** in `SKILL.md` apply here too.

## Web app

Prerequisites: the dev frontend and backend are running (ports come from the root `.env.development.local`: `PORT`, `APPLICATION_PORT`), root `npm install` done (Playwright resolves from the root `node_modules`).

```bash
cd packages/docs
npm run screenshots:seed
```

The seed is idempotent. It signs up or signs in the test user, sets USD as base currency, connects **SimpleFIN's public demo** (Savings + Checking with real-looking synced transactions), creates the manual **Everyday Checking** account with three expenses, attaches a fake receipt JPG and invoice PDF to "Office chair", adds a passkey through a virtual authenticator, dismisses Quick Start, adds the Net Worth widget and saves the session to `scripts/capture/.state.json`. `DOCS_USER_EMAIL=… npm run screenshots:seed` seeds a separate user.

Then write a small per-shot script in your scratch/temp directory (not in the repo) importing the toolkit by absolute path:

```js
import { APP, bothThemes, clipAround, innermost, run, shot } from '<repo>/packages/docs/scripts/capture/helper.mjs';
import { ENTITLEMENTS, mockEntitlements } from '<repo>/packages/docs/scripts/capture/mocks.mjs';

await run({
  height: 1300,
  steps: async ({ page }) => {
    await page.goto(APP + '/settings/security/password');
    await page.getByPlaceholder('Enter new password').fill('Correct-Horse-42!');
    const card = innermost({ page, has: ['Security Settings', page.getByText('Password requirements')] });
    await bothThemes({
      page,
      capture: ({ dark }) => shot({ page, target: card, src: '/screenshots/settings/change-password.png', dark }),
    });
  },
});
```

`run` closes the browser either way and makes waits time out after 6s (navigation 30s), so a wrong locator fails fast instead of hanging for 30s. On failure the error names a `scripts/capture/.failures/<time>.png` (the viewport) and `.txt` (URL + aria tree of the page): read the `.txt` first to fix the locator, the `.png` only if the tree doesn't explain it. Pass a longer `{ timeout }` to the single wait that needs it (a bank sync, a slow chart).

Conventions:

- **Always both themes** via `bothThemes`; it emulates the OS color scheme, which the app follows.
- **Element crops** pass `target` (30px padding so shadows and rounded corners show). Several elements (trigger + popover, header + strip) → `clip: await clipAround({ locators: [...] })`. Full window only when the hint says so.
- Default viewport 1440×1000 at 2× scale. If `shot` says the target is taller than the viewport, `run({ height: 1300, … })`.
- **Check every image you wrote** with `npm run screenshots:check` (in `packages/docs`): it writes one small light|dark sheet per screenshot to `scripts/capture/.check/` (the `src`s you pass, or every screenshot written in the last 120 min; `--since <min>` to change; pass your own `src`s when other agents capture in parallel) and flags a missing file, a missing theme or a light/dark size mismatch (exit code 1). Read the sheets, not the full-size PNGs: check the crop edges (no half-cut cards, no sidebar or header slivers), stray toasts, broken logos, and that it matches the `alt`. Open the full-size file only to settle a detail the sheet is too small to show.

## Reaching specific states

| State                                                                | How                                                                                                                                                                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| First run (`/welcome`, empty dashboard with Quick Start)             | Use a fresh `DOCS_USER_EMAIL`; sign up inside `run({ fresh: true, … })` and capture before running the seed (the seed confirms the currency and dismisses Quick Start).                                            |
| Bank connection, synced transactions, bank-synced edit dialog        | Seeded SimpleFIN demo.                                                                                                                                                                                             |
| Link a manual account to a bank                                      | Seeded **Everyday Checking** + the demo's unconnected account. Open the dialog, never submit it.                                                                                                                   |
| Another active session                                               | Second `chromium.launch()` context with an iPhone Safari `userAgent` that signs in, then capture the sessions tab from the main context.                                                                           |
| Active subscription, trial ended / read-only                         | `mockEntitlements({ page, entitlements: ENTITLEMENTS.activePlusYearly() })` or `ENTITLEMENTS.trialEnded()`; for the "See plans" toast add `mockPlanRequiredOnSave({ page })` and save an edit.                     |
| Plus-only feature offering its day trial (Analytics, Watchlist)      | `mockEntitlements({ page, entitlements: ENTITLEMENTS.essentialNoTrials() })`                                                                                                                                       |
| Pending share invitation, no dev "Email sending not configured" line | `mockInvitationEmailConfigured({ page })` (also shows the Resend button, as in production).                                                                                                                        |
| Enable Banking consent expiring/expired                              | `mockEnableBankingConsent({ page, connectionId, daysLeft })` on the seeded SimpleFIN connection.                                                                                                                   |
| Anything else unreachable                                            | Find the response the component reads (its store or `useQuery`), rewrite just that response with `page.route` → `route.fetch()` → `route.fulfill({ response, json })`. Add it to `mocks.mjs` if it will be reused. |

## Gotchas

- Sign-up always lands on "Check your email", but with `RESEND_API_KEY` empty the account can sign in immediately.
- Never wait for `networkidle`: the app keeps an SSE stream open. Use `locator.waitFor()` plus short fixed waits.
- `getByText` matches the sidebar first (account names, "SimpleFIN"); scope with `innermost`, `.last()`, or a nearby unique text.
- `getByText` does not see `<textarea>`/`<input>` values — target the field element.
- Select triggers can lose their `combobox` role once open; take bounding boxes before clicking.
- Headless Chrome's default user agent gets bank/brand logos blocked; `run()` and `open()` already set a normal one.
- Background toasts (e.g. "AI provider rate limit reached") can land in a frame — close them or retake.

## iPhone screenshots (`<Screenshot phone …>`)

Taken in the iOS Simulator, not a real phone, by an agent working in the iOS repo (`$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/../budget-tracker-ios`; follow its `CLAUDE.md`, change no iOS code, no commits).

- **Device:** iPhone 17 on the newest iOS runtime. Its 1206×2622 output matches the existing `public/screenshots/iphone/*` shots; open a sibling shot first to match framing.
- **App:** `xcodegen generate`, then `xcodebuild … -destination 'platform=iOS Simulator,id=<udid>' build` and `xcrun simctl install`. Installing the app is what makes its App Intents (e.g. **Log Payment Message**) show in Shortcuts. Stop if the build or install fails: the simulator keeps the old build and you would screenshot it.
- **Status bar:** `xcrun simctl status_bar <udid> override --time 09:41 --cellularBars 4 --wifiBars 3 --batteryState charging --batteryLevel 100`.
- **Drive the UI** with the `axe` CLI (`/opt/homebrew/bin/axe`: `describe-ui`, `tap`, `type`); don't install other tools.
- **Themes:** `xcrun simctl ui <udid> appearance light|dark`, capture with `xcrun simctl io <udid> screenshot <file>`, write `<name>.png` and `<name>.dark.png`.
- **Simulator limits:** only Apple apps and MoneyMatter are installed, so there are no bank apps. When a shot needs a third-party app (a notification trigger, say), use the closest Apple app and blur its name and icon afterwards with `sharp` (`extract` the pill → `blur(14)` → `composite` back), in both themes. Done this way: `iphone/notification-automation-done.png`.
- Then `npm run screenshots:optimize` in `packages/docs` as usual.
