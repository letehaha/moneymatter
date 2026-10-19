---
name: frontend-rules
description: Frontend conventions and component usage rules. Read before writing any frontend code. Covers styling, component library, data flow, and UI patterns. Trigger on "/frontend-rules" or when starting frontend work.
allowed-tools: Read, Grep, Glob
---

# Frontend Rules & Conventions

Reference guide for all frontend code in `packages/frontend/`. Read this before writing or modifying frontend components.

---

## General

- All file names use **kebab-case** (e.g., `reminder-form-dialog.vue`, `use-submit-transaction.ts`)
- All components use `<script setup lang="ts">`
- Use **TypeScript** — no `any` unless absolutely unavoidable
- Use **`date-fns`** for all date formatting and manipulation. Never use raw `Date` methods or other date libraries
- **Magic numbers**: when a numeric literal's meaning isn't obvious from context, extract it into a descriptive constant (e.g., `const MAX_VISIBLE_TAGS = 5`). Simple, self-evident values (array indices, `0`/`1` checks, common multipliers, etc.) are fine inline — use your judgement

---

## Project Structure

### API layer

All API call functions live in `src/api/`. Components and composables must import from there — never inline `fetch` or `axios` calls directly in components.

### Component placement

- **Shared / reusable** components go in `components/common/` or `components/lib/`
- **Page-specific** components go in `pages/<feature>/components/`

### Route constants

Route paths are defined as constants in `routes/constants.ts`. Always use those constants for `router.push()` and `<RouterLink :to="...">`. **Never** hardcode path strings.

### Responsive breakpoints

The project defines `CUSTOM_BREAKPOINTS` and provides the `useWindowBreakpoints` composable. Use those for JS-based responsive logic — never use custom media queries or magic pixel values.

### Container queries for content-area layout

The app has a ~300px sidebar visible on screens wider than 768px, so the **content area is significantly narrower than the viewport** (e.g., 900px screen = ~600px content). Viewport breakpoints (`md:`, `lg:`) don't account for this and can produce wrong results for content layout.

**Prefer CSS container queries** (`@container`) when the layout depends on the available content width — multi-column grids, card arrangements, etc. Use Tailwind's named container syntax:

```vue
<!-- Parent: define the container -->
<Card class="@container/my-section max-w-4xl">
  <!-- Child: query the container width, NOT the viewport -->
  <div class="grid grid-cols-1 @sm/my-section:grid-cols-2">
    ...
  </div>
</Card>
```

Container queries aren't needed everywhere — use judgement:

- **Container queries** (`@container`): multi-column grids, card layouts, anything where the sidebar makes viewport breakpoints inaccurate
- **Viewport breakpoints** (`md:`, `lg:`): showing/hiding the sidebar, header layout, simple show/hide toggles that genuinely depend on screen size
- **`useWindowBreakpoints`**: JS-based responsive logic — toggling components, conditional rendering based on device class

### KPI / summary cards collapse into rows when narrow

A grid of stat cards (label on top, big value below) wastes vertical space on phones and small tablets. When the container is narrower than `@md`, render the same items as **rows**: label on the left, value (plus hint) right-aligned, one item per line, divided by hairlines. Switch to cards only from `@md` of the section's container up.

- Analytics pages: use `pages/analytics/components/summary-rows.vue` for the narrow layout and the cards for wide.
- Elsewhere: one markup with container variants, e.g. `flex items-baseline justify-between @md/section:block` on each cell and `grid-cols-1 @md/section:grid-cols-4` on the grid (see the header strip in `pages/budgets/budgets-info/tracker-details.vue`).
- Never use a 2-column card grid as the phone fallback — it is the layout this rule replaces.

---

## Testing

All computation functions, services, utils, and helpers **must** have unit tests to verify their logic. If you create or modify a pure function (formatting, calculation, transformation, validation), write or update a corresponding unit test.

---

## Styling

- Use **Tailwind CSS** for all styling — avoid custom CSS unless absolutely necessary
- **Never** use default Tailwind colors directly (e.g., `text-red-500`, `bg-blue-200`). Always use the project's color variables defined in `packages/frontend/src/styles/global.css`
- If no existing color fits, **tell the user** about it and suggest adding it to `global.css` rather than using raw color values
- Use `cn()` utility from `@/lib/utils` for conditional class composition. Never use manual string concatenation for dynamic classes

### Amount colors

| Purpose            | Class                     |
| ------------------ | ------------------------- |
| Income / positive  | `text-app-income-color`   |
| Expense / negative | `text-app-expense-color`  |
| Transfer           | `text-app-transfer-color` |

