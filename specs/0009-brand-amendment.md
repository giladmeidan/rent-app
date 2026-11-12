# Slice 9 / 9b brand amendment (orchestrator, 2026-11-12)

Gilad uploaded the brand kit `design/brand/` (README.md, tokens.json, logos/, mascot/, icons/).
**The brand kit wins over `design/screens-v1/` for colour, type, shape, voice and the name.**
The artboards still give layout and anatomy: sections, order, card structure, and what goes where.

## Fixed names (every spec uses exactly these)
- **Product name:** homie, Hebrew `הומי` (`app.title`). This settles the "דירתי vs דירה" question. Logos come from `design/brand/logos/` as SVGs; never retype them in a font.
- **Colours** (Tailwind `colors`, the same names as tokens.json): `surface`, `surface-subtle`, `ink`, `ink-muted`, `on-ink`,
  `accent`, `accent-strong`, `accent-soft`, `border`, `border-strong`, `success`, `warning`, `danger`,
  `mascot-blush`, `mascot-shade`. The teal set (`#0E7C6B`, `accent.tint`, `accent.text`, `bg #F7F5F2`, `warn`) is gone.
  The page background is `surface`; quiet areas use `surface-subtle`.
- **Type:** `font-display` = Fredoka 600 (only `display`/`h1`/`h2`, never below 24px); `font-sans` = Rubik for the rest.
  Tailwind `fontSize` keys `display`, `h1`, `h2`, `h3`, `body`, `body-sm`, `label`, `caption` carry the tokens.json size,
  line height and weight. Heebo is dropped.
- **Shape:** `rounded-sm` 8, `rounded-md` 12 (buttons, inputs), `rounded-lg` 16 (cards, sheets), `rounded-full` (chips, badges).
  **No shadows on cards**: separate them with `border`. Inputs and controls use `border-strong`.
- **Spacing:** tokens.json space-1…8 equal Tailwind's default 1/2/3/4/6/8, so they need no config. Phones: `px-4` side padding, cards `gap-3`.
- **Kit additions in 0009d:** `Logo` (`variant: wordmark | lockup`, `tone: dark | white`) and `Mascot`
  (`pose: default | hello | search | celebrate | sleep`, min width 96px, never on `accent`, never flipped; one per screen).
  `EmptyState` takes an optional `pose`.
- **Colour rules:** one accent-filled element per screen; primary buttons are `ink` with `on-ink`; accent text only on `surface`,
  and on `accent-soft` use `accent-strong`; status colours always come with an icon or words.
- **Icons:** outline, 1.5–2px stroke, round caps, `ink`/`ink-muted`; no emoji, no filled sets. The app icon and favicon come from `design/brand/icons/`.

## Voice (replaces the slash-form convention)
Never address the user in one gender, and **no slash forms** ("את/ה", "מחפש/ת"): use the plural, the infinitive or a noun
(איפה מחפשים? / פרסום דירה / נרשמים בחינם). Buttons are 1–3 words starting with the action noun (פרסום דירה, שליחת פנייה, שמירה).
An error is "what happened. what to do." in one sentence. An empty state is an invitation with the mascot, never an apology. The
turtle joke appears at most once per flow. One casual word per screen at most.
