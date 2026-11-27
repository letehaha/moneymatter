# Writing docs articles

Part of the `user-docs` skill. Its **Hard rules** in `SKILL.md` apply here too.

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
- **Fact-check every claim against the code**, not memory: behaviour from the component, limits and rules from the backend service. Drift found before: a button documented as "Select period" actually shows the chosen range ("Current month") unless the provider can't load history; a popover documented as listing per-account statuses only does so while a sync runs.
- **UI labels:** `npm run ui-label -- "<text or key prefix>" […]` in `packages/docs` prints the matching English strings (frontend chunks and backend), e.g. `npm run ui-label -- "Auto-Sync" pages.household.permissions`. Locale files are hook-blocked, and this is cheaper than a round-trip through the `i18n-editor` agent. To find where a label shows, grep the printed key in `packages/frontend/src` (`packages/backend/src` for `(backend)` ones).