### Text/icon color vs. fill color

Semantic colors come in pairs: the **base token is a fill** (button/badge backgrounds, with `*-foreground` for the label on top), and the **`*-text` token is the tint tuned for text and icons** sitting directly on the page/card background. Icons count as text here — lucide icons inherit `currentColor`.

| Color           | Text / icons            | Fill / background                        |
| --------------- | ----------------------- | ---------------------------------------- |
| Primary (brand) | `text-primary-text`     | `bg-primary` + `text-primary-foreground` |
| Destructive     | `text-destructive-text` | `bg-destructive`                         |
| Success         | `text-success-text`     | `bg-success`                             |
| Warning         | `text-warning-text`     | —                                        |

- **Never** use `text-primary` or `text-destructive` to color text or icons. Fill tokens are tuned so a white label passes contrast _on top of them_, which makes them too low-contrast _as_ text on the dark theme (this is why `--primary-text` exists as a separate, brighter tint in dark mode)
- Tinted chips like `bg-primary/10` still count as a dark background — text/icons inside them use `text-primary-text`
- Borders, strokes (progress rings), and chart lines may keep using the base token — non-text UI parts only need 3:1 contrast

---

## Components

### Buttons

Always use the project's `Button` component (`@/components/lib/ui/button`). Never use raw `<button>` elements.

Available variants: `default`, `destructive`, `outline`, `secondary`, `ghost`, `ghost-destructive`, `soft-destructive`, `ghost-primary`, `soft-primary`, `success`, `outline-success`, `ghost-success`, `soft-success`, `link`

Available sizes: `default`, `sm`, `lg`, `icon`, `icon-sm`

`Button` is `inline-flex` with `gap-2`, so spacing between its children (icon + label, multiple icons, etc.) is handled by the button itself. Do **not** add `mr-*` / `ml-*` / `space-x-*` to icons or text inside a `Button` — it doubles the gap and looks off.

```vue
<!-- WRONG — gap-2 already spaces the icon from the label -->
<Button><PlusIcon class="mr-2 size-4" /> Add item</Button>

<!-- CORRECT -->
<Button><PlusIcon class="size-4" /> Add item</Button>
```

**Action icons go before the label**, never after it. This applies to buttons, link-buttons, and dropdown/combobox "add" rows alike. Never put a literal `+` (or any icon glyph) in the translation string — render the lucide icon in the template.

```vue
<!-- WRONG — trailing icon / glyph baked into the copy -->
<Button>{{ $t('createGroup') }} <PlusIcon class="size-4" /></Button>
<Button variant="link">{{ $t('addCurrency') }}</Button>
<!-- "Add new currency +" -->

<!-- CORRECT -->
<Button><PlusIcon class="size-4" /> {{ $t('createGroup') }}</Button>
```

Exception: directional icons that indicate where the action leads (`ChevronRightIcon`, `ArrowRightIcon`, `ExternalLinkIcon`, dropdown `ChevronDownIcon`) stay trailing.

### Form fields

Always use the project's field components from `@/components/fields/`. Never use raw `<input>`, `<select>`, or `<textarea>` elements.

| Need          | Component                   |
| ------------- | --------------------------- |
| Text / number | `input-field.vue`           |
| Select        | `select-field.vue`          |
| Date          | `date-field.vue`            |
| Textarea      | `textarea-field.vue`        |
| Category      | `category-select-field.vue` |
| Tags          | `tag-select-field.vue`      |
| Color         | `color-select-field.vue`    |

#### Placeholders are required

Every form field must have a `:placeholder` set. An empty input or an empty select with only a label leaves the user guessing what to enter or pick (especially in dialogs that open with no prefilled value). The placeholder should be a concrete prompt — `"Enter payee name"`, `"Select a category"`, `"DD/MM/YYYY"` — not a restatement of the label.

Always wire placeholders through i18n (`:placeholder="$t('...')"`); never inline raw English strings.

### Icons

Always use `@lucide/vue` icons. Never use raw SVGs or other icon libraries. Do **not** use `lucide-vue-next` — that's the old package and has been replaced.

Always import icons with the **`Icon` suffix** — e.g., `CircleCheckIcon`, `Trash2Icon`, `ChevronDownIcon`. Never use the short form without the suffix.

```vue
<!-- WRONG -->
import { CircleCheck, Trash2 } from '@lucide/vue'
<CircleCheck />

<!-- WRONG — old package -->
import { CircleCheckIcon, Trash2Icon } from 'lucide-vue-next'

<!-- CORRECT -->
import { CircleCheckIcon, Trash2Icon } from '@lucide/vue'
<CircleCheckIcon />
```

