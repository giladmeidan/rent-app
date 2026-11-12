---
id: 0009k
title: The listing wizard (new and edit) looks like CreateListing.dc.html on a phone and gets a designed desktop layout, built from the 0009d kit and tokens, with every behaviour unchanged
status: in-progress
depends_on: [0009h]   # 0009h (which depends on 0009d): the kit (Button, Card, Tag, Field + TextInput/Textarea/Select, PageContainer, PageHeader + BackLink, useConfirm), the token scale, the restyled ChoiceGroup / Switch / Skeleton / EmptyState / ErrorState, the full-width shell, the page-width table and the colour swap in every listings file
reviewers: [ux]   # quick route (Gilad 2026-11-12: a cosmetic, behaviour-unchanged spec gets one ux review; coder Sonnet/high). The spec session also greps its diff for raw-HTML rendering (dangerouslySetInnerHTML / innerHTML / linkify) and runs lint, test and e2e. Was: reviewers: [code, qa, ux]
estimate: 1 coder run   # coder Opus/medium: no auth, money or data, but ~11 source files and ~6 test files must stay green
---

## Goal
After this ships, an owner creating or editing a listing sees the wizard of `design/screens-v1/CreateListing.dc.html`
(artboard 04, "יצירת מודעה שלב 2/5", mobile): a white header band with a compact title, the stepper and the progress
bar; a big step heading with "שלב N מתוך 4"; fields in the artboard's anatomy; the amenities in one switch card; and a
sticky footer with "חזרה" and "הבא". On a desktop (≥ 1024 px) the stepper moves to a sticky side card next to the
form. Nothing a user can do changes: the same steps, fields, validation, requests and errors, and an expired listing
stays read-only. The unsaved-edits guard asks in the kit's dialog instead of the browser's `confirm`.

This serves the Product Plan's screen 8 (create / edit listing), PRODUCT.md "Listings" and "Listing edit". It is
Slice 9b (real UI/UX styling, Gilad 2026-11-12). "My listings" is `0009o`, split from this spec by the verifier.

