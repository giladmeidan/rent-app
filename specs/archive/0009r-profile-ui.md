---
id: 0009r
title: The seeker profile is grouped into sections, with a sticky save bar above the tab bar and, on a desktop, a section index beside the form on the listing wizard's two tracks, built from the 0009d kit and tokens, with every behaviour unchanged
status: done
depends_on: [0009h]   # 0009h (which depends on 0009d): the kit (Button, Card, Field + TextInput / Textarea, PageContainer, PageHeader), the token scale, the restyled ChoiceGroup (with its `choiceSegment` export) / Switch / Skeleton / EmptyState / ErrorState, the full-width shell, the page roots and `pageWidths.test.ts`. Not 0009m: the auth half shares only he.json with this spec
reviewers: [ux]   # quick route (Gilad 2026-11-12: a cosmetic, behaviour-unchanged spec gets one ux review; coder Sonnet/high). The spec session also greps its diff for raw-HTML rendering (dangerouslySetInnerHTML / innerHTML / linkify) and runs lint, test and e2e. Was: reviewers: [code, qa, ux]
estimate: 1 coder run   # coder Opus/medium (~3 h): no auth, money or data; one large source file (ProfilePage.tsx), index.css, three test files, the screenshot harness if 0009l / 0009k / 0009m have not added it
---

## Goal
After this ships, `/me/profile` is grouped into sections:
- "מה מחפשים" (budget, move-in date, areas);
- "משק הבית והעדפות" (household, pets, smoking, contract, parking);
- "חדר בדירת שותפים". While its switch is on, it also holds the questionnaire and "הצגה לבעלי חדרים" (the
  people-browse opt-in and "קצת עליי").

The save button sits in a sticky bar, so it is always in reach on a long form, with the saved and failed states
next to it. On a phone the bar sits just above the tab bar.

On a desktop (≥ 1024 px) the page uses the listing wizard's two tracks (`0009k`): a sticky section index in the
side column, and the form in a ≤ 42 rem column.

Validation, the request body, the focus moves, `?next` (save and return) and `?section=room` are unchanged.

