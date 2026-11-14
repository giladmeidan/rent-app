---
id: 0009d
title: Screens can be built from the homie brand tokens (design/brand/tokens.json) and a shared UI kit (Button, Card, Tag, Badge, Field with TextInput / Textarea / Select, PageContainer, PageHeader, Tabs, Dialog, Logo, Mascot), shown on a dev-only /dev/kit page
status: done
depends_on: []
reviewers: [code, qa, ux]   # ux: the kit against design/brand and the artboards' anatomy on /dev/kit; qa: keyboard, focus and RTL behaviour of Tabs / Dialog / Field; no security (no data, no endpoint); no perf (no query)
estimate: 1 coder run (upper end, ~4 h)   # coder Opus/high: every Slice 9b screen builds on this kit, and Tabs / Dialog carry the a11y risk. If the run overflows, the coder stops and reports; it never trims an AC
---

## Goal
After this ships, a screen spec builds any screen from the **homie brand tokens** (`design/brand/tokens.json`) and
fourteen shared components in `web/src/components/`. Today it copies one-off hex colours, arbitrary `[Npx]`
classes and per-file button / chip / input class strings (117 hex literals and 433 arbitrary values in 71 `.tsx`
files; no shared Button, Card or Field). The brand fonts load app-wide, and the existing token names point at
brand values, so the app turns from teal / stone to the brand's ink, white and blue at once. The kit itself is used
only by a dev-only gallery at `/dev/kit`.

This serves Dev Plan slice 9 ("Landing + polish"), split into **Slice 9b, the UI pass** (Gilad, 2026-11-12). Its
sources:
- **`specs/0009-brand-amendment.md`** (orchestrator, 2026-11-12) and the brand kit `design/brand/` (README.md,
  tokens.json, logos/, mascot/). **The brand kit wins over `design/screens-v1/`** for colour, type, shape and
  voice. The artboards still give layout and anatomy.

It is the foundation, part 1 of 2. **`0009h`** (depends on this) adds:
- the full-width shell and the page widths;
- the swap of every hex literal and old token name for the brand names, after which it deletes the old names.

`0009a` (landing) and every 9b screen spec (`0009i` search, `0009l` inbox, …) restyle their screens with this kit and
should depend on `0009h`.

## Scope
**In:**

### 1. Brand tokens (`web/tailwind.config.ts`, `theme.extend`)
The values are exactly `design/brand/tokens.json`'s, and the names are exactly the amendment's.

Colours. Each Tailwind class suffix is the token name.

| Token (class suffix) | Value | Config key | Brand use |
| --- | --- | --- | --- |
| `surface` | `#FFFFFF` | `surface.DEFAULT` | page and card background (the page background is `surface`) |
| `surface-subtle` | `#F3F4F6` | `surface.subtle` | search field, image placeholders, quiet sections |
| `ink` | `#111111` | `ink.DEFAULT` | text, headlines, the wordmark, **primary buttons** |
| `ink-muted` | `#5B6370` | `ink.muted` | secondary text and metadata |
| `on-ink` | `#FFFFFF` | `'on-ink'` | text and icons on `ink` and on `accent` |
| `accent` | `#2563EB` | `accent.DEFAULT` | links, badges, selected states, focus rings; as text only on `surface` |
| `accent-strong` | `#1D4ED8` | `accent.strong` | hover / pressed accent; accent text on `accent-soft` |
| `accent-soft` | `#E8F0FE` | `accent.soft` | highlighted rows, selected backgrounds, illustration grounds |
| `border` | `#E5E7EB` | `border.DEFAULT` | card outlines and dividers (decorative) |
| `border-strong` | `#868E9B` | `border.strong` | input and control borders (3.3:1) |
| `success` | `#15803D` | `success` | status text and icons, always with words or an icon |
| `warning` | `#B45309` | `warning` | status text and icons, always with words or an icon |
| `danger` | `#DC2626` | `danger` | error text, destructive buttons |
| `mascot-blush` | `#BFD3FA` | `mascot.blush` | illustration only |
| `mascot-shade` | `#DDE4F1` | `mascot.shade` | illustration only |

The classes read `bg-surface-subtle`, `text-ink-muted`, `border-border`, `border-border-strong`,
`divide-border` and `text-on-ink`.

**Deprecated aliases, so `main` never breaks between this PR and `0009h`.**
- The old token names stay for now and point at brand values:

  | Old name | Points at |
  | --- | --- |
  | `bg` | `#FFFFFF` (= `surface`) |
  | `muted` | `#5B6370` (= `ink-muted`) |
  | `line` | `#E5E7EB` (= `border`) |
  | `accent.tint` | `#E8F0FE` (= `accent-soft`) |
  | `accent.text` | `#1D4ED8` (= `accent-strong`) |
  | `warn.DEFAULT` | `#F3F4F6` (= `surface-subtle`) |
  | `warn.text` | `#B45309` (= `warning`) |

- Every existing class (`bg-bg`, `text-muted`, `border-line`, `bg-accent-tint`, `text-accent-text`, `bg-warn`,
  `text-warn-text`) keeps rendering, now in brand colours.
- They sit under a `// DEPRECATED — 0009h renames every use and deletes these` comment.
- The kit (§3) never uses them.
- The teal set (`#0E7C6B`, `#E6F4F1`, `#0B5F52`, `#F7F5F2`, `#FEF3C7`, `#92400E`) is gone.

Type:
- `fontFamily`:
  - `display: ['Fredoka', '"Rubik Variable"', 'Rubik', 'system-ui', 'sans-serif']`;
  - `sans: ['"Rubik Variable"', 'Rubik', 'system-ui', 'sans-serif']`.
  - `body` already applies `font-sans` (`index.css`).