### Scroll areas

Always use the `ScrollArea` component (`@/components/lib/ui/scroll-area`) for scrollable containers. Never use raw `overflow-auto` / `overflow-y-scroll` divs. Adding the ScrollArea's id to a global variable is not needed unless there's a concrete use case for it.

### Checkbox

The project's `Checkbox` component (`@/components/lib/ui/checkbox`) uses `modelValue` / `update:modelValue`, **not** `checked` / `update:checked`. Always bind with `:model-value` and `@update:model-value` (or `v-model`).

```vue
<!-- Correct -->
<Checkbox :model-value="form.notifyEmail" @update:model-value="(val) => (form.notifyEmail = !!val)" />

<!-- Also correct -->
<Checkbox v-model="form.notifyEmail" />

<!-- WRONG — will silently do nothing -->
<Checkbox :checked="form.notifyEmail" @update:checked="..." />
```

### Icon-only action buttons

When a button uses `size="icon"` or `size="icon-sm"` (no visible label) and performs an action (edit, delete, skip, etc.), **always** wrap it with `DesktopOnlyTooltip` (`@/components/lib/ui/tooltip`) so the user can see what it does on hover. Use the `content` prop for the label. Do **not** use the native HTML `title` attribute — it has a long delay and inconsistent styling.

```vue
<DesktopOnlyTooltip content="Delete">
  <UiButton variant="soft-destructive" size="icon" @click="handleDelete">
    <Trash2Icon class="size-4" />
  </UiButton>
</DesktopOnlyTooltip>
```

`DesktopOnlyTooltip` automatically skips rendering the tooltip on touch devices (no hover capability), so no extra mobile handling is needed.

#### Tooltip + slot-based dialog trigger

When the tooltipped button is the slot trigger for `ResponsiveDialog` / `ResponsiveAlertDialog`, nesting `DialogTrigger > DesktopOnlyTooltip > Button` silently breaks the click (reka-ui `as-child` can't merge through the tooltip's fragment root). Order: tooltip outside, `<span class="inline-flex">` wrapper, dialog inside.

```vue
<DesktopOnlyTooltip content="Delete">
  <span class="inline-flex">
    <DeleteFooDialog :foo-id="id">
      <UiButton size="icon" variant="ghost-destructive" aria-label="Delete">
        <Trash2Icon class="size-4" />
      </UiButton>
    </DeleteFooDialog>
  </span>
</DesktopOnlyTooltip>
```

Not needed for plain `Button @click` with `v-model:open` — only slot-triggered dialogs.

### Dialogs & modals

**Default to `ResponsiveDialog` for every new dialog.** Unless the user explicitly asks for a different primitive (raw `Dialog`, `Drawer`, `Popover`, etc.), any new modal/sheet/picker UI must use one of the responsive wrappers. They auto-adapt to **Drawer on mobile** and **Dialog / AlertDialog on desktop**, so they work in both contexts without extra wiring.

- Use **`ResponsiveDialog`** (`@/components/common/responsive-dialog.vue`) for general-purpose modals (forms, detail views, pickers)
- Use **`ResponsiveAlertDialog`** (`@/components/common/responsive-alert-dialog.vue`) for confirmations and destructive actions
- **Never** use raw `Dialog`, `AlertDialog`, or `Drawer` primitives directly for user-facing modals unless the user explicitly approves it for that case
- Always provide a `#title` slot (visible or via `VisuallyHidden`) so Radix has an accessible name — a missing `DialogTitle` triggers an a11y warning

---

## UI States

### Empty states

When a page or section has no data, display an empty state with the following layout: **icon + title + description + action** (if applicable). Look at existing empty states in the codebase for reference before creating new ones.

- **Icon is greyscale**: `bg-muted` circle with a `text-muted-foreground` icon. Don't tint it with the brand color (`bg-primary/10` + `text-primary-text`) — that's reserved for success/confirmation screens (auth, invitations), not "nothing here yet".
- **No extra surface**: render the empty state directly on the parent card/page. Don't wrap it in its own `bg-card` / bordered box when it already sits inside a card — nested surfaces look like a different design.
- Title and button copy follow sentence case (see **Copy & casing**).