This serves Dev Plan slice 9 → **Slice 9b, the UI pass** (Gilad, 2026-11-12: "the app does not look good, layouts
do not fill the screen"). There is no artboard for this screen (Gilad, 2026-11-12: no new artboards).
- Fields, segmented choices, switch rows and the bottom bar come from `CreateListing.dc.html`.
- The desktop layout comes from `0009k`'s wizard.

It was split from `0009m` (auth) by verifier round 1.

## Scope
**In:**
- `web/src/features/profile/ProfilePage.tsx`:
  - the head, sections, desktop grid and side index, the sticky save bar, and `Field` / `TextInput` / `Textarea`
    for the four text-like fields;
  - the local class constants (`focusRing`, `label`, `box`, `bare`, `input`, `suffix`, `fieldError`, `card`,
    `chip`, `primary`) go;
  - no state, validation, request or handler changes, and the same DOM order of form controls.
- `web/src/app/index.css`: one rule for the scroll padding when the save bar sits above the tab bar (UI, "Save
  bar"). If `0009c` is not on the branch yet, also `0009c`'s sticky-footer rule, word for word.
- `web/src/app/__tests__/pageWidths.test.ts` (`0009h`): the `features/profile/ProfilePage.tsx` row becomes `wide`.
- `web/src/locales/he.json`: the four `profile.*` keys under UI. Existing keys keep their wording (`0009b` owns it).
- Tests:
  - the new cases under "Tests to write";
  - two existing assertions change form (AC5);
  - no other existing assertion changes.
- `web/e2e/applications.spec.ts`: one new `test.step` inside `ac9_fill_profile_apply_withdraw`, with no new
  sign-up.
- Screenshots (AC8), in `0009l`'s harness:
  - the harness is `make screens`, `web/playwright.screens.config.ts`, `web/e2e/screens/*.screens.ts`, and PNGs in
    the gitignored `web/screens/<spec>/`;
  - this spec's files are `web/e2e/screens/profile.screens.ts` and `web/e2e/screens/fixtures-profile.ts`;
  - if the harness is not on the base, add it exactly as `0009l`'s Scope item 9 words it.
- `specs/FOLLOWUPS.md` at build time: tick line 118 (AC3 is the missing test).

**Out:**
- `features/lifestyle/LifestyleFields.tsx`: its restyle and the reserved clear row (FOLLOWUPS line 137) are
  `0009k`'s (see Risks: ownership). This page renders it as `0009k` leaves it.
- The wizard's `RoomFields.tsx`. It is not used here: the profile's room fields are inline in `ProfilePage`.
- Login and signup: `0009m`.
- Work other specs own in `ProfilePage`. The layout below leaves room for each:
  - "הפרופיל נשמר" always mounted and focused on save (FOLLOWUPS 123): `0009t`;
  - `DateReadback` under the move-in input: `0009f`;
  - `Loading` for the loading wrapper, and `usePageTitle`: `0009c`;
  - `0009c`'s `self-stretch min-h-[44px]` on the `bare` input constant is superseded here. `TextInput`'s input
    already fills its box, and `bare` is deleted, so `0009c`'s rebase drops that item for this file.
- The tab bar and `--bottom-nav-h` (`0009a`).
- Changes that are behaviour, not a restyle:
  - budget as `type="text"` with thousands separators (FOLLOWUPS 121), which changes parsing;
  - the birth-year `maxLength` (FOLLOWUPS 138);
  - the switch 422s (FOLLOWUPS 117).
- Any new field, any copy change to existing keys, any API change.

**New dependencies:** none.

### Kit contract this spec relies on (0009d's draft API), and the fallback for each
The coder reads the merged or open `0009d` / `0009h` first. Where an API differs, adapt the call, not the kit.

| Need | Use | Fallback if the kit does not offer it |
| --- | --- | --- |
| Label / hint / error wiring with the caller's control id | `Field` with `id`, `hint`, `error`. The context id wins over the control's own. The control's `aria-describedby` is the hint id, then the error id, then its own ids (`ProfilePage.test.tsx`'s birth-year case reads index 1 as the error). Exactly one `role="alert"` per invalid field. Without an error there is no `aria-invalid` attribute (see AC5). | Keep today's local label / hint / error markup, token-styled |
| A unit inside the box ("₪") and the 52 px budget box | `TextInput` `end`, `size="lg"` | — |
| `<h1>` and subtitle | `PageHeader` `title`, `subtitle` | A page-local `<h1>` + `<p>` styled as `PageHeader`'s |
| Grouped switch rows (CreateListing's toggles card) | `Card padding="none"` with `className="flex flex-col divide-y divide-border"` | — |
| Multi-select segments (the areas) | `0009h`'s exported `choiceSegment` label classes on today's checkbox markup, plus the check mark below | — |
| Full-width submit | `Button`'s full-width prop, `fullWidth` or `block`, as merged | — |
| Sticky bottom action bar | not in the kit (`0009k`'s gap #2) | The local bar under UI, "Save bar" |

The digest names every fallback used. A fallback is the existing local markup, token-styled. It is not a new
component. Note for the ux reviewer: `Field`'s hint is `text-xs`, while today's birth-year hint and about-me
counter are `text-sm`. This is accepted.

## Data
None.

## API
None. The page calls the same endpoints with the same bodies: `GET /me/profile`, `PUT /me/profile` and
`GET /areas`.

## UI

### Layout
The page root is `PageContainer width="wide" as="section"`.
- `wide` (`max-w-wide`) applies at every width. A phone sees no change, because every width exceeds 390 px.
- It holds one inner `<div>`:

  ```
  mx-auto flex max-w-2xl flex-col gap-6
  lg:grid lg:max-w-none lg:grid-cols-[18rem_minmax(0,42rem)] lg:justify-center lg:gap-x-8 lg:gap-y-6
  ```

  - Below `lg`, the page is one centred column of at most 42 rem (`0009k`'s form-track width), so the fields do
    not stretch across a 900 px tablet.
  - From `lg`, it is `0009k`'s wizard grid: an 18 rem side track and a ≤ 42 rem form track, centred.
  - `pageWidths.test.ts` forbids `mx-auto` / `max-w-` only on the `PageContainer`'s own `className`, so they sit
    on this inner `<div>`.

The inner `<div>`'s children, in DOM order:
1. **The head**, in every state: `<div className="flex flex-col gap-1 lg:col-span-2">` holding:
   - `PageHeader` with `title` `profile.title` and `subtitle` `profile.intro`;
   - `<p className="text-body-sm text-ink-muted">` with `profile.privacy`, where it is today: in the head, not in a
     section.
2. **The body**:
   - loading: `<div className="lg:col-start-2">` holding today's busy wrapper with one `Skeleton`, or `0009c`'s
     `Loading` if that is on the branch;
   - error: `<div className="lg:col-start-2">` holding `ErrorState` with today's retry. `ErrorState` and
     `Loading` take no `className`, which is why they get the wrapper;
   - success: `ProfileFormView`, which returns a fragment of two grid children, the side index and the `<form>`.

   The head is grid row 1. The body is row 2, so the `<h1>` never moves when the data arrives.

### Side index (desktop only)
- The element: `<nav aria-label={t('profile.nav.label')} className="hidden lg:col-start-1 lg:row-start-2 lg:block
  lg:sticky lg:top-6 lg:self-start lg:rounded-lg lg:border lg:border-border lg:bg-surface lg:p-6">`. These are
  `0009k`'s side-card classes, on the brand tokens.
- It holds a `<ul className="flex flex-col gap-1">`, with one `<li><a href="#…">` per section, in page order:
  - `#profile-search` (`profile.sections.search`);
  - `#profile-household` (`profile.sections.household`);
  - `#profile-room` (`profile.room.title`);
  - only while the room switch is on: `#profile-lifestyle` (`lifestyle.title.seeker`) and `#profile-people`
    (`profile.room.peopleTitle`).
- Each link: `flex min-h-11 items-center rounded-md px-3 text-body font-medium text-ink-muted
  hover:bg-surface-subtle hover:text-ink`, plus `focusRing`.
- They are plain `<a href>`, never a router `Link`.
  - A `Link to="#…"` resolves without the current query, so it would drop `?next` and break the save-and-return
    redirect.
  - A plain fragment link keeps the query. The browser scrolls, with no script.
- The target elements carry `scroll-mt-6`.
- DOM order is the nav, then the `<form>`. That matches the visual order in RTL (the side track is at the inline
  start).
- Below `lg` the nav is `display: none`, so on a phone it is out of the tab order and the accessibility tree.

### The form
`<form className="flex flex-col gap-8 lg:col-start-2 lg:row-start-2">`.
- The save bar is the form's last child. It is in the same grid item as the fields it rides along with, which is
  why it can stick (`0009k`'s verifier finding 2).
- Fields keep today's DOM order, so `validate.ts`'s `FIELD_ORDER` focus is unchanged.
- Fields stay on the page background, as in CreateListing and `0009k`'s wizard.
- Each section is `flex flex-col gap-6`:
  - its heading block is `flex flex-col gap-1`: an `<h2 className="font-display text-h2">` (its id from
    `useId`, named by the section's `aria-labelledby`), and descriptions as `<p className="text-body-sm text-ink-muted">`;
  - sections 2 and 3 also have `border-t border-border pt-8`.

The four text-like fields are wired as follows. `fieldId`, `groupError` and the values are today's:
- budget:
  ```
  <Field id={fieldId('budget_max_ils')} label={t('profile.fields.budget')} error={groupError('budget_max_ils')}>
  ```
  with `<TextInput name="budget_max_ils" size="lg" end={t('listings.units.ils')} type="number" inputMode="numeric"
  min={BUDGET.min} max={BUDGET.max} value onChange />`;
- move-in:
  ```
  <Field id={fieldId('move_in_date')} label={t('profile.fields.moveIn')} error={groupError('move_in_date')}>
  ```
  with `<TextInput name="move_in_date" type="date" min={today} max={addDays(today, MOVE_IN_MAX_DAYS)} value
  onChange />`;
- birth year:
  ```
  <Field id={fieldId('birth_year')} label={t('profile.room.fields.birthYear')}
    hint={t('profile.room.birthYearHint')} error={groupError('birth_year')}>
  ```
  with `<TextInput name="birth_year" type="text" inputMode="numeric" maxLength={4} className="sm:max-w-xs" value
  onChange />`;
- about-me:
  ```
  <Field id={fieldId('about_me')} label={t('profile.room.aboutMe')}
    hint={t('listings.fields.charsLeft', { count: ABOUT_ME_MAX - form.about_me.length })}
    error={groupError('about_me')}>
  ```
  with `<Textarea name="about_me" rows={4} maxLength={ABOUT_ME_MAX} dir="auto" value onChange />`.

`a11y()` and `errorText()` stay only for the areas fieldset. `useField()` is not used.

| # | Element | Heading | Description | Content, in DOM order |
| --- | --- | --- | --- | --- |
| 1 | `<section id="profile-search" aria-labelledby className="scroll-mt-6 …">` | h2 `profile.sections.search` (new) | — | a wrapper `flex flex-col gap-6 md:grid md:grid-cols-2 md:items-start md:gap-4`: <br>• cell 1: the budget `Field`; <br>• cell 2 (`flex flex-col gap-1.5`): the move-in `Field`, then `0009f`'s `DateReadback` slot, then the flexible `Switch` in a grouped-rows `Card`. <br>Then the areas `<fieldset>` (legend `profile.fields.areas`): wrapping segments (`flex flex-wrap gap-2`), or `EmptyState` `areas.empty` |
| 2 | `<section id="profile-household" aria-labelledby className="scroll-mt-6 …">` | h2 `profile.sections.household` (new) | — | the household `ChoiceGroup`; a grouped-rows `Card` with the pets and smoker `Switch`es; the contract `ChoiceGroup`; the parking `ChoiceGroup` |
| 3 | the existing `<section aria-labelledby>`, now with `id="profile-room"` and `scroll-mt-6` | the existing h2 `profile.room.title` (ref, `tabIndex={-1}`, focused on `?section=room`) | `profile.room.hint` | a grouped-rows `Card` with the room `Switch`. While it is on: <br>• `profile.room.privacy` (muted); <br>• the gender `ChoiceGroup`, then `profile.room.genderNote` (muted); <br>• the birth-year `Field`; <br>• the flatmates `ChoiceGroup`; <br>• then 3a and 3b |
| 3a | `<div id="profile-lifestyle" className="scroll-mt-6 border-t border-border pt-6">` | `LifestyleFields`' own h3 `lifestyle.title.seeker` and its nudge | — | `LifestyleFields perspective="seeker"`, as `0009k` leaves it. Its region keeps its name |
| 3b | `<section id="profile-people" aria-labelledby className="scroll-mt-6 flex flex-col gap-6 border-t border-border pt-6">` | `<h3 className="text-h3">` `profile.room.peopleTitle` (new) | — | a grouped-rows `Card` with the `people_visible` `Switch` (`describedBy` the hint, as today); `profile.room.peopleVisibleHint` (muted, same id as today); the about-me `Field` |
| — | the save bar (below) | | | |

**`DateReadback` slot.** `0009f`'s `DateReadback` sits directly after the move-in `Field`, before the flexible
switch card.
- Its id goes in the `TextInput`'s own `aria-describedby`, which the kit merges after the `Field`'s ids.
- That happens only while the value is a valid ISO day, as `0009f` specifies.
- If `0009f` is not on the branch, the slot is empty.

**Areas** (FOLLOWUPS 128's multi-select half, for this page; see Risks):
- Each area keeps today's `input.peer.sr-only` checkbox, with its `aria-invalid` / `aria-describedby` from
  `a11y()`'s pattern, and a `label`.
- The label's classes are `cx(choiceSegment, 'gap-1.5')`.
- While the area is checked (`form.area_ids.has(area.id)`), the label holds this before the area's name:

  ```
  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}
    className="h-3.5 w-3.5 shrink-0"><path d="M5 12l5 5L20 7" /></svg>
  ```

  An unchecked area has no svg.
- Whichever of `0009k` (households) and `0009r` merges second matches the first one's markup.
- The chips take their content width and wrap.

### Save bar
It shows only while `areas.length > 0`, as today's submit block does.

The element is `<div data-sticky-footer>`, the form's last child, with these classes:

```
sticky z-10 flex flex-col gap-2 border-t border-border bg-surface px-4 py-3 -mx-4
max-lg:bottom-[calc(var(--bottom-nav-h,0px)+env(safe-area-inset-bottom,0px))]
sm:mx-0 sm:rounded-lg sm:border
lg:bottom-0
```

- Below `sm` the bar bleeds to the screen edges, as CreateListing's footer.
- From `sm` it is a rounded bar inside the column, like `0009k`'s desktop footer (`rounded-lg border
  border-border`, no shadow).
- Below `lg` it sits just above `0009a`'s tab bar. The offset mirrors `0009a`'s expression for `main`'s
  `padding-bottom`; if `0009a`'s merged CSS differs, use its expression. Without the tab bar, the offset falls
  back to the safe-area inset.

Its children:
1. while `failed`: today's `ErrorState`, whose retry re-sends `lastBody`;
2. `<div className="flex flex-col gap-2 lg:flex-row lg:items-center">`, holding:
   - the saved line: `<p role="status" className="text-body font-medium text-success empty:hidden">` with
     `profile.saved`. Today it renders only while `saved`. `0009t` makes it always mounted, and `empty:hidden`
     keeps an empty line from adding the gap;
   - `Button variant="primary" size="lg"`, full width, `type="submit"`, `disabled={save.isPending}`,
     `aria-busy={save.isPending}`, `className="lg:ms-auto lg:w-auto lg:min-w-48"`, with `profile.save`.

Heights:
- below `sm`: 77 px (24 px padding + the 52 px button + the 1 px top border), or 109 px with the saved line
  above the button (+ 8 + 24 px, the brand `body` line height);
- from `sm` to `lg`: 78 / 110 px (both borders);
- from `lg`: 78 px, because the line sits beside the button;
- a failure adds the `ErrorState`, for as long as it shows.

`web/src/app/index.css`, below `lg`:

```css
@media (max-width: 1023.98px) {
  html:has([data-sticky-footer]):has([data-bottom-nav]:not([data-hidden-mobile])) {
    scroll-padding-bottom: calc(var(--bottom-nav-h, 0px) + env(safe-area-inset-bottom, 0px) + 118px);
  }
}
```

- 118 px is the bar's tallest normal state (110 px) plus 8 px.
- The selector is more specific than `0009a`'s and `0009c`'s rules, so it wins on a page with both the tab bar and
  a sticky footer. The wizard hides its tab bar (`data-hidden-mobile`), so the rule never matches there.
- From `lg`, `0009c`'s `html:has([data-sticky-footer]) { scroll-padding-bottom: 96px; }` covers the 78 px bar at
  `bottom-0`. If `0009c` is not on the branch, this spec adds that rule exactly as `0009c` words it.

### States
| State | What shows |
| --- | --- |
| Loading (either GET pending, nothing cached) | the head, then the busy wrapper / `Loading` in the form track |
| Error (a GET failed, nothing cached) | the head, then `ErrorState` (its retry refetches whichever failed, as today) |
| New seeker (`GET /me/profile` 404 → `null`) | the empty form with the room section off. This is the page's empty state |
| No areas (`GET /areas` `[]`) | the areas `EmptyState` in section 1, and no save bar (as today) |
| Filled, room off | sections 1–3, with only the switch in 3; the index has 3 links |
| Room on | section 3 with its fields, 3a and 3b; the index has 5 links |
| Validation errors | field errors inline, as today. The first invalid control is focused, and the scroll padding keeps it clear of the bar |
| Saving | the button is disabled and `aria-busy` |
| Saved | "הפרופיל נשמר" in the bar. With a safe `?next`, it navigates there, as today |
| Save failed | `ErrorState` in the bar |
| `?section=room` | the room switch on, and its h2 focused (scrolled into view), as today |

### i18n keys added (`web/src/locales/he.json`)
| Key | Hebrew |
| --- | --- |
| `profile.nav.label` | "חלקי הפרופיל" |
| `profile.sections.search` | "מה מחפשים" |
| `profile.sections.household` | "משק הבית והעדפות" |
| `profile.room.peopleTitle` | "הצגה לבעלי חדרים" |

None is count-dependent.

### RTL
- Logical classes only (`ms-`, `me-`, `ps-`, `pe-`, `start`, `end`, `text-start`).
- The side index is the grid's first track, so it sits at the inline start (right) in RTL.
- In the save bar, `lg:ms-auto` puts the button at the inline end (left).
- About-me keeps `dir="auto"`. The check mark comes before the area's name, at the inline start.

### Arbitrary values (no token fits)
- `lg:grid-cols-[18rem_minmax(0,42rem)]`: `0009k`'s two-track template, kept identical so the two long forms
  share one desktop layout. There is no template token.
- `max-lg:bottom-[calc(var(--bottom-nav-h,0px)+env(safe-area-inset-bottom,0px))]`: a runtime offset from
  `0009a`'s tab bar, not a scale value.
- The `118px` in `index.css` (above).

### Differences from 0009k's wizard, for the ux reviewer
- The save bar bleeds only below `sm` and is rounded from `sm`, because between `sm` and `lg` the column is centred
  and narrower than the screen.
- The bar sits above a visible tab bar below `lg`. The wizard hides the tab bar.

## Acceptance criteria
- [ ] AC1 Given `/me/profile` with a stored profile and the room switch on, Then:
  - the `<h2>`s in DOM order are `profile.sections.search`, `profile.sections.household` and
    `profile.room.title`, and `profile.room.peopleTitle` is an `<h3>`;
  - `profile.privacy` is outside the `<form>`, in the loading, error and form states, and `profile.intro` is the
    `PageHeader` subtitle;
  - the navigation named `profile.nav.label` has five links, with the `href`s `#profile-search`,
    `#profile-household`, `#profile-room`, `#profile-lifestyle` and `#profile-people` in that order, and each
    target element exists;
  - after the switch is turned off, it has the first three, and `#profile-lifestyle` / `#profile-people` are gone;
  - the `name`s of the form's `input` / `textarea` elements, de-duplicated in DOM order, are exactly today's
    order: `budget_max_ils, move_in_date, area_ids, household, contract_months, parking_needed, gender,
    birth_year, flatmate_gender, lifestyle-cleanliness, lifestyle-guests, lifestyle-night, lifestyle-social,
    lifestyle-kosher, lifestyle-shabbat, lifestyle-work_from_home, about_me`.

  — `web/src/features/profile/__tests__/ProfilePage.test.tsx::ac1_sections_index_and_field_order`
- [ ] AC2 The save bar:
  - the "שמירה" submit button is inside `[data-sticky-footer]`, which is the `<form>`'s last element child;
  - after a `PUT` answering 200, `profile.saved` (`role="status"`) is inside it;
  - after a `PUT` answering 500, the `ErrorState` is inside it, and its retry sends a second `PUT` with the same
    body;
  - with `GET /areas` answering `[]`, there is no `[data-sticky-footer]`.

  — `ProfilePage.test.tsx::ac2_save_bar`
- [ ] AC3 Load errors (FOLLOWUPS line 118):
  - given `GET /me/profile` answering 500 and `GET /areas` 200, there is one `ErrorState` and no form, and its
    retry (now 200) shows the prefilled form;
  - given both GETs answering 500, there is one `ErrorState`, and its retry requests both again;
  - the `<h1>` `profile.title` shows in the loading, error and form states.

  — `ProfilePage.test.tsx::ac3_load_errors_retry`
- [ ] AC4 Areas:
  - every area's label carries all of `choiceSegment`'s classes;
  - a checked area's label holds exactly one `svg[aria-hidden="true"]`, and an unchecked one holds none;
  - checking and unchecking toggles it.

  — `ProfilePage.test.tsx::ac4_area_check_mark`
- [ ] AC5 Every existing test in `web/src/features/profile/__tests__/` and `web/src/features/lifestyle/__tests__/`
  passes, with exactly two assertion edits by this spec:
  - `ProfilePage.test.tsx:276` (move-in) and `:617` (birth year) go from `toHaveAttribute('aria-invalid',
    'false')` to `not.toHaveAttribute('aria-invalid', 'true')`;
  - the reason: the kit's `Field` renders no `aria-invalid` without an error, and the edited assertion keeps what
    the original meant.

  `0009k`'s edits to `LifestyleFields.test.tsx` are `0009k`'s. — `make test`; the digest lists the two edits.
- [ ] AC6 E2E: a `test.step('0009r profile layout')` inside
  `web/e2e/applications.spec.ts::ac9_fill_profile_apply_withdraw`. It sits after the last "reopens with the saved
  values" assertion (about line 129) and before the `goto('/me/profile?section=room')` (about line 132), with no
  new sign-up.
  - At 1440×900:
    - the `<form>`'s bottom edge is below 900 px (the page is long);
    - at scroll 0, the `profile.save` button's box is inside the viewport (the bar is sticky);
    - the navigation `profile.nav.label` is visible, and its left edge is ≥ the `<form>`'s right edge − 1 px (it
      is at the inline start).
  - At 390×844, after `window.scrollTo(0, 0)`:
    - the navigation is hidden, and `document.documentElement.scrollWidth <= clientWidth`;
    - the `<form>`'s bottom edge is below 844 px;
    - the `[data-sticky-footer]` bottom edge is within 2 px of the top edge of `[data-bottom-nav]` when that is
      visible (`0009a`), or within 2 px of 844 without it.
  - The viewport returns to 1280×720 for the rest of the test.
- [ ] AC7 Tokens and kit, over `ProfilePage.tsx`:
  - `grep -nE '#[0-9A-Fa-f]{3,8}\b'` prints nothing;
  - `grep -noE '[a-z0-9]-\[[^]]*\]'` (class tokens only) prints only the "Arbitrary values" entries and attribute
    variants (`aria-[…]`, `has-[…]`, `data-[…]`);
  - no local button, input box, card or chip style remains (the areas use `choiceSegment`; the bar is the listed
    fallback);
  - `pageWidths.test.ts` passes with the profile row at `wide`.

  The digest quotes both grep outputs.
- [ ] AC8 Visual check. Screenshots at 390×844 and 1440×900 of every state below, captured on the final local
  head and handed to the ux reviewer. The reviewer compares them with `CreateListing.dc.html` (fields, segments,
  switch rows, the primary button, the footer bar) and with `0009k`'s wizard screenshots, if they exist (the
  desktop side track, form track and footer). The states:
  - p1 loading;
  - p2 load error;
  - p3 a new seeker (the empty form, top of the page);
  - p4 the empty form after "שמירה" (errors, the first field focused);
  - p5 filled with the room switch off;
  - p6 room on, every field filled, two questions answered;
  - p7 saved (the viewport scrolled to the middle);
  - p8 save failed (the viewport);
  - p9 no areas;
  - p10 `?section=room` on arrival.

  Capture:
  - `web/e2e/screens/profile.screens.ts` in `0009l`'s harness;
  - full page, except p7 / p8 / p10, which are viewport shots, so the sticky bar shows in place;
  - written to `screens/0009r/${state}-${project}.png`;
  - `page.route(`${API}/**`)` answers every API request (and its `OPTIONS` preflight) from
    `web/e2e/screens/fixtures-profile.ts`:
    - a seeker `/me`;
    - `/areas` (three areas, and `[]` for p9);
    - `/me/profile` (404, 200, 500 and pending, per state);
    - the `PUT` replies (200, 500, and one held pending for "saving");
    - whatever the signed-in shell requests, with the event stream aborted;
  - an unmatched request fails the run, so no sign-up and no OTP are spent.

  — `web/e2e/screens/profile.screens.ts`, the PNGs listed in the digest
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green on the final
  head (Speed rule 7). Check that port 5173 is free first. The e2e result and the screenshot folder go in the
  digest.

## Tests to write
- Component (vitest, `mockApi` / `vi.stubGlobal('fetch', …)` as today):
  - `ProfilePage.test.tsx::ac1_sections_index_and_field_order`, `::ac2_save_bar`, `::ac3_load_errors_retry` and
    `::ac4_area_check_mark`;
  - the two assertion edits of AC5;
  - `pageWidths.test.ts`'s row.

  Headings are looked up by role, never by text, because the index links repeat their text.
- E2E: the `applications.spec.ts::ac9_…` step (AC6). If `0009c`'s `web/e2e/a11y.ts` is on the branch, the step also
  calls `expectNoAxeViolations` on the profile with the room switch on, with no extra sign-up.
- Screens: `web/e2e/screens/profile.screens.ts` (AC8). It is not part of `make e2e`.

## Risks / open questions
- **Shared-piece ownership** (for the orchestrator).
  - The only piece the profile shares with `0009k`'s wizard is `LifestyleFields.tsx`. The profile's room fields
    are inline in `ProfilePage`, and the wizard's `RoomFields.tsx` is not used here.
  - Proposal: `0009k` restyles `LifestyleFields` and does FOLLOWUPS line 137 (the reserved clear row), as its spec
    already says. This spec renders it unchanged in 3a, and needs nothing from its API.
  - Whichever builds second rebases. `0009k` notes that the reserved row lengthens the profile's questionnaire,
    and its ux reviewer checks it once at 390 px.
- **FOLLOWUPS 128's check mark** (for the orchestrator to confirm). `0009h` dropped the check mark from
  `ChoiceGroup` and handed line 128 to the wizard / profile screen specs. This spec takes option (b): only the
  multi-select copies get the mark (`0009k`'s households and these areas), and single-select segments stay as the
  artboard draws them.
  - Line 128 asks for multi-select first.
  - (b) touches no shared component.
  - The alternative, (a), adds the mark inside `ChoiceGroup` and changes every segment in the app.
- **Merge order and shared lines.** All of these are web specs, so they build one at a time locally (Speed rule 2),
  and the second to merge rebases.
  - `0009t`: the saved line always mounted and focused, which lives in the bar (`empty:hidden` is already on it).
  - `0009f`: `DateReadback` in its slot.
  - `0009c`: `Loading` in the loading wrapper, `usePageTitle`, the sticky-footer rule in `index.css`, and the
    `bare` touch-target fix, which this spec supersedes.
  - `0009h`: the page root and `pageWidths.test.ts`.
  - `0009a`: `index.css` (the tab bar's padding and `--bottom-nav-h`). Its `applications.spec.ts` edit is only the
    `header.myApplications` rename (line 99); its own e2e step is in `likes.spec.ts`.
  - `0009k`: `LifestyleFields` and the areas / households check-mark markup.
  - `0009l` / `0009k` / `0009m`: the screenshot harness. The first to build adds it.
- **Two bottom bars at 390 px.** The seeker's profile shows both the tab bar and the save bar: about 77 + 56 px of
  the 844 px screen.
  - The section index is desktop-only for the same reason.
  - With the on-screen keyboard open, mobile browsers keep `sticky` elements above the keyboard. The coder checks a
    focused about-me field at 390 px in `make dev`, and says so in the digest.
- **`width="wide"`** changes `0009h`'s `narrow` for this page at every width. The inner 42 rem column keeps the
  phone and tablet layout a single readable column.
- **Spec decisions** (the verifier and reviewers challenge these; not for Gilad):
  - the desktop copies `0009k`'s two tracks, so the app's two long forms share one desktop layout;
  - the side track holds a section index (plain fragment links) where the wizard holds its stepper.
- No open product questions.
- **Verifier round 1** (run on the combined draft, before the split from `0009m`): 17 findings, all applied. A
  second round is waived (one verifier round, Gilad).
  - The profile findings applied here: 2 (privacy in the head), 3 (the two `aria-invalid` edits), 4 (the `Field`
    wiring), 5 (`0009l`'s harness), 6 (option (b) and the check-mark AC), 7 (`pageWidths.test.ts`, `wide`
    everywhere), 8 (the class-token grep), 9 (the sibling owners and `DateReadback`), 10 (why no security), 11
    (the loading / error wrapper), 12 (`0009k`'s exact tracks and classes), 13 (the bar heights, `empty:hidden`,
    116 px), 14 (AC6), 15 (`fullWidth`, `choiceSegment`, the hint size) and 16 (FOLLOWUPS 118).
  - Also applied: `0009k`'s verifier finding 3 (768–1023 px), through the 42 rem inner column and the bar's `sm`
    switch.

- **Brand amendment** (orchestrator, 2026-11-12, `specs/0009-brand-amendment.md`), applied as a spec edit with no
  new verifier round: brand token names (`border`, `border-strong` inputs, `ink-muted`, `surface-subtle`,
  `success` for the saved line), `font-display text-h2` / `text-h3` headings, `rounded-lg` cards and bar, the `ink`
  primary (the amended `Button variant="primary"`), no shadows, and the slash-free key "מה מחפשים". The existing
  profile keys with slash forms or single-gender address ("גמיש/ה", "יחיד/ה", "אני מחפש/ת חדר", "מעדיפ/ה",
  "לא צריך/ה", "תגיש/י", "את/ה", "שותף/ה") are `0009b`'s sweep under the same amendment. The ux reviewer
  (AC8) also judges against `design/brand/README.md`. The bar heights follow the brand `body` line height.

## Digest (filled by orchestrator after verification)
See `/digest`.

Spec 0009r — the seeker profile in sections, with a sticky save bar and a desktop section index, on the kit   PR open, not merged
Shipped: `/me/profile` is grouped into "מה מחפשים", "משק הבית והעדפות" and "חדר בדירת שותפים" (plus the questionnaire and "הצגה לבעלי חדרים" while the room switch is on). The save button sits in a sticky bar that holds the saved / failed states; on a phone it rides just above the tab bar. From 1024 px it uses 0009k's two tracks: a sticky section index (plain `#` links, 3 or 5) beside a ≤ 42 rem form. Areas are `choiceSegment` chips with 0009k's check mark while checked. State, validation, request bodies, focus moves, `?next` and `?section=room` are unchanged. Demo: `make dev` → a seeker's `/me/profile` at 1440 (index links jump, the bar sticks) → at 390 (the bar above the tab bar) → room switch on (the index grows to 5).
Tests: +4 unit (`ac1_sections_index_and_field_order`, `ac2_save_bar`, `ac3_load_errors_retry`, `ac4_area_check_mark`). AC5's two assertion edits: `ProfilePage.test.tsx:331` (move-in) and `:672` (birth year), `toHaveAttribute('aria-invalid', 'false')` → `not.toHaveAttribute('aria-invalid', 'true')`; no other existing assertion changed. +1 e2e step `0009r profile layout` in `applications.spec.ts::ac9_fill_profile_apply_withdraw` (CI only; the existing axe call there already covers the room-on profile). 20 screenshots in `web/screens/0009r/` (p1–p10 × mobile / desktop, AC8).
Findings (ux only, quick route; one round): 0 blockers, 0 majors, 2 minors, both spec-intended and kept (a move-in error now reads above 0009f's date read-back, because `Field` puts its error under the input; the saved line sits before the button in the bar). 3 nits dropped. No behaviour change found, so no extra reviewers.
Kit: one fallback, the local sticky save bar (kit gap #2). `Field` builds its own hint / error ids (birth year, about-me); `DateReadback` joins the move-in input via `withReadback`; 0009t's saved line kept as main has it (rendered while saved, focused on an in-page save).
AC7: the hex grep prints nothing; the class-token grep prints only `max-lg:bottom-[calc(var(--bottom-nav-h,0px)+env(safe-area-inset-bottom,0px))]` (:572) and `lg:grid-cols-[18rem_minmax(0,42rem)]` (:658). No `dangerouslySetInnerHTML` / `innerHTML` / linkify in the diff. `index.css`: the scroll-padding rule in 0009a's merged form (`@media not all and (min-width: 1024px)`, `:root:has(…):has(…)`, `scroll-padding-block-end`, + 118 px).
Keyboard check: at 390 px a Tab-focused about-me stays clear of the bar (textarea bottom 617 px, bar top 671 px); an on-screen keyboard cannot be emulated here.
Checks on the final head (main at 0009j + 0009p merged): make lint / test (api 476, web 529) / i18n-check / build-web green; e2e runs in CI only (Gilad 2026-11-12). FOLLOWUPS: the 0006d profile load-error-test line (was 118) ticked. Changed in PRODUCT.md: nothing.