- `fontSize` carries the tokens.json size, line height and weight:

  | Key | Value | Family |
  | --- | --- | --- |
  | `display` | `['48px', { lineHeight: '52px', fontWeight: '600' }]` | display |
  | `h1` | `['32px', { lineHeight: '40px', fontWeight: '600' }]` | display |
  | `h2` | `['24px', { lineHeight: '32px', fontWeight: '600' }]` | display |
  | `h3` | `['18px', { lineHeight: '26px', fontWeight: '500' }]` | sans |
  | `body` | `['16px', { lineHeight: '24px', fontWeight: '400' }]` | sans |
  | `body-sm` | `['14px', { lineHeight: '20px', fontWeight: '400' }]` | sans |
  | `label` | `['14px', { lineHeight: '20px', fontWeight: '500' }]` | sans |
  | `caption` | `['12px', { lineHeight: '16px', fontWeight: '500' }]` | sans |

  `font-display` goes only with `text-display` / `text-h1` / `text-h2` (Fredoka never below 24px or for running
  text). Tailwind's default `xs`…`3xl` keys stay for existing code until its screen spec.
- **Fonts are self-hosted and load app-wide from here.** `0009a`'s Heebo package is dropped; the orchestrator moves
  font loading from `0009a` to this spec.
  - `web/package.json` (`dependencies`, exact versions pinned at build time, as the file does):
    `@fontsource-variable/rubik` (Rubik, Hebrew + Latin, OFL-1.1) and `@fontsource/fredoka` (only `600.css` is
    imported; Hebrew + Latin, OFL-1.1).
  - `web/src/app/main.tsx` imports `@fontsource-variable/rubik` and `@fontsource/fredoka/600.css` before
    `index.css`.
  - No Google Fonts CDN, so no third-party request and no visitor IP is sent out.

Shape:
- `borderRadius`: `sm` 8px, `md` 12px (buttons, inputs, the search field) and `lg` 16px (cards, sheets, dialogs).
  These override Tailwind's defaults for those three keys. `full` is for chips and badges. Today one class uses
  `rounded-lg` (`LifestyleFields.tsx:25`, the clear button): it goes 8 → 16px, which is harmless.
- **No shadows on cards or sheets**; they are separated by `border`. `boxShadow` keeps only small control
  elevations: `thumb` `0 1px 3px rgba(0,0,0,0.2)` (switch thumb), `segment` `0 1px 2px rgba(0,0,0,0.08)` (the
  selected segment), `pin` `0 3px 8px rgba(0,0,0,0.12)` (map price chips).

Space and size:
- tokens.json `space-1…8` equal Tailwind's default `1 / 2 / 3 / 4 / 6 / 8`, so they need no config. Phones use
  `px-4` side padding, and cards sit `gap-3` apart.
- `spacing` adds only `tap` 2.75rem (44px, the touch target) and `13` 3.25rem (52px, the large button). In
  Tailwind 3.4, `minHeight`, `minWidth`, `width` and `maxWidth` include the spacing scale, so `min-h-tap`, `w-tap`
  and `min-h-13` exist (AC1 asserts it).
- `maxWidth`: `narrow` 30rem (480px), `page` 45rem (720px), `wide` 83.5rem (1336px; 1400px with the `lg`
  gutters), `dialog` `min(28rem, calc(100% - 2rem))`.
- Breakpoints stay Tailwind's defaults. `lg` (1024px) is the desktop switch, and `md` (768px) widens the gutters.

`design/README.md`: the "Tokens to lift into Tailwind config: …" sentence becomes "Colour, type, shape and voice
come from `design/brand/` (it wins over these artboards); the tokens live in `web/tailwind.config.ts` (spec 0009d)
and the components in `web/src/components/`. The artboards give layout and anatomy."

### 2. Brand assets
- Byte-identical copies go in `web/src/assets/brand/`:
  - `logos/`: `homie-wordmark-he.svg`, `homie-wordmark-he-white.svg`, `homie-wordmark-en.svg`,
    `homie-wordmark-en-white.svg`, `homie-lockup-he.svg`, `homie-lockup-en.svg`;
  - `mascot/`: `homie-turtle.svg`, `homie-turtle-hello.svg`, `homie-turtle-search.svg`,
    `homie-turtle-celebrate.svg`, `homie-turtle-sleep.svg`.