```vue
<div class="flex flex-col items-center py-12 text-center">
  <div class="bg-muted mb-4 flex size-12 items-center justify-center rounded-full">
    <BriefcaseIcon class="text-muted-foreground size-6" />
  </div>
  <h3 class="mb-2 text-lg font-semibold">{{ $t('...title') }}</h3>       <!-- "No portfolios yet" -->
  <p class="text-muted-foreground mb-4 max-w-md text-sm">{{ $t('...description') }}</p>
  <Button><PlusIcon class="size-4" /> {{ $t('...action') }}</Button>    <!-- "Add a portfolio" -->
</div>
```

### Loading states

Use **skeleton placeholders** to represent loading content. Skeletons should approximate the shape/layout of the real content to prevent layout shift.

---

## Destructive Actions

All critical actions that delete data **must** follow this pattern:

1. Show a `ResponsiveAlertDialog` to confirm the user's intention
2. The confirm/submit button inside the dialog **must** use the `destructive` variant
3. After successful deletion, show a success toast and invalidate related queries

```vue
<ResponsiveAlertDialog
  v-model:open="isDeleteOpen"
  confirm-label="Delete"
  confirm-variant="destructive"
  @confirm="handleDelete"
>
  <template #title>Delete item?</template>
  <template #description>This action cannot be undone.</template>
</ResponsiveAlertDialog>
```

---

## Data Flow (TanStack Query)

### Cache keys

Always use constants from `VUE_QUERY_CACHE_KEYS` or `VUE_QUERY_GLOBAL_PREFIXES` in `@/common/const/vue-query.ts`. **Never** hardcode query key strings.

### Mutations & cache invalidation

After every create / update / delete operation:

1. **Invalidate** all related TanStack queries so the UI stays in sync
2. **Show a success toast** to confirm the operation to the user (unless explicitly told otherwise)
3. If the optimistic update is simple (e.g., removing an item from a list, toggling a boolean), **prefer optimistic updates** over waiting for refetch

### Optimistic update pattern

```typescript
useMutation({
  mutationFn: deleteItem,
  onMutate: async ({ id }) => {
    await queryClient.cancelQueries({ queryKey: VUE_QUERY_CACHE_KEYS.itemsList });
    const previous = queryClient.getQueryData(VUE_QUERY_CACHE_KEYS.itemsList);
    queryClient.setQueryData(VUE_QUERY_CACHE_KEYS.itemsList, (old) => old?.filter((item) => item.id !== id));
    return { previous };
  },
  onError: (_err, _vars, context) => {
    if (context?.previous) {
      queryClient.setQueryData(VUE_QUERY_CACHE_KEYS.itemsList, context.previous);
    }
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: VUE_QUERY_CACHE_KEYS.itemsList });
  },
});
```

### Loading states

Disable submit buttons and show loading indicators while mutations are in progress:

```vue
<Button :disabled="mutation.isPending.value" :loading="mutation.isPending.value">
  Save
</Button>
```

---

## i18n

### Copy & casing

All UI copy uses **sentence case**: capitalize only the first word and proper nouns (MoneyMatter, FIRE, AI, CSV, bank/provider names). Applies to page and dialog titles, headings, buttons, tabs, menu items, labels, and empty states.

- WRONG: `"No Portfolios Yet"`, `"Create Your First Portfolio"`, `"Add New Account"`
- CORRECT: `"No portfolios yet"`, `"Create your first portfolio"`, `"Add new account"`

When reviewing a diff that adds or changes `en` strings, flag any Title Case value.

### `$t` vs `t`

- In Vue **templates**, always use **`$t()`** — it's globally available and requires no import.
- Only use the imported `t()` function inside `<script setup>` when you need translations in computed properties, composables, or other JS/TS logic that runs outside the template.

### Never split translatable text

Do **not** break a sentence into multiple `$t()` calls when there are inline elements or components in the middle. Translations must represent complete sentences/phrases — splitting them makes proper translation impossible.

```vue
<!-- WRONG — splits sentence around a link -->
<p>{{ $t('Please read the') }} <a href="/terms">{{ $t('terms') }}</a> {{ $t('before continuing.') }}</p>

<!-- CORRECT — use <i18n-t> with slots -->
<i18n-t keypath="pleaseReadTerms" tag="p">
  <template #link>
    <a href="/terms">{{ $t('terms') }}</a>
  </template>
</i18n-t>
```

The corresponding translation key uses `{link}` as a placeholder:

```json
{
  "pleaseReadTerms": "Please read the {link} before continuing.",
  "terms": "terms"
}
```

### `<i18n-t>` component

Use the **`<i18n-t>`** component (from `vue-i18n`) whenever a translated string contains inline elements or components (links, bold text, icons, etc.). It interpolates Vue slots into translation placeholders, keeping the full sentence in a single translation key.