**Brand (orchestrator's brand amendment, 2026-11-12, `specs/0009-brand-amendment.md`).** The brand kit
`design/brand/` (README.md, tokens.json) overrides the artboard's colours, type, shape and voice. The artboard still
gives the layout and anatomy. So the artboard's teal, Heebo and 14–20 px radii are quoted in the gap list only to say
what each element is; every "Do" uses the brand names: `surface` page and cards, `ink` text and primary buttons,
`ink-muted` secondary text, `accent` for selected states, focus and the progress fill, `border` for cards and
dividers, `border-strong` for inputs and controls, Fredoka (`font-display`) for h1 / h2 only at 24 px or more, Rubik
for everything else.

**Designed here, not in the artboard** (the artboard is one mobile state): steps 1 (type), 3 (preferences, with the
room block) and 4 (preview); the 768–1023 px and desktop layouts; and the edit page's other states. They reuse the
artboard's language: its field anatomy, segments, switch card, header band and footer.

## Scope
**In:**
- `web/src/features/listings/ListingWizard.tsx`: the shell (header band / side card, stepper, progress bar, step
  heading, footer bar) on the kit and the brand tokens, the leave guard on `useConfirm`, and the `published`
  navigation state after a publish (for 0009o's celebration). The step logic, validation, focus
  and request code are untouched.
- `DetailsStep.tsx`, `TypeStep.tsx`, `PreferencesStep.tsx`, `RoomFields.tsx`, `PreviewStep.tsx`, `RoomPreview.tsx`,
  `NewListingPage.tsx`, `EditListingPage.tsx`.
- `web/src/features/lifestyle/LifestyleFields.tsx`: the kit's pieces and the reserved clear row (FOLLOWUPS line
  137). `ProfilePage` renders it too and gets the same change, nothing else (0009m's profile spec expects this).
- Two additive kit edits (each with a case in the component's existing test file):
  - `web/src/components/PageHeader.tsx`: `size?: 'default' | 'compact'` (UI › Header);
  - `web/src/components/TextInput.tsx`: the `<input>` gets `self-stretch`, so a tap anywhere on the 48 / 52 px box
    focuses it (keeps 0009c's full-row touch target, which 0009c adds to today's `bare` inputs).
- `web/src/app/__tests__/pageWidths.test.ts` (0009h's): `/listings/new` and `/me/listings/:id/edit` become `wide`.
- `web/src/locales/he.json`: the new keys under UI. Existing keys keep their wording (0009b owns it).
- Tests: the new cases per AC and the assertion updates listed under "Tests to write".
- `web/e2e/listings.spec.ts`: one new `test.step` inside `ac12_owner_edits_listing` (no new sign-up).
- Screens: `web/e2e/screens/listings.screens.ts` and `web/e2e/screens/fixtures-listings.ts`, in 0009l's harness. If
  the harness is not on this spec's base when it builds, also `web/playwright.screens.config.ts`, the Makefile target
  `screens` and `web/screens/` in `.gitignore`, exactly as `0009l-inbox-ui.md` (UI § 9) describes them.

**Out:**
- "My listings" and `StatusBadge`: `0009o`.
- The "תמונות" step and any photo UI: photos are `0002c` (PRODUCT.md "Listings": no photos until 0002c). The
  stepper shows 4 steps.
- "שמירה כטיוטה" (save as draft): PRODUCT.md "Listings" decided **no drafts**. Not rendered.
- The price hint "הממוצע לדירות 4 חדרים בגבעתיים: …": no API has market averages. Not rendered (a placeholder would
  state a false number).
- `ListingCard.tsx` (0009i) and `OwnerPreferences.tsx` (0009j): the preview renders them as `main` has them.
- The colour swap in the in-scope files and FOLLOWUPS line 34: 0009h. The app header and the mobile tab bar (hidden
  on the wizard routes): 0009a.
- Kept as found, not added here (the second to merge rebases):
  - 0009c: `data-sticky-footer` on the footer and the `html:has([data-sticky-footer])` scroll padding; the ink focus
    ring on solid accent controls; the full-row touch target on the bare inputs (this spec carries it into the kit,
    see In); the `<h1>` in the edit page's loading / error states; `ErrorState`'s `page`; `Loading`;
    `usePageTitle`;
  - 0009t: the not-found `<h1>` focused on mount (FOLLOWUPS 55);
  - 0009b: `furnishedLabel(t, furnished, listingType)` in `DetailsStep`'s furnished options, the partial-ages copy
    in `RoomPreview`, and any plural-family `t()` calls in these files.
- Wording of existing keys (e.g. FOLLOWUPS line 33): 0009b.
- FOLLOWUPS line 35 (browser Back leaves the new wizard: a product call, see Q3), line 121 (numeric inputs as
  `type="text"`, spinners).

**New dependencies:** none.

## Data
None (web only).

## API
None. The wizard calls the same endpoints with the same bodies: `GET /areas`, `POST /listings`,
`PATCH /listings/{id}`, `GET /me/listings`, `GET /me`.

## UI

### Rules for every element
- Colours, type, radii and spacing are the brand tokens as 0009d carries them (the amendment's fixed names):
  - colours: `surface`, `surface-subtle`, `ink`, `ink-muted`, `on-ink`, `accent`, `accent-strong`, `accent-soft`,
    `border`, `border-strong`, `danger` (no teal, no `warn`, no beige page);
  - type: `text-h2` with `font-display` (step headings), `text-h3` (group headings), `text-body`, `text-body-sm`,
    `text-label`, `text-caption`, all Rubik except `display` / `h1` / `h2`;
  - shape: `rounded-md` for buttons and inputs, `rounded-lg` for cards, `rounded-full` for chips and badges;
    **cards have a `border` and no shadow**;
  - spacing: the brand scale 1 / 2 / 3 / 4 / 6 / 8 (4 to 32 px): `gap-4` between fields, `gap-6` between sections,
    `px-4` on a phone; `min-h-tap` (44 px) for targets.
  The only arbitrary values are listed under "Arbitrary values".
- Colour rules (brand): primary buttons are `Button variant="primary"`, which the brand makes `ink` with `on-ink`
  text; the progress fill is the screen's one accent-filled element of its own (the kit's selected segments, switches
  and focus rings are the brand's accent states); accent as text only on `surface`, and `accent-strong` on
  `accent-soft`; `danger` always with words.
- New copy follows the brand voice: no single-gender address and no slash forms, buttons 1–3 words starting with
  the action noun, an error says what happened and what to do. Every key this spec adds does.
- Controls are kit components: `Button`, `Field` + `TextInput` / `Textarea` / `Select`, `Card`, `Tag`,
  `PageContainer`, `PageHeader` / `BackLink`, `useConfirm`, and the restyled `ChoiceGroup`, `Switch`, `Skeleton`,
  `EmptyState`, `ErrorState`. No new kit component; the two additive edits above only.
- Logical properties only. In RTL the inline start is the right edge. Every chevron that implies a direction gets
  `ltr:rotate-180`, as `BackLink`'s does.
- The DOM order of the fields does not change. It matches `FIELD_ORDER` in `validate.ts`, which picks the invalid
  field that gets focus. Groups, cards and columns are added around fields; fields are never reordered.
- Every accessible name, role and id that tests and e2e use stays: `listings.next`, `publish`, `save`,
  `common.back`, `listings.edit.backToMine`, the field labels, `role="switch"`, the `progressbar` (labelled by the h1
  through `PageHeader`'s `titleId`), the stepper `<ol>` with `aria-current="step"`, the `fieldId(name)` ids, the
  `role="alert"` errors referenced by `aria-describedby`.
- Busy buttons keep today's `disabled` + `aria-busy` (both passed to `Button`, not its `busy` prop), so the
  double-click and pending behaviour and their tests stay as they are. Moving them to `busy` is 0009c's call.
- The gutter stays `PageContainer`'s 16 px on a phone (the artboard pads the form 20 / 22 px): every 9b screen keeps
  the same gutter.

### Gap list: CreateListing.dc.html vs today's code
Element by element. "Do" is what this spec builds.

| # | Element | Artboard | Today | Do |
| --- | --- | --- | --- | --- |
| G1 | Top band | White band flush at the top, bottom border `line`, padding 14 / 16 / 16, holding the top bar, the stepper and the progress bar | No band; h1, stepper and bar on the page background | Below `lg`: a full-bleed white band, flush under the app header (Header and layout, below) |
| G2 | Back control | 44×44 chevron at the inline start, every mode | Edit mode only: `BackToMine` pill link above the h1 | Edit mode only: `PageHeader`'s `back` (`/me/listings`, label `listings.edit.backToMine`, the guard as `onClick`), in the title row. New mode: none (Q3) |
| G3 | Title | "מודעה חדשה" 16 px / 700, centred | h1 `listings.new.title` / `listings.edit.title`, 24 px / 800 | The same h1 text and level through `PageHeader size="compact"`: Rubik `text-body font-medium` below `lg` (Fredoka is never below 24 px), start-aligned after the back link (a centred title would need a three-column hack around an optional link); at `lg` the default header (`font-display text-h1`) |
| G4 | "שמירה כטיוטה" | Ghost button at the inline end | None | None (no drafts) |
| G5 | Stepper | 5 steps; 28 px circles; done: accent fill + white check; current: white, 2.5 px accent border, number 13 px / 800 `accent-text`; to do: white, 2 px `line-strong`, 13 px / 700 `muted`; labels 12 px: done 600 `accent-text`, current 700 `ink`, to do 500 `muted`; 6 px circle–label gap | The same anatomy, 4 steps, arbitrary `[6px]` `[13px]` `[2.5px]` | The same anatomy in brand colours: `h-7 w-7 rounded-full`; done: `bg-ink` with the check `stroke="currentColor"` in `text-on-ink` (ink, not accent, so the progress fill stays the one accent fill); current: `border-2 border-accent bg-surface`, number `text-caption font-semibold text-accent`; to do: `border-2 border-border-strong bg-surface`, number `text-caption text-ink-muted`; labels `text-caption`: done `text-ink`, current `text-ink font-semibold`, to do `text-ink-muted`; `gap-2`; 4 steps (no "תמונות"). Vertical at `lg` (Desktop) |
| G6 | Progress | 4 px track `line`, accent fill, 40 % at 2/5 | `step / 4`, `transition-[width]` | The same, `h-1 rounded-full bg-border`, the fill `bg-accent transition-all motion-reduce:transition-none`, `aria-labelledby` = `PageHeader`'s `titleId` (today's name) |
| G7 | Step heading | h1 "פרטי הדירה" 24 px / 800; line "שלב 2 מתוך 5 · …" 14 px `muted` | None on steps 1, 2, 4; step 3's h2 + hint inside `PreferencesStep` | Every step: an `<h2 className="font-display text-h2">` (Fredoka 24 px / 600) rendered by the wizard (keys below), then `<p className="text-body-sm text-ink-muted">` holding `<span>{stepOf}</span>`, then " · " and `<span>{hint}</span>` when the step has a hint (the hint in its own element, so a `getByText(hint)` still matches one element). `PreferencesStep` stops rendering its own h2 / hint, and `PreviewStep` its own `<p>{listings.preview.hint}</p>` |
| G8 | Rhythm | Padding 22 / 20, 22 px between fields | `gap-[22px]` | The brand scale: `gap-4` between fields (space-4), `gap-6` between the groups of G9 (space-6); the 16 px gutter kept (Rules) |
| G9 | Groups | One short step, no group titles | One flat column of 13 fields | Details become titled groups in DOM order, each an `<h3 className="text-h3">` (Rubik 18 / 500): כתובת (area, city, street) · הדירה (rooms, floor + total, size) · מחיר וכניסה (price, entry date, flexible) · מה יש בדירה (amenities, G13) · תשלומים נוספים (arnona, vaad). Then the description, whose label "על הדירה" is its title |
| G10 | Rooms | Segments 2 / 3 / 3.5 / 4 / 5+ (`aria-pressed`) | `<select>` 1–10 in halves, plus a stored value outside the list | `Field` + `Select` with today's options (Q1): a "5+" segment cannot hold the exact count the API stores, and e2e picks "3.5" with `selectOption` |
| G11 | Field anatomy | Label 14 px / 700 above, gap 6; box 48 px, radius 12, 1.5 px `line-strong`, white; value 16 px / 600; unit 13–14 px `muted`; focus: accent border + 3 px `accent-tint` ring | Hand-written label / box / hint / error | `Field` (`id={fieldId(name)}`, `label`, `hint`, `error={message(errors[name])}`) around `TextInput` / `Select` / `Textarea`: city, street (hint `streetHint`), rooms, size, price, entry date, arnona, vaad, description (hint `charsLeft`), area (when a select shows). The kit draws the brand anatomy: label `text-label`, box `rounded-md border-border-strong bg-surface`, focus `accent`. The error (not in the artboard) shows under the control in `danger`, as today |
| G12 | Floor + size, price, money | 2-column grid, gap 12; floor box "3 מתוך 5" (second input 36 px, centred); size unit "מ״ר"; price box 52 px, value 20 px / 800, "₪" 16 px / 600 | Same, arbitrary values | See "Details step" |
| G13 | Amenities | One white card, radius 16, border `line`; rows padding 14 / 16 with `line-soft` dividers; label 15 px / 600; 52×32 switches: מעלית, חניה, מרוהטת, חיות מחמד מותרות | Card [flexible, elevator]; parking select; furnished segments; card [pets] | One card in the artboard's order (= today's DOM order); see "Details step" |
| G14 | Entry date | Text box "01.01.2027", calendar icon at the start, pill "גמיש ±2 שבועות" inside the box at the end | Native `type="date"`; flexible a `Switch` row in a card with the elevator | `Field` + `TextInput type="date"` (the browser draws its picker icon; e2e fills an ISO date). The flexible `Switch` in its own one-row `Card padding="none"` right under it: the kit has no toggle pill, and tests find it as `role="switch"` |
| G15 | Footer | Absolute bottom bar, white, top border, padding 12 / 16 / 22, gap 10; "חזרה" secondary (flex 1, 52 px, radius 14, chevron before); "הבא: תמונות" primary (flex 1.6, 52 px, chevron after) | Sticky bar with that anatomy; label "הבא" | See "Footer". The label stays "הבא": names are asserted exactly, and the stepper already names the next step |
| G16 | 768+ and desktop | None | One 480 px column | See "Header and layout" and "Desktop" |

### Header and layout (below 1024 px)
- `NewListingPage` and the editable `EditListingPage` render `<PageContainer width="wide">` holding the wizard. The
  wizard returns a fragment: the `<form>`, then `useConfirm`'s `dialog` (outside the form).
- The `<form>` (`flex flex-col gap-6`, plus the `lg:` grid of Desktop) holds, in this DOM order:
  1. **The band** `<div className="-mx-4 -mt-6 border-b border-border bg-surface px-4 pb-4 pt-3 md:-mx-6 md:px-6
     lg:contents">` (the page is `surface` too now, so the band is set off by its bottom border, not by colour): the negative margins follow `PageContainer`'s gutters (`px-4 md:px-6`) and `<main>`'s `pt-6`
     (0009h), so the band touches the screen's edges and the app header. Inside it, `<div className="mx-auto flex
     w-full max-w-narrow flex-col gap-4 lg:contents">` holds:
     - `PageHeader size="compact"` with `title`, `titleRef` (today's `headingRef`), `titleId`, `back` in edit mode,
       `className="lg:col-span-2"`;
     - the stepper block (`<div className="flex flex-col gap-4 …">`, Desktop adds its `lg:` classes): the `<ol>` and
       the progress bar.
  2. **The body and footer wrapper** `<div className="flex flex-col gap-6 lg:col-start-2 lg:row-start-2">`:
     - the step body `<div className="mx-auto flex w-full max-w-narrow flex-col gap-6 lg:max-w-none">`: the step
       heading (G7), then the step;
     - the footer (below).
- So at 390 px the content is the screen minus the gutters, and from 480 to 1023 px the band's content, the step and
  the footer's buttons stay centred at 480 px (today's width), while the band and the footer bar span the screen.
  `mx-auto` is fine in `ListingWizard.tsx`, which is not a page file in 0009h's width test.
- **Focus** is unchanged: a step change focuses the h1 (now through `titleRef`), and the server-error path
  (`focusAfterStep`) focuses the named field.
- **`PageHeader size="compact"`** (the kit edit): below `lg` the back link and the h1 share one row (`flex
  items-center gap-2`) and the h1 is Rubik `font-sans text-body font-medium` (Fredoka is not used below 24 px);
  `subtitle` and `actions` as in the default size; at `lg` it renders exactly as `default` (`font-display text-h1`). The h1 keeps `tabIndex={-1}`, `titleRef` and `titleId`.

### Footer
- `<div data-sticky-footer className="sticky bottom-0 z-10 -mx-4 border-t border-border bg-surface px-4 pt-3
  pb-[max(theme(spacing.6),env(safe-area-inset-bottom))] md:-mx-6 md:px-6 lg:bottom-4 lg:mx-0 lg:rounded-lg
  lg:border lg:px-4">` (no shadow) with `<div className="mx-auto flex max-w-narrow gap-3 lg:max-w-none
  lg:justify-between">`.
- Back (steps 2–4): `Button variant="secondary" size="lg"`, `type="button"`, the chevron (`M9 6l6 6-6 6`,
  `ltr:rotate-180`) as `icon`, `basis-2/5 lg:basis-auto lg:flex-none`.
- Next / publish / save: `Button variant="primary" size="lg" type="submit"` (the brand's `ink` button with
  `on-ink` text, not the artboard's teal), `flex-1 lg:flex-none lg:min-w-48`, the
  chevron (`M15 6l-6 6 6 6`, `aria-hidden`, `ltr:rotate-180`) after the text on "הבא" only; `disabled` and
  `aria-busy` as today.
- On step 1 only the primary shows, full width below `lg`.

### Desktop (≥ 1024 px, checked at 1440)
Not in the artboard; designed in its language and in InboxDesktop.dc.html's page header (back link and h1 above the
body).
- The `<form>` adds `lg:grid lg:grid-cols-[theme(spacing.72)_minmax(0,theme(maxWidth.2xl))] lg:justify-center
  lg:gap-x-8 lg:gap-y-6` (an 18 rem side column and a form column of up to 42 rem, centred in the `wide` container).
  The band and its inner wrapper are `lg:contents`, so:
  - `PageHeader` is row 1 across both columns (`lg:col-span-2`), at its default size;
  - the stepper block is `lg:col-start-1 lg:row-start-2 lg:sticky lg:top-6 lg:self-start lg:rounded-lg lg:border
    lg:border-border lg:bg-surface lg:p-6` (a bordered card, no shadow): column 1 is the inline start, so it sits on
    the right in RTL;
  - the body and footer wrapper is column 2, row 2. The footer is `sticky` inside that wrapper, whose height is the
    whole step, so it stays at the bottom of the viewport while the step scrolls.
- The stepper's `<ol>` turns vertical: `lg:flex-col lg:items-stretch lg:gap-3`; each `<li>` is `lg:flex-row
  lg:items-center lg:gap-3` (the circle, then the label at `lg:text-sm`). The progress bar sits under it.
- Fields stay on the page background, as on a phone.
- The footer is a white bar with `lg:rounded-lg lg:border`, 16 px above the viewport's bottom (`lg:bottom-4`); back
  at the inline start, the primary at the inline end.
- The ux reviewer checks 768 px once (band and footer full width, content centred at 480).

### Steps
- **Step 1 (type).** h2 `listings.stepTitle.type`, line `stepOf` only. The `ChoiceGroup` "מה מפרסמים?" with its two
  options at full width. "הבא" disabled until a type is chosen (as today).
- **Step 2 (details).** h2 `listings.stepTitle.details` (apartment) or `listings.stepTitle.detailsRoom` (room), line
  `stepOf` · `listings.stepHint.details`. Groups G9, fields as in "Details step".
- **Step 3 (preferences).** h2 `listings.prefs.title` / `listings.prefs.titleRoom`, line `stepOf` ·
  `listings.prefs.hint` (the same keys and level, moved from `PreferencesStep`).
  - Households: a fieldset (legend `listings.prefs.households`, `aria-invalid` / `aria-describedby` as today) with a
    `grid grid-cols-2 gap-2` of checkbox segments, styled exactly as 0009h's `ChoiceGroup` segment (a local `segment`
    class constant with its tokens), and the same `aria-hidden` 14 px check mark (`M5 12l5 5 9-10`) before the text
    of each checked segment (FOLLOWUPS line 128, the households half).
  - "ללא מעשנים": a `Switch` in a one-row `Card padding="none"`.
  - Minimum contract: `Field` + `Select`.
  - The room block (`RoomFields`), for a room only: a `<section aria-labelledby>` with `border-t border-border pt-6`
    and `flex flex-col gap-4`:
    - the h3 `listings.room.title` (`text-h3`) and the privacy note (`text-body-sm text-ink-muted`);
    - the gender `ChoiceGroup` and its hint;
    - the count `Field` + `Select` with its hint `listings.room.flatmatesHint`;
    - the ages fieldset as today (legend, the shared hint `<p id=…-hint>`, the shared error), its slots
      standalone `TextInput`s with today's ids, passing `aria-invalid={invalid}` and `aria-describedby` directly,
      in `grid grid-cols-3 gap-2 lg:grid-cols-4`, each slot label `text-caption`;
    - then `<div className="border-t border-border pt-6">` (kept) with `LifestyleFields perspective="flat"
      headingLevel={4}`.
- **LifestyleFields (FOLLOWUPS line 137).** `<section className="flex flex-col gap-4">`: the heading block (the
  h3 / h4 at `text-h3`, the nudge `text-body-sm text-ink-muted`), then `<div className="flex flex-col
  gap-2">` with the seven questions. Each question is its `ChoiceGroup` plus one row that is always rendered
  (`<div data-testid="lifestyle-clear-row" className="flex min-h-tap items-center">`). The "ניקוי" button mounts in
  that row only while the question has an answer, as today: `Button variant="ghost" size="sm"`, `type="button"`,
  `aria-label={lifestyle.clearAria}`, the visible text `lifestyle.clear`. Picking or clearing an answer moves
  nothing below it.
- **Step 4 (preview).** h2 `listings.stepTitle.preview` (new) or `listings.stepTitle.previewEdit` (edit), line
  `stepOf` · `listings.preview.hint`. Then `ListingCard` as `main` has it; `RoomPreview` (its chips as
  `Tag tone="neutral" as="li"` in a `<ul className="flex flex-wrap gap-2">` inside a `Card`, keeping
  `aria-label={listings.room.title}`, and the privacy note under the card); `OwnerPreferences` as `main` has it; then
  the publish errors: `capReached` and `invalid` as `<p role="alert" className="text-body-sm font-medium
  text-danger">`, `areaInactive` as that line plus `Button variant="secondary"` `listings.preview.backToDetails`,
  `failed` as `ErrorState`.
- **After a publish (201)** the wizard navigates to `/me/listings` with `state: { published: true }` (today: no
  state), so "my listings" can celebrate with `Mascot pose="celebrate"` (the brand's "listing published" pose; the
  line and the mascot are 0009o's). An edit's save keeps `state: { saved: true }`. The wizard itself shows no
  mascot: one turtle per screen, and the publish moment is on the next screen.

### Details step
- **Area** (`<div data-testid="area-field">`): with a select (pending or loaded) it is a `Field` + `Select`
  (pending: disabled, one option `common.loading`). Without a select (the areas failed, or there are none) the
  wrapper holds a `<p className="text-label">` label, `ErrorState` (retry) or `EmptyState` (`areas.empty`),
  and today's `<p id={fieldId('area_id') + '-error'} role="alert">` error under them (no `Field`: there is no
  control to wire).
- **City, street**: `Field` + `TextInput`; `lg:grid-cols-2` around the two.
- **Rooms**: `Field` + `Select` (G10).
- **Floor + total** (`grid grid-cols-2 gap-3` with size): 0009d's own custom-control example.
  - The `Field` (`label` `listings.fields.floor`, `id` `fieldId('floor')`, `error` the floor's message) wraps a box
    `<div>` with a local copy of `TextInput`'s `md` box classes (the brand box: `rounded-md border-border-strong
    bg-surface`, the accent focus ring; 0009d exports no box class), plus `border-danger` when `errors.floor !== undefined || errors.total_floors !== undefined`, computed in JS, so either
    invalid input reddens the box, as today.
  - The floor input takes `useField()`'s `id`, `aria-describedby` and `aria-invalid`, with `self-stretch min-h-tap`
    (a tap anywhere on the box's height focuses it).
  - "מתוך" (`listings.fields.of`) is an `aria-hidden` `text-body-sm text-ink-muted` span.
  - The total input keeps its own `id` (`fieldId('total_floors')`), `aria-label` (`listings.fields.totalFloors`),
    `aria-invalid` and `aria-describedby`, with `w-9 self-stretch min-h-tap text-center`. Its error is a
    `<p id=… role="alert" className="text-body-sm font-medium text-danger">` right after the `Field`.
- **Size**: `Field` + `TextInput type="number" inputMode="numeric"` with `end={t('listings.units.sqm')}`.
- **Price**: `Field` + `TextInput size="lg"` with `end={<span className="text-body font-medium">{t('listings.units.ils')}</span>}`
  (the artboard's 16 px ₪, in Rubik). It keeps today's value logic exactly: bare digits ("7200") while focused,
  `formatIls` ("7,200") at rest, the `onPointerDown` / re-select logic and its ref.
- **Entry date + flexible**: G14.
- **Amenities** (G13): `Card padding="none"` (a `border`, `rounded-lg`, no shadow) with `flex flex-col divide-y
  divide-border`, four rows in DOM order:
  - the elevator `Switch` (its own row padding);
  - the parking row, hand-built (a `Field` is a fixed column): `<div className="flex items-center justify-between
    gap-3 px-4 py-3">` with `<label htmlFor={fieldId('parking_spots')} className="text-body font-medium">` and
    `<div className="w-24 shrink-0">` around a standalone `Select` (`id`, `aria-invalid`, `aria-describedby` pointing
    at its error), options 0–5 as today; the error `<p id=… role="alert">` under the row, inside the card, with
    `px-4 pb-3`;
  - the furnished row `<div className="px-4 py-3">` with its `ChoiceGroup` (none / partial / full), whose own
    legend is the row's label;
  - the pets `Switch`.
- **Arnona, vaad** (`grid grid-cols-2 gap-3`): each `Field` (hint `listings.fields.optional`) + `TextInput
  type="number" inputMode="numeric"` with today's `min` / `max` and `end={t('listings.units.ils')}`.
- **Description**: `Field` (hint `listings.fields.charsLeft`) + `Textarea rows={5}`.

### Edit page
- Editable: the wizard in edit mode: opens on step 2, with `PageHeader`'s back link "חזרה למודעות שלי".
- **The leave guard on `useConfirm`** (0009d's drop-in for `window.confirm`): when the form is dirty, the back link's
  `onClick` calls `event.preventDefault()`, then `confirm({ title: t('listings.edit.leaveConfirm'), confirmLabel:
  t('listings.edit.leave'), cancelLabel: t('listings.edit.stay'), tone: 'danger' })`, and navigates to `/me/listings`
  only when it resolves `true`. A clean form (also while the areas load) leaves without asking. `beforeunload` is
  unchanged.
- Loading, error (no data), not found and expired: `<PageContainer width="wide" className="flex flex-col
  items-center">` with one inner `<div className="flex w-full max-w-narrow flex-col gap-4">`, so they sit centred at
  480 px (0009h's width test allows one width per page file and no `mx-auto` there):
  - loading: `Skeleton` in today's busy wrapper (0009c's `Loading` and `<h1>` if on `main`);
  - error with no data: `ErrorState` with retry; a cached list survives a failed refetch (as today, now tested:
    FOLLOWUPS 54);
  - not found: `PageHeader` with `back` (no guard) and the title `listings.edit.notFound`;
  - expired (past expiry, any status): `PageHeader` with `back` and the title `listings.edit.expiredTitle`, focused on
    arrival through `titleRef`; `listings.edit.expiredBody` in a `Card` under it; no form controls.
- `BackToMine` (`ListingWizard.tsx`) is no longer used in this spec's files. It stays exported, as a thin wrapper over
  `BackLink` with the same props, while another file imports it (`ApplicantsPage` today; 0009l moves off it).
  Whichever spec removes the last importer deletes it. Until 0009l builds, the inbox's back link therefore takes
  `BackLink`'s look (muted caption, not the accent 15 px link); the ux reviewer is told.

### Arbitrary values
Allowed only here, each with its reason:
- `lg:grid-cols-[theme(spacing.72)_minmax(0,theme(maxWidth.2xl))]`: a two-track template with a capped second track,
  built from tokens; no utility names it. 0009m's profile uses the same tracks.
- `pb-[max(theme(spacing.6),env(safe-area-inset-bottom))]` on the footer: the brand's 24 px, or the iPhone
  home-indicator inset in the installed PWA (PRODUCT.md "Platform"), whichever is larger.
- The progress fill's inline `style={{ width }}`: computed from the step.
Attribute variants (`aria-[…]`, `has-[…]`, `peer-…`, `group-…`) are not values and stay.

### i18n keys added
| Key | Hebrew |
| --- | --- |
| `listings.stepOf` | "שלב {{n}} מתוך {{total}}" |
| `listings.stepTitle.type` | "סוג המודעה" |
| `listings.stepTitle.details` | "פרטי הדירה" |
| `listings.stepTitle.detailsRoom` | "פרטי החדר והדירה" |
| `listings.stepHint.details` | "הפרטים האלה נכנסים לחישוב ציון ההתאמה." |
| `listings.stepTitle.preview` | "בדיקה לפני פרסום" |
| `listings.stepTitle.previewEdit` | "בדיקה לפני שמירה" |
| `listings.section.address` | "כתובת" |
| `listings.section.apartment` | "הדירה" |
| `listings.section.priceEntry` | "מחיר וכניסה" |
| `listings.section.amenities` | "מה יש בדירה" |
| `listings.section.payments` | "תשלומים נוספים" |
| `listings.edit.leave` | "יציאה בלי שמירה" |
| `listings.edit.stay` | "המשך עריכה" |

Step 3 reuses `listings.prefs.title`, `titleRoom` and `hint`; step 4 `listings.preview.hint`; the guard's title
`listings.edit.leaveConfirm`.

## Acceptance criteria
Hebrew test inputs use `\uXXXX` escapes, as the listings fixtures do.
- [ ] AC1 Given the new wizard, Then on each of its 4 steps the stepper `<ol>` has 4 items with `aria-current="step"`
  on the current one, the progressbar has `aria-valuenow` = the step and the accessible name `listings.new.title`, and
  one `<h2>` shows: step 1 `stepTitle.type`, step 2 `stepTitle.details` (a room: `stepTitle.detailsRoom`), step 3
  `prefs.title` (a room: `prefs.titleRoom`), step 4 `stepTitle.preview`, each with "שלב N מתוך 4" in its line. The
  hints `prefs.hint` and `preview.hint` each appear once. After each "הבא" and "חזרה" the h1 has focus. In edit mode
  step 4's h2 is `stepTitle.previewEdit`. — `web/src/features/listings/__tests__/ListingWizard.test.tsx::ac1_step_headings`
  (the existing `ac1_four_steps` passes unchanged)
- [ ] AC2 Given step 2, Then the `<h3>`s read כתובת, הדירה, מחיר וכניסה, מה יש בדירה, תשלומים נוספים in that order;
  the controls with ids `fieldId(name)` appear in the DOM in `FIELD_ORDER`'s order; the amenities card holds, in
  order, the elevator switch, the parking select, the furnished group and the pets switch; the flexible switch comes
  after the date input; after "הבא" with floor 5 and total 3 the floor box has the class `border-danger` and each
  of the two inputs' `aria-describedby` names only its own alert (or none). —
  `web/src/features/listings/__tests__/DetailsStep.test.tsx::ac2_groups_keep_field_order`
- [ ] AC3 Given step 3, When a household is checked or unchecked, Then an `aria-hidden` check mark shows in exactly
  the checked segments. — `ListingWizard.test.tsx::ac3_households_check_mark`
- [ ] AC4 Given `LifestyleFields`, Then every question has one `lifestyle-clear-row`, answered or not, and a "ניקוי"
  button sits inside it only for an answered question (0007d's AC3 still holds). —
  `web/src/features/lifestyle/__tests__/LifestyleFields.test.tsx::ac4_clear_row_reserved`
- [ ] AC5 Given the edit wizard with a changed price, When the back link is clicked, Then a dialog titled
  `listings.edit.leaveConfirm` opens and the path stays; "המשך עריכה" closes it with the value kept; a second click and
  "יציאה בלי שמירה" go to `/me/listings`. With a clean form (also while the areas load) the link leaves with no dialog.
  `beforeunload` is prevented only while dirty, and no listener remains after a save. —
  `web/src/features/listings/__tests__/EditListingPage.test.tsx::ac9_unsaved_changes_guard` (rewritten from
  `window.confirm` to the dialog; the same cases)
- [ ] AC6 Given a cached `GET /me/listings` holding A, When the edit page's background refetch answers 500, Then the
  form shows and no `ErrorState` (FOLLOWUPS 54). — `EditListingPage.test.tsx::ac2_loads_from_my_listings_and_not_found`
  (one case added)
- [ ] AC7 `PageHeader size="compact"` renders one `<h1>` with `font-sans text-body font-medium` and
  `lg:font-display lg:text-h1`,
  `tabIndex="-1"`, focusable through `titleRef`, the back link in the title's row; the default size is unchanged. —
  `web/src/components/__tests__/PageHeader.test.tsx::compact_size`. `TextInput`'s `<input>` has `self-stretch`. —
  `web/src/components/__tests__/TextInput.test.tsx::ac4_text_input` (one assertion added)
- [ ] AC7b Given a publish that answers 201, Then the wizard navigates to `/me/listings` with `location.state`
  `{ published: true }`; an edit's save still navigates with `{ saved: true }`. The test renders its own
  `/me/listings` route that prints `location.state`. — `ListingWizard.test.tsx::ac7b_publish_hands_over_celebration`
- [ ] AC8 Every other existing wizard, edit-page and room test passes with only the assertion updates under "Tests to
  write": validation and the focus of the first invalid field, a server 422 back to its step, a double click publishes
  once, a PATCH carries only the changed fields, expired read-only with the focused h1, not found. —
  `ListingWizard.test.tsx`, `EditListingPage.test.tsx`, `RoomFields.test.tsx`, `DetailsStep.test.tsx`
- [ ] AC9 E2E. The existing `web/e2e/listings.spec.ts` tests pass unchanged. A new
  `test.step('0009k wizard at 1440 and 390')` at the end of `ac12_owner_edits_listing` (the same owner):
  - 1440×900, `/listings/new` → apartment → "הבא": the stepper list's left edge is at or right of the step h2's right
    edge (−2 px), the h2 is at most 672 px wide, and "הבא" is in the viewport;
  - 390×844, after a reload and the same two clicks: the stepper is above the h2, and "הבא" is in the viewport with
    its bottom edge within 40 px of the viewport's bottom (the bar is sticky; step 2 is longer than the viewport).
  The test calls `test.slow()`. No new sign-up. — `web/e2e/listings.spec.ts::ac12_owner_edits_listing`
- [ ] AC10 Arbitrary values. `grep -noE '[a-z0-9:-]*[a-z0-9]-\[[^] ]+\]'` over the in-scope source files prints only the
  "Arbitrary values" entries and attribute variants; the digest quotes the output. (Colour literals are 0009h's
  `noColourLiterals` guard, which stays green.)
- [ ] AC11 Screens. `make screens` writes 30 PNGs under `web/screens/0009k/` (the 15 states below × `mobile` 390×844
  and `desktop` 1440×900), listed in the digest. The API is answered by `page.route` from
  `web/e2e/screens/fixtures-listings.ts` (owner `/me`, `/areas`, `/me/listings`, the POST / PATCH replies, an empty
  `/me/conversations`, the event stream aborted); an unmatched API request fails the run. No sign-up, no OTP.
  States: 1 type, nothing chosen · 2 type, apartment chosen · 3 details empty · 4 details after "הבא" with errors ·
  5 details filled with the artboard's values (4 rooms, floor 3 of 5, 95 m², elevator and pets on, parking 1, the
  price focused, so it shows the bare "7200") · 6 preferences, apartment · 7 preferences, room (women, 2 flatmates
  aged 27 and 30, two questions answered) · 8 preview, apartment · 9 preview, room · 10 preview with the cap error ·
  11 edit, step 2 · 12 edit, the leave dialog · 13 edit, expired · 14 edit, not found · 15 edit, loading. —
  `web/e2e/screens/listings.screens.ts`
- [ ] NF1 `make lint`, `make test`, `make i18n-check`, `make build-web` and local `make e2e` are green on the final
  head (Speed rule 7); the e2e result and the screens folder go in the digest. Port 5173 is checked free first.

**Review checks** (the ux reviewer, not a test): state 5 at 390 against `CreateListing.dc.html` for layout and
anatomy, row by row G1–G15, and against `design/brand/README.md` for colour, type, shape and voice (ink primary
buttons, `border-strong` inputs, bordered cards with no shadow, Fredoka only for the h2 / desktop h1);
the desktop states against the Desktop section; 768 px once; `/me/profile` at 390 once (the reserved clear rows).

## Tests to write
Component tests use `mockApi` (`vi.stubGlobal('fetch', …)`) as today.
- New: `ListingWizard.test.tsx::ac1_step_headings`, `::ac3_households_check_mark`;
  `DetailsStep.test.tsx::ac2_groups_keep_field_order`; `LifestyleFields.test.tsx::ac4_clear_row_reserved`;
  `PageHeader.test.tsx::compact_size`, `ListingWizard.test.tsx::ac7b_publish_hands_over_celebration`; one case in
  `EditListingPage.test.tsx::ac2_loads_from_my_listings_and_not_found`
  and one assertion in `TextInput.test.tsx::ac4_text_input`.
- Rewritten: `EditListingPage.test.tsx::ac9_unsaved_changes_guard` (the dialog in place of `window.confirm`; 0009d's
  test setup gives jsdom `showModal`).
- Assertion updates only (the behaviour asserted stays):
  - kit `Field` puts no `aria-invalid` on a valid control, so these become `not.toHaveAttribute('aria-invalid',
    'true')`: `DetailsStep.test.tsx:63` (area), `:73` (floor), `:93` (city), `:95`, `:97` (street);
    `EditListingPage.test.tsx:351` (city), `:673` (count); `ListingWizard.test.tsx:524` (minimum contract);
    `RoomFields.test.tsx:150`, `:163`, `:375` (count), and the age slots `:243`, `:244`, `:250`, `:270` (which hold
    either way). The fieldsets' `aria-invalid="false"` checks (`RoomFields.test.tsx:249`, `:392`, `:409`;
    `ListingWizard.test.tsx:468`, `:496`) stay: the fieldsets keep their explicit attribute;
  - `DetailsStep.test.tsx:45` finds the area's alert with `within(screen.getByTestId('area-field'))`, because
    0009h's `EmptyState` nests its message inside a `Card`;
  - a test that found step 3's h2 inside `PreferencesStep`'s own render finds it in the wizard (same level, name).
- Not touched: `ListingCard.test.tsx` (0009i's). `ListingWizard.test.tsx::ac4_preview_then_publish_navigates` checks
  `ListingCard`'s chips (0009i updates that if it lands first) and, at line 185, the my-listings card (0009o's).
E2E: the AC9 step. Screens: AC11.

## Risks / open questions
**Questions for Gilad** (the spec is written on each recommendation, marked "accepted by Gilad 2026-11-12"). Orchestrator: get Q1
and Q3 answered in the digest before the build starts; option (b) or (c) of either changes the build.
- **Q1 Rooms field: segments or select?** The artboard shows segments 2 / 3 / 3.5 / 4 / 5+. The API stores an exact
  count in half steps (1–20). (a) Keep the select of exact half steps, as the kit's `Select` (**recommended, pending
  Gilad**: no data loss, no new control, e2e unchanged). (b) Segments for 1–5 in halves plus "יותר" opening the select
  (nine segments do not fit a row at 390 px; a new composite). (c) The artboard's five segments, "5+" opening a number
  input (2.5- and 5.5-room flats need an extra step).
- **Q3 A back link in the new-listing wizard?** The artboard has a back chevron on "מודעה חדשה"; today only the edit
  wizard has one, with the unsaved-edits guard. (a) None, as today (**recommended; accepted by Gilad 2026-11-12**: the new wizard has
  no leave guard, so a link would drop what was typed; FOLLOWUPS line 35 asks the same of the browser's Back). (b) A
  back link to "my listings" with the same dialog when anything was entered (a new guard). (c) A back link with no
  guard.
(Q2, the expiry date on "my listings", moved to 0009o with the split.)

**Other risks**
- Shared files (the second to merge rebases, Speed rule 3): `ListingWizard.tsx`, `DetailsStep.tsx`,
  `EditListingPage.tsx`, `RoomPreview.tsx` with 0009c / 0009t / 0009b (see Out); `ListingWizard.test.tsx` and
  `listings.spec.ts` with 0009o; `listings.spec.ts:37` with 0009a; `pageWidths.test.ts` with 0009o and 0009m;
  `LifestyleFields.tsx` with 0009m (which renders it as this spec leaves it); `PageHeader.tsx` and `TextInput.tsx`
  with 0009d (two additive edits; 0009d may take them instead, in which case this spec only uses them).
- 0009h's `pageWidths.test.ts` holds one width per page file; if 0009h changes its shape, the two rows move with it.
- The compact header keeps the title start-aligned, not centred as drawn; the step h2 carries the artboard's 24 px,
  in Fredoka.
- Brand amendment (orchestrator, 2026-11-12) applied as a spec edit, without a second verifier round: the brand
  token names, `border` cards with no shadow, `ink` primary buttons, `border-strong` inputs, Rubik below 24 px, the
  brand spacing scale, ink (not accent) done-steps so the progress fill is the one accent fill, and the
  `published` hand-over to 0009o's `Mascot pose="celebrate"`. If 0009d's token or type names differ from the
  amendment's when this builds, the amendment's names win and the coder maps them in the digest.
- The new keys follow the brand voice. Existing keys that do not (e.g. `listings.prefs.households` "מי יכול/ה
  להגיש", `listings.room.genderPreference` "מי יכול/ה לגור בחדר?", `listings.room.ageOf` "שותף/ה {{n}}" with slash
  forms) are 0009b's to reword.
- `LifestyleFields`' reserved row lengthens the questionnaire on the profile page too (about 30 px per unanswered
  question).
- `ac12_owner_edits_listing` grows; `test.slow()` covers the viewport steps (FOLLOWUPS line 156: e2e under load).
- Verifier round 1 (on the combined draft, before the split): 24 findings (9 major, 11 minor, 4 nit), all applied:
  the split into 0009k / 0009o; the desktop grid's body-and-footer wrapper and sticky placement; the 768–1023 px
  layout and the gutter-matched bleed; the hand-built parking row; the `aria-invalid` assertion list; the JS-computed
  floor-box border; the arbitrary-value grep; the touch target carried into `TextInput`; FOLLOWUPS 84 to 0009o; the
  sibling references (0009t, 0009b, 0009a); the i18n'd units; the area branches; the duplicated hints; the footer
  details; the compact `PageHeader`; the LifestyleFields pieces; AC11's testable part; FOLLOWUPS 54; the LTR chevrons;
  the gutter note; the inbox back-link note. Second round waived (one verifier round, Gilad).

FOLLOWUPS claimed (line numbers as of 8c3c480): 53 (the wizard's half: `BackToMine` → `BackLink`; the listing page's
half is 0009j's), 54, 128 (the households half; `ChoiceGroup`'s half is 0009h's), 137. Line 34 is 0009h's (this spec
leaves no colour literal); 84 is 0009o's; 52 and 55 are 0009t's.

## Digest (filled by orchestrator after verification)
See `/digest`.