- They are imported as URLs (`import src from '…svg'`; `vite/client` types cover it). They are rendered as
  `<img>`, never inlined:
  - the files carry fixed ids (the lockup's `clipPath id="r"`), so two inline copies would collide;
  - the files stay out of the JS bundle, and Vite hashes them;
  - only the poses a screen imports are fetched.
- The app icon and favicon (`design/brand/icons/`) are `0009a`'s (PWA, `web/public`).

### 3. Helpers and class rules
- `web/src/components/focusRing.ts`:
  - `focusRing` = `'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
    focus-visible:outline-accent'`. Accent is the brand's focus colour, and ~30 feature files repeat this string
    today.
  - `focusRingInk` is the same with `outline-ink`. It is for controls **filled with `accent`**, where a blue ring
    would read as a thicker control (FOLLOWUPS 15, `0009c` §3). Primary buttons are `ink`, so they take the accent
    ring.
- `web/src/components/cx.ts`: `cx(...parts: (string | false | null | undefined)[]): string` joins the truthy
  parts with one space.
- `web/src/components/useMediaQuery.ts`:
  - `useMediaQuery(query: string): boolean`, built on `useSyncExternalStore` over `window.matchMedia(query)`. It is
    `false` when `matchMedia` is missing (jsdom), so existing tests keep the phone layout.
  - `useIsDesktop()` = `useMediaQuery('(min-width: 1024px)')`. `0009i` and `0009l` share it.
- **Class rules**, which the code reviewer checks:
  - A component's `className` is for layout only: margins, flex / grid placement, width, and the `Logo`'s height.
    It never overrides colour, size or padding; a missing look is a new variant with a test. Without
    `tailwind-merge`, conflicting classes resolve by CSS order.
  - A state or size **swaps** its class and never appends a conflicting one, e.g.
    `invalid ? 'border-danger' : 'border-border-strong …'`.
  - The kit uses brand names only, never the deprecated aliases.
  - `i18n-check` flags a non-attribute string literal in a `.tsx` file that holds two adjacent bare Latin words,
    such as `'relative flex …'`. Keep such variant maps in a `.ts` sibling (e.g. `Button.classes.ts`), or avoid
    such pairs.
- **Brand rules the kit encodes**, which screen specs follow:
  - one accent-filled element per screen;
  - accent text only on `surface`, and `accent-strong` on `accent-soft`;
  - status colours only with words or an icon;
  - outline icons, 1.5–2px stroke, round caps, in `ink` / `ink-muted`, with no emoji;
  - one `Mascot` per screen.

### 4. Components
Each is a named export in `web/src/components/<Name>.tsx` with its own test file
`web/src/components/__tests__/<Name>.test.tsx`. All use logical properties only and give every interactive element
a target of at least 44×44 px and a focus ring. **`Button`, `TextInput`, `Textarea` and `Select` forward their
ref** with `forwardRef`.

**`Button`** (Button.tsx):
- Types: `forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>`, with
  `ButtonProps = ButtonAsButton | ButtonAsLink`, discriminated on `to`.
  - `ButtonAsButton`: the native `<button>` attributes, with `type` defaulting to `"button"`, plus `busy` and
    `disabled`.
  - `ButtonAsLink`: `to` plus `Link`'s props. It has no `busy`, `disabled` or `type`.
- Common props:
  - `variant`: `'primary' | 'secondary' | 'soft' | 'ghost' | 'danger'` (default `primary`);
  - `size`: `'sm' | 'md' | 'lg'` (default `md`);
  - `shape`: `'rounded' | 'pill'` (default `rounded`);
  - `fullWidth`, `icon` (a leading node, `aria-hidden`), `children`, `className`.
- Without children, `aria-label` is required by the type. The button is then square: `px-0 w-tap`, or
  `px-0 w-13` for `lg`. Icon-only **replaces** the size's padding.
- Variants, each with `focusRing`:
  - `primary`: `bg-ink text-on-ink hover:bg-ink/85` (brand: primary buttons are ink);
  - `secondary`: `border border-border-strong bg-surface text-ink hover:bg-surface-subtle`;
  - `soft`: `border border-accent bg-accent-soft text-accent-strong` (a selected or pressed state, "הסרה
    מהרשימה");
  - `ghost`: `bg-transparent text-accent hover:bg-accent-soft hover:text-accent-strong` (disclosures, inline
    actions);
  - `danger`: `bg-danger text-on-ink hover:bg-danger/90` (destructive confirm).
- Sizes:
  - `sm`: `min-h-tap px-3 text-label`;
  - `md`: `min-h-tap px-4 text-body font-medium`;
  - `lg`: `min-h-13 px-5 text-body font-medium`.
  - All are `rounded-md`. `pill` swaps that for `rounded-full`.
  - Labels are 1–3 words, starting with the action noun ("פרסום דירה", "שמירה"). That is the copy's rule, not the
    component's.
- Shared classes: `inline-flex items-center justify-center gap-2 text-center transition-colors
  motion-reduce:transition-none disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60`.
  `fullWidth` adds `w-full`.
- `busy`:
  - it sets `aria-busy="true"` and `aria-disabled="true"`;
  - the click handler calls `event.preventDefault()` and does not call `onClick`, so a busy submit never submits
    the form;
  - the button stays enabled and focusable, so focus is never dropped (the `0008b` lesson).
- Also exports `buttonClasses({ variant, size, shape, fullWidth, iconOnly })`.

**`Card`** (Card.tsx): the bordered box. It has no shadow and is always `rounded-lg`.
- Props:
  - `as`: `'div' | 'article' | 'section' | 'li'` (default `div`);
  - `variant`: `'default' | 'selected' | 'muted'`;
  - `padding`: `'none' | 'sm' | 'md' | 'lg'` (`p-3` / `p-4` / `p-6`; default `sm`, the brand's 12px card padding);
  - `interactive`, `className`, `children`, and HTML attributes.
- Variants:
  - `default`: `bg-surface border border-border`;
  - `selected`: `bg-surface border border-accent ring-1 ring-inset ring-accent` (2px of accent with no layout
    shift);
  - `muted`: `bg-surface-subtle`, no border.
- `interactive` is for a card whose title link is stretched over it. It adds `relative` and `ListingCard.tsx:13`'s
  ring: `has-[a:focus-visible]:outline has-[a:focus-visible]:outline-2 has-[a:focus-visible]:outline-offset-2
  has-[a:focus-visible]:outline-accent`. Only on `variant="default"`, it also adds `hover:border-border-strong`.

**`Tag`** (Tag.tsx): a static chip. The selectable chip stays `ChoiceGroup`.
- Props:
  - `tone`: `'neutral' | 'accent' | 'warning' | 'inverse'` (default `neutral`);
  - `size`: `'sm' | 'md'` (default `md`);
  - `icon`, `as` (`'span' | 'li'`), `children`, `className`.
- Classes: `inline-flex items-center gap-1 rounded-full`. Sizes: `sm` is `px-2.5 py-1 text-caption`; `md` is
  `px-3 py-1.5 text-label`.
- Tones:
  - `neutral`: `border border-border bg-surface-subtle text-ink`;
  - `accent`: `bg-accent-soft text-accent-strong` (match agrees, "שותפים בגילך");
  - `warning`: `bg-surface-subtle text-warning` (a "differs" chip, whose words carry the status);
  - `inverse`: `bg-ink text-on-ink` (the one badge allowed in a photo's top corner, "חדר בדירת שותפים").

**`Badge`** (Badge.tsx): a count, "new", or a score pill.
- Props:
  - `tone`: `'accent' | 'neutral' | 'solid' | 'inverse' | 'warning'` (default `accent`);
  - `size`: `'sm' | 'md'` (default `sm`);
  - `srLabel` (sr-only text; the visible children become `aria-hidden`), `children`, `className`.
- Classes: `inline-flex items-center justify-center whitespace-nowrap rounded-full`. Sizes: `sm` is
  `px-2 py-0.5 text-caption`; `md` is `px-2.5 py-1 text-label`.
- Tones:
  - `accent`: `bg-accent-soft text-accent-strong` ("חדש", the brand's badges);
  - `neutral`: `bg-surface-subtle text-ink-muted`;
  - `solid`: `min-w-5 bg-accent text-on-ink tabular-nums` (counts, the high-score pill; counts as the screen's
    accent-filled element);
  - `inverse`: `bg-ink text-on-ink`;
  - `warning`: `bg-surface-subtle text-warning`.

**`Field`** (Field.tsx): a label, a control, a hint and an error.
- Props: `label: string`, `hint?: string`, `error?: string`, `id?`, `labelHidden?`, `className`, `children` (one
  control).
- Order: label (`text-label text-ink`), control, hint (`text-caption text-ink-muted`), error (`text-body-sm
  text-danger`, `role="alert"`; its copy is "what happened. what to do."), in a `flex flex-col gap-1.5`.
- Ids come from `useId()`: the control is `id ?? ${base}-control`, the hint `${base}-hint`, the error
  `${base}-error`.
- `FieldContext` gives the child control `{ id, describedBy, invalid }`. `describedBy` holds the rendered hint and
  error ids; `invalid` is `error !== undefined`.
- Precedence inside a `Field`:
  - the context `id` wins;
  - `invalid` is the control's own `invalid` or the context's;
  - `aria-describedby` is the context ids, then the control's own.
- `useField()` returns the context (or `null`), for custom controls such as the floor box with two inputs.

**`TextInput`** (TextInput.tsx): a native `<input>` in a box.
- Props: every input attribute except `size`, plus `invalid?`, `start?` / `end?` adornments (a unit such as "₪",
  "מ״ר", an icon, or a second bare input), and `size: 'md' | 'lg'` (default `md`).
- The ref is the `<input>`; `className` goes to the box. It takes the `Field` context.
- Box: `flex items-center gap-1.5 rounded-md border px-3 text-ink-muted focus-within:ring-2
  focus-within:ring-accent-soft`, with `min-h-12` (`md`, 48px) or `min-h-13` (`lg`, 52px). The swaps are computed
  from the resolved `invalid` / `disabled`:
  - border: `invalid ? 'border-danger' : 'border-border-strong focus-within:border-accent'`. An invalid field stays
    red while focused;
  - background: `disabled ? 'bg-surface-subtle opacity-60' : 'bg-surface'`.
- The input: `min-w-0 flex-1 bg-transparent py-2 text-ink outline-none placeholder:text-ink-muted`, plus by size
  either `text-body` (`md`, 16px, so iOS does not zoom) or `text-h3` (`lg`, the price), never both.
- Adornments are plain text, `shrink-0`, outside the accessible name: `text-body-sm` for `md`, `text-label` for
  `lg`. A unit that matters goes in the label or hint.

**`Textarea`** (Textarea.tsx): the same box as a native `<textarea>`.
- Props: `rows` (default 4), plus the context wiring and `invalid`. The ref and `className` are on the
  `<textarea>`.
- Classes: `block w-full rounded-md border px-3 py-2.5 text-body text-ink outline-none resize-y
  placeholder:text-ink-muted focus:ring-2 focus:ring-accent-soft`. The swaps are `TextInput`'s with `focus:`,
  computed from the resolved `invalid`.

**`Select`** (Select.tsx): a native `<select>`.
- The ref is the `<select>`; `className` goes on a `relative` wrapper.
- The select: `min-h-12 w-full appearance-none rounded-md border ps-3 pe-10 text-body text-ink outline-none
  focus:ring-2 focus:ring-accent-soft`, plus `TextInput`'s swaps with `focus:`.
- A chevron (`M6 9l6 6 6-6`, stroke 2, round caps, `aria-hidden`) sits at `pointer-events-none absolute end-3
  top-1/2 -translate-y-1/2 text-ink-muted`.

**`PageContainer`** (PageContainer.tsx):
- Props: `width: 'narrow' | 'default' | 'wide'` (default `default`); `as: 'div' | 'section' | 'article'`;
  `className`; `children`; HTML attributes.
- Classes: `mx-auto box-content px-4 md:px-6 lg:px-8`, plus `max-w-narrow` / `max-w-page` / `max-w-wide`.
  - The gutters sit outside the width, and phones keep the brand's `px-4`.
  - Never add `w-full`.
  - A page that bleeds to the edges does not use it.

**`PageHeader`** (PageHeader.tsx):
- Props:
  - `title: string`, `subtitle?: string`, `actions?: ReactNode`;
  - `back?: { to: string; label: string; onClick?: (event: MouseEvent<HTMLAnchorElement>) => void }`;
  - `titleRef?`, `titleId?`, `className`.
- The root is `<div className="flex flex-col gap-1">`; landmarks are `0009c`'s. Inside it:
  - the `back` link;
  - a `flex flex-wrap items-end justify-between gap-x-4 gap-y-3` row. Its start holds the `<h1>`
    (`font-display text-h2 lg:text-h1 break-words`, `tabIndex={-1}`, `focus:outline-none`) and the subtitle
    (`text-body-sm text-ink-muted`). Its end holds the actions (`flex flex-wrap gap-2`).
- Also exports **`BackLink`** (`{ to, label, onClick? }`): a `Link` with `inline-flex min-h-tap items-center gap-1
  self-start rounded-md text-label text-ink-muted hover:text-ink` and `focusRing`, plus a 14px outline chevron
  `M9 6l6 6-6 6` (stroke 2, round caps). The chevron points to the inline start in RTL, and `ltr:rotate-180` turns
  it for LTR. It is FOLLOWUPS line 53's shared back link; replacing `BackToMine` is the screen specs' job.

**`Tabs`** (Tabs.tsx): real ARIA tabs.
- Types: `Tabs<T extends string>`, with id-safe values (`[A-Za-z0-9_-]`).
- Props: `label`, `items: readonly { value: T; label: ReactNode }[]`, `value`, `onChange`, `panelId` (required),
  `variant: 'underline' | 'pill'` (default `underline`), `tabRef?`, `className`.
- Each tab is a `<button type="button" role="tab">` with `id={tabId(panelId, value)}`, `aria-selected` and
  `aria-controls={panelId}`. The `tabIndex` is roving (0 when selected, -1 otherwise).
- Keys:
  - activation is automatic, and a click also calls `onChange`;
  - direction is `el.closest('[dir]')?.getAttribute('dir') === 'ltr' ? 'ltr' : 'rtl'`. In RTL, `ArrowLeft` is next
    and `ArrowRight` previous; in LTR the reverse;
  - the arrows wrap, and `Home` / `End` go to the first / last tab;
  - a key that lands on the already-selected tab does nothing.
- Variants, each with `focusRing`:
  - `underline`: the list is `flex flex-wrap gap-1 border-b border-border`. A tab is `min-h-tap border-b-2 px-4
    text-label`: `border-accent text-accent font-semibold` when selected, `border-transparent text-ink-muted
    hover:text-ink` when not;
  - `pill`: the list is `inline-flex rounded-full bg-surface-subtle p-0.5`. A tab is `min-h-tap rounded-full
    px-3.5 text-label`: `bg-surface text-ink font-semibold shadow-segment` when selected, `text-ink-muted` when
    not.
- Also exports **`tabId(panelId, value)`** (`${panelId}-tab-${value}`) and **`TabPanel`** (`{ panelId, value,
  focusable?, className, children }`). `TabPanel` renders `role="tabpanel"` with `aria-labelledby`, and
  `tabIndex={0}` only when `focusable`.

**`Dialog`** (Dialog.tsx): a modal built on the native `<dialog>`.
- Props: `open: boolean`, `onClose: () => void`, `title: string`, `description?: string`, `children?`,
  `actions?: ReactNode`, `initialFocusRef?`.
- It is safe under `<StrictMode>`:
  - the `open` prop is never passed to the DOM;
  - one effect on `[open]`: if `open && !el.open`, it stores the opener (`document.activeElement`, unless that is
    inside the dialog), calls `showModal()` and focuses `initialFocusRef`. If `!open && el.open`, it calls
    `close()`;
  - no effect cleanup closes the dialog;
  - on `close`, it focuses the opener if that is still connected, and calls `onClose()` if `open` is still `true`;
  - `cancel` (Esc) is `preventDefault`ed and calls `onClose()`;
  - the backdrop closes it only when both the `pointerdown` target and the `click` target are the `<dialog>`.
- Anatomy:
  - `<dialog aria-labelledby aria-describedby className="w-full max-w-dialog p-0 rounded-lg border border-border
    bg-surface text-ink backdrop:bg-ink/40">`, with no shadow;
  - inside it, `<div className="flex flex-col gap-4 p-6">` holds the title (`<h2 className="text-h3">`; Rubik, as
    Fredoka never goes below 24px), the description (`text-body text-ink-muted`), the children and the actions
    (`flex flex-wrap justify-end gap-2`).
- Also exports **`useConfirm()`**, which returns `[confirm, dialog]`. It is the drop-in for `window.confirm`.
  - `confirm` is stable (`useCallback`). `confirm(options)` returns a `Promise<boolean>`.
  - The options are `title: string`, `body?: string` (the description), `confirmLabel?` (default
    `common.confirm`), `cancelLabel?` (default `common.cancel`) and `tone: 'primary' | 'danger'`.
  - Cancel (`Button variant="secondary"`) is focused first and comes first in the DOM. Confirm (`primary` or
    `danger`) comes second.
  - Confirm resolves `true`. Cancel, Esc and the backdrop resolve `false`.
  - A second `confirm()` while one is open resolves the first with `false`, and so does unmounting while open.
  - `confirm()` is async: a link guard must `preventDefault()` first and `navigate()` after `true`.

**`Logo`** (Logo.tsx): the wordmark or lockup from §2, as an `<img>`. It is never retyped in a font, recoloured
or stretched.
- Types: `LogoProps = { variant?: 'wordmark'; tone?: 'dark' | 'white' } | { variant: 'lockup'; tone?: 'dark' }`,
  plus `lang?: 'he' | 'en'` (default `he`), `decorative?: boolean` (default `false`) and `className`. There is no
  white lockup file, so the type forbids that pairing.
- File choice: `homie-{wordmark|lockup}-{lang}{tone === 'white' ? '-white' : ''}.svg`.
- `alt` is `t('app.title')`, or `""` when `decorative`, for a logo inside a link that already names itself.
- Height comes from `className` (e.g. `h-7`), and the width is always `auto`, so the aspect ratio holds. It never
  takes both a width and a height. `w-auto` is set inside the component, so a caller cannot stretch it.
- Usage rules:
  - `dark` on `surface`, `surface-subtle` and `accent-soft`; `white` on `ink` and `accent`;
  - clear space around it equal to the height of the letter ו is the caller's job.

**`Mascot`** (Mascot.tsx): the homie turtle, as an `<img>` of a 400×300 file.
- Props:
  - `pose`: `'default' | 'hello' | 'search' | 'celebrate' | 'sleep'` (default `default`);
  - `width?: number` (default 160; any value below 96 is raised to 96, the brand minimum);
  - `alt?: string` (default `""`, decorative beside its text; a caller that gives it meaning passes a `he.json`
    string);
  - `className` (layout only).
- It renders `<img src width={w} height={w * 0.75} alt draggable={false}>`, with no transform class. It has no
  prop to flip, recolour or crop it.
- `MascotPose` is exported for `EmptyState` (`0009h`).
- Usage rules for screens: one per screen; never on `accent` (the shell disappears), only on `surface` or
  `accent-soft`. The poses' uses come from the brand README:
  - `default`: onboarding, about;
  - `hello`: welcome, sign-up;
  - `search`: no results, a search loading;
  - `celebrate`: listing published, application sent;
  - `sleep`: empty lists.

### 5. `/dev/kit` (dev only)
- `web/src/app/KitPreview.tsx` (default export) shows every component in every variant, size and state.
  - It renders `<main><PageContainer width="wide" className="flex flex-col gap-8 py-8">…</PageContainer></main>`.
  - It is mounted **outside** `Layout`, so it has no app header and shows the real widths.
  - It makes no API call.
- Its sections are unlabelled `<section>`s, with no captions. In order:
  1. a `PageHeader` (title `app.title`, back link `common.back` to `/`, a secondary action);
  2. the `Button` grid;
  3. `Tag` / `Badge`;
  4. `Card`;
  5. `Field` with `TextInput` (plain, hint, error, `lg` with `listings.units.ils`), `Textarea` and `Select`;
  6. both `Tabs` variants with a `TabPanel`;
  7. two `useConfirm` openers;
  8. the `Logo` variants (a `dark` wordmark on `surface`, a `white` wordmark on an `ink` strip, the lockup, `en` and
     `he`);
  9. the five `Mascot` poses at 120px (the gallery is the one exception to "one per screen");
  10. a strip per `PageContainer` width.
- Text comes only from existing `he.json` keys plus §7's two keys. These are fixed for the e2e test:
  - `flatmates.mine.leave` labels only the `danger` opener;
  - the opener calls `confirm({ title: t('flatmates.mine.leaveConfirm'), confirmLabel: t('flatmates.mine.leave'),
    tone: 'danger' })`;
  - the underline `Tabs` demo uses `applicants.filter.all` / `.new` / `.shortlisted` / `.declined` with
    `{ count: 0 }`.
- `web/src/app/routes.tsx`:
  - adds `const KitPreview = import.meta.env.DEV ? lazy(() => import('./KitPreview')) : null;`;
  - puts `{KitPreview && <Route path="dev/kit" element={<Suspense fallback={<PageContainer><Skeleton
    /></PageContainer>}><KitPreview /></Suspense>} />}` as a **top-level sibling before**
    `<Route element={<Layout />}>`;
  - neither the route nor the chunk ships in `make build-web`;
  - `Layout.tsx` is not touched.

### 6. Test setup
`web/src/test-setup.ts` installs a `<dialog>` stand-in **unconditionally**:
- `showModal()` sets `open`, and is a no-op when already open;
- `close()` removes `open` and dispatches `close` synchronously, and is a no-op with no event when already closed.

The real modal behaviour is proven in a browser (AC11).

### 7. Copy (`web/src/locales/he.json`)

| Key | Hebrew |
| --- | --- |
| `common.cancel` | "ביטול" |
| `common.confirm` | "אישור" |

Both are nouns: gender-neutral, with no slash form, as the brand voice requires.

### 8. FOLLOWUPS
This PR's coder adds:
`- [ ] 0009d · web/src (tests) · add a guard, like 0009h's noColourLiterals.test.ts, against arbitrary [Npx] /
radius classes and Tailwind's default xs–3xl font sizes once the 9b screen specs have moved to the brand tokens ·
the screens still use ~430 arbitrary values`.

**Out:**
- The full-width shell (`Layout.tsx`), the page widths, renaming every old token class and hex literal to the brand
  names, deleting the deprecated aliases, and restyling `ChoiceGroup`, `EmptyState` (with its `pose`),
  `ErrorState`, `Skeleton`, `Switch` and `MapCanvas` onto the kit: **`0009h`**. This spec does not touch
  `web/src/features/**` or `Layout.tsx`.
- Migrating screens to the kit, the brand voice and `useConfirm`: the 9b screen specs.
- A sticky bottom action bar, an inline notice style, and a `ChoiceGroup` multi-select: not in the kit.
- The header and brand placement, the landing, the app icon, the favicon, the PWA colours (`vite.config.ts`,
  `index.html`), font **preload** tags and the product name `app.title` "הומי": `0009a` / `0009e`.
- The skip link, landmarks and the focus behaviour of existing screens: `0009c`.
- Dark mode (the brand has one theme) and an icon library.

**New dependencies:** `@fontsource-variable/rubik` and `@fontsource/fredoka`. They are the brand's two fonts
(OFL-1.1), self-hosted, and replace `0009a`'s Heebo package. There is no `clsx`, `tailwind-merge`, Headless UI or
Radix. `tailwindcss/resolveConfig` ships with `tailwindcss`.

## Data
None (web only).

## API
None.

## UI
`/dev/kit` exists only under `pnpm dev` (`make dev`, `make e2e`, CI e2e), outside the app shell.
- `/dev/kit` states: **loading** is the lazy chunk's `Skeleton`; **success** is the gallery. With no data, there is
  no empty, error or 401 state.
- App-wide, from this PR on:
  - the text font is Rubik;
  - the existing token classes render in brand colours: ink text, white page, blue accent, the brand greys. The
    deprecated aliases make this happen;
  - the remaining hex literals (stone greys, the old red) stay until `0009h`, which follows straight after.
  - The UX reviewer checks that no screen becomes unreadable in this mixed state. The accent's contrast on white
    (5.2:1) and `ink-muted`'s (6.1:1) are at least the old ones.
- RTL:
  - logical classes only;
  - `Select`'s chevron sits at the inline end, and `BackLink`'s chevron points to the inline start;
  - Dialog actions align to the inline end;
  - in RTL, `ArrowLeft` is the next tab;
  - the mascot is never flipped. Its pose faces the way the file draws it, whatever the direction.
- The UX reviewer compares `/dev/kit` at 390px and 1280px with `design/brand/README.md` (colour, type, shape, logo,
  mascot rules) and with the artboards' anatomy (`CreateListing.dc.html` fields and switch row,
  `InboxDesktop.dc.html` cards, tabs, badges and page header, `SearchDesktop.dc.html` tags and inputs).
- Accepted differences from the artboards: brand colours, type and radii replace theirs, and small buttons are
  44px tall.

## Acceptance criteria
All tests read their Hebrew from `he.json` / `i18n.t`, never a literal. Quoted Hebrew below is for the reader.

- [ ] AC1 Given `web/tailwind.config.ts`:
  - each `theme.extend` group (`colors`, `fontFamily`, `fontSize`, `borderRadius`, `boxShadow`, `spacing`,
    `maxWidth`) `toEqual`s Scope §1, group by group. `colors` includes the deprecated aliases, which `0009h`
    removes from this expectation;
  - every brand colour equals its `design/brand/tokens.json` value, read from the file;
  - `tailwindcss/resolveConfig(config)` resolves:
    - `theme.minHeight.tap`, `minHeight['13']` and `width.tap`;
    - `colors.ink.DEFAULT`, `colors.border.strong` and `colors.mascot.blush`;
    - `borderRadius.md` = 12px and `maxWidth.dialog`;
    - `fontSize.h1`, with line height 40px and weight 600.

  — `web/src/app/__tests__/tokens.test.ts::ac1_token_scale`
- [ ] AC2 `Button`:
  - it renders `<button type="button">` by default;
  - each variant, size and shape adds its Scope classes, and `primary` is `bg-ink text-on-ink`;
  - every variant carries `focus-visible:outline-accent`;
  - `to` renders an `<a href>`, and `fullWidth` adds `w-full`;
  - `busy`:
    - it sets `aria-busy` / `aria-disabled` and does not call `onClick`;
    - the button stays enabled and focusable;
    - a busy submit inside `<form onSubmit>` does not submit;
  - `disabled` disables it;
  - an icon-only button has `w-tap px-0` and no `px-4`, and is named by its `aria-label`;
  - the ref reaches the element, and `buttonClasses` equals the rendered classes.

  — `web/src/components/__tests__/Button.test.tsx::ac2_button`
- [ ] AC3 `Card`, `Tag`, `Badge` and `useMediaQuery`:
  - `Card` renders its `as` element, each variant's and padding's classes, `rounded-lg`, and no `shadow-` class.
    `interactive` adds the four `has-[a:focus-visible]:outline…` classes, plus `hover:border-border-strong` only on
    `default`;
  - `Tag` renders each tone and size as `span` or `li`;
  - `Badge` renders each tone and size, and `srLabel` gives sr-only text with the visible children `aria-hidden`;
  - `useMediaQuery` returns `false` without `matchMedia`, follows a stubbed `change` event, and `useIsDesktop`
    queries `(min-width: 1024px)`.

  — `Card.test.tsx::ac3_card`, `Tag.test.tsx::ac3_tag`, `Badge.test.tsx::ac3_badge`,
  `useMediaQuery.test.tsx::ac3_media_query`
- [ ] AC4 Given a `Field` with a label, a hint and an error around a `TextInput`:
  - the label's `for` is the input's id, and the context id wins;
  - `aria-describedby` lists the hint and error ids, then the input's own;
  - `aria-invalid="true"`, and the error has `role="alert"`;
  - the invalid box has `border-danger` and not `border-border-strong`;
  - a disabled box has `bg-surface-subtle` and not `bg-surface`;
  - `lg` has `text-h3` and not `text-body`;
  - without an error, there is no `aria-invalid` and no error node;
  - a standalone `TextInput` uses its own props, renders `start` / `end`, and its ref is the `<input>`;
  - the same wiring and swaps hold for `Textarea` (ref: the `<textarea>`) and `Select` (ref: the `<select>`;
    the chevron has `pointer-events-none`).

  — `Field.test.tsx::ac4_field_wires_control`, `TextInput.test.tsx::ac4_text_input`,
  `Textarea.test.tsx::ac4_textarea`, `Select.test.tsx::ac4_select`
- [ ] AC5 `PageContainer` renders `max-w-narrow` / `max-w-page` / `max-w-wide` with `box-content`, the gutters
  and `as`. `PageHeader`:
  - its root is a `div`;
  - it renders one `<h1>` with `font-display`, `text-h2`, `lg:text-h1` and `tabIndex="-1"` (`titleRef` focuses
    it), plus the subtitle and the actions;
  - `BackLink` has its `href`, label, `min-h-tap` and focus ring, and calls `onClick`.

  — `PageContainer.test.tsx::ac5_widths`, `PageHeader.test.tsx::ac5_page_header`
- [ ] AC6 Given `Tabs` with four items in `<div dir="rtl">`:
  - one labelled `tablist`; each tab has `aria-selected`, `aria-controls`, a roving `tabIndex`, `min-h-tap` and the
    focus ring;
  - `ArrowLeft` on the first selects and focuses the second;
  - `ArrowRight` on the first wraps to the last, and `End` goes to the last;
  - `Home` on the selected first tab does nothing;
  - a click calls `onChange`;
  - in `dir="ltr"`, `ArrowRight` is next;
  - `TabPanel`'s `aria-labelledby` is the selected tab's id.

  — `Tabs.test.tsx::ac6_tabs_keyboard_rtl`
- [ ] AC7 `Dialog` and `useConfirm`, with the stand-in:
  - `Dialog`:
    - `open` calls `showModal`, and the dialog is named and described;
    - `cancel` calls `onClose` and is `defaultPrevented`;
    - a `close` event while `open` is true calls `onClose`;
    - `pointerdown` and `click` on the dialog close it, but `pointerdown` inside the panel followed by `click` on
      the dialog does not;
    - focus returns to the opener;
    - with `open` already true in `<StrictMode>`, `showModal` is called once and focus returns on close.
  - `useConfirm`:
    - it shows the title, the body as the description, "ביטול" focused first, and "אישור" by default;
    - confirm resolves `true`; cancel, Esc and the backdrop resolve `false`;
    - a second `confirm()` and an unmount resolve the first with `false`;
    - `confirm` keeps its identity across renders;
    - `tone: 'danger'` gives the `danger` classes.

  — `Dialog.test.tsx::ac7_dialog_and_confirm`
- [ ] AC8 `Logo` and `Mascot`:
  - `Logo` renders an `<img>` whose `src` is the matching file for each variant / tone / lang. Its `alt` is
    `app.title`, or empty when `decorative`, and it has `w-auto`.
  - `Mascot` renders the pose's file. `width` 60 becomes 96 (height 72), and the default is 160 × 120. `alt` is
    empty by default, and there is no `scale-x` / `-scale` / `rotate` class.
  - Every file in `web/src/assets/brand/` is byte-identical to its source in `design/brand/`, read with `node:fs`.

  — `Logo.test.tsx::ac8_logo_files_and_alt`, `Mascot.test.tsx::ac8_mascot_pose_and_min_width`,
  `web/src/app/__tests__/brandAssets.test.ts::ac8_assets_match_brand_kit`
- [ ] AC9 `<AppRoutes />` at `/dev/kit`, rendered with `features/auth/__tests__/harness.tsx`'s `renderRoutes` and no
  `mockApi`, shows the `PageHeader`'s `<h1>`, a `tablist`, the `flatmates.mine.leave` opener, five mascot `<img>`s
  and no app header. — `web/src/app/__tests__/KitPreview.test.tsx::ac9_dev_kit_route`
- [ ] AC10 Every kit component has a unit test: for each of `Button`, `Card`, `Tag`, `Badge`, `Field`,
  `TextInput`, `Textarea`, `Select`, `PageContainer`, `PageHeader`, `Tabs`, `Dialog`, `Logo` and `Mascot`,
  `web/src/components/__tests__/<Name>.test.tsx` exists and contains at least one `it(` / `test(`. The list is a
  constant here, and `0009h` widens it to every `src/components/*.tsx`. —
  `web/src/components/__tests__/coverage.test.ts::ac10_every_kit_component_has_a_test`
- [ ] AC11 E2E in Chromium against `pnpm dev` (no sign-up; Hebrew from `he.json`):
  - At 1280×800 on `/dev/kit`, the dialog:
    1. `flatmates.mine.leave` opens a dialog named by `flatmates.mine.leaveConfirm` that `matches(':modal')`,
       with focus on `common.cancel`;
    2. one `Tab` keeps focus inside it;
    3. `Escape` closes it, and focus is back on the opener;
    4. reopening and pressing `page.getByRole('dialog').getByRole('button', { name: leave })` closes it, and focus
       returns.
  - At 1280×800, the tabs: on the underline tablist, `ArrowLeft` selects and focuses the next tab, and `End` the
    last.
  - At 1280×800, every `<img>` has `naturalWidth > 0` (the brand assets resolve).
  - At 1280×800, `getComputedStyle(h1).fontFamily` starts with `Fredoka` and `body`'s with `"Rubik Variable"`;
    `document.fonts.check('600 24px Fredoka', <h1 text>)` is true after `document.fonts.ready`, and the Fredoka and
    "Rubik Variable" faces report `loaded`.
  - At 390×844, there is no horizontal scroll.

  — `web/e2e/kit.spec.ts::ac11_dialog_tabs_brand_in_browser`
- [ ] NF1 `make lint`, `make test`, `make i18n-check` and `make build-web` are green, and local `make e2e` is green
  (Speed rule 7). The result goes in the digest.
- [ ] NF2 After `make build-web`, `grep -rl "KitPreview" web/dist` is empty. The coder reports it in the digest.

## Tests to write
- Unit, one file per component in `web/src/components/__tests__/` (AC2–AC8, AC10), plus `useMediaQuery.test.tsx`
  and `coverage.test.ts`, using Testing Library and `fireEvent` (the repo has no `user-event`).
- `web/src/app/__tests__/tokens.test.ts` (AC1), `brandAssets.test.ts` (AC8) and `KitPreview.test.tsx` (AC9).
- E2E: `web/e2e/kit.spec.ts` (AC11). It uses no sign-ups.

## Risks / open questions
- **A mixed look between this PR and `0009h`.** The aliases re-colour every token class to the brand at once, while
  the hex literals (stone greys, `#B91C1C`) wait for `0009h`.
  - Mitigation: `0009h` is the next web build. A screen spec may not start before it (`depends_on: [0009h]`), and
    the UX reviewer checks readability here.
  - Alternative rejected: keeping the teal values under the old names. `accent` and `ink` must take brand values
    under the same names, so a teal `accent-soft` beside a blue `accent` would look worse.
- **The API is used by nobody until the screen specs.**
  - The names and props are in the shared note `0009d-ui-kit-api.md`, and the requests of `0009a`, `0009c`,
    `0009i`, `0009k` and `0009l` are folded in.
  - A screen spec may **add** a variant or a prop with a test, but never rename or remove one without the
    orchestrator.
- **`className` is not merged.** The §3 rules (layout-only, swap-don't-append) and the code reviewer cover it.
- **Fonts.** Two new font packages add about 40–80 kB of woff2 per visitor (Hebrew + Latin subsets, fetched by
  `unicode-range`). Preload tags are `0009e`'s. Fredoka is used for display sizes only.
- **Input focus indicator.** The accent border plus the soft ring; `0009c` settled that it meets WCAG 1.4.11.
- **`<dialog>` in jsdom.** The stand-in keeps the unit tests deterministic, and AC11 proves the real modal.
- **AC11's font check (amended in review, 2026-11-12).** `document.fonts.check('600 24px Fredoka')` without text
  tests a space, which is in Fredoka's Latin subset; Chrome never fetches that subset on a Hebrew-only page, so the
  bare check is false there. AC11 checks the h1's own text and the loaded faces instead (code reviewer agreed).
- **Product questions for Gilad:** none. The brand kit and the amendment decide colour, type, shape and voice.
- **Verification.** Spec-verifier round 1 rejected with 4 majors, 14 minors and 2 info items; all are applied (see
  `0009h`'s twin note for that spec's round). The second round is waived (one verifier round, Gilad).
- **Brand amendment (orchestrator, 2026-11-12),** applied without re-verification as instructed:
  - tokens.json names and values, with deprecated aliases until `0009h`;
  - Rubik and Fredoka loaded here (moved from `0009a`);
  - `sm` / `md` / `lg` radii and no card shadows;
  - `border-strong` on inputs;
  - `primary` = ink, with the accent focus ring for every variant;
  - `tint` renamed `soft`;
  - Badge tones `accent` / `neutral` / `solid` / `inverse` / `warning` (no `new`);
  - Tag tones `neutral` / `accent` / `warning` / `inverse` (no `overlay`);
  - the old type, radius and shadow tokens dropped;
  - `Logo`, `Mascot` and the brand assets added;
  - the voice rule for the two new keys.

## Digest (filled by orchestrator after verification)
See `/digest`.
