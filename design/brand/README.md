# homie

homie (הומי) is a rental web app for Gush Dan that connects homeowners with people looking to rent an apartment, find a room, or find roommates. The brand is the friend who knows the city: warm, a little cheeky, and clear. The product stays quiet and neutral so the listings and the mascot stand out.

homie is a working name. Hebrew is the launch language, so every layout is right-to-left first.

## Content fundamentals

**Voice.** Speak like a person the same age as the user, not like a real-estate office. Short sentences. Young, but light on slang: one casual word per screen at most.

**Gender-neutral Hebrew.** Never address the user in a single gender. Prefer the plural, the infinitive, or a noun.

| Use | Avoid |
| --- | --- |
| איפה מחפשים? | איפה אתה מחפש? |
| פרסום דירה | פרסם דירה |
| נרשמים בחינם | הירשם בחינם |
| מצאנו 12 דירות בשבילכם | מצאנו לך 12 דירות |

**Buttons.** One to three words, starting with the action: פרסום דירה, שליחת פנייה, שמירה.

**Errors.** Say what happened, then what to do, in one sentence: הקוד לא נכון. אפשר לנסות שוב.

**Empty states.** An invitation with the mascot, never an apology: עוד אין דירות שמורות. לב אחד ואנחנו שם.

**The turtle joke.** The mascot is a turtle and the product is fast. Play on it sparingly (לאט לאט? ממש לא.), never more than once per flow.

## Visual foundations

**Color.** Black and white carry the interface; blue is the only brand color.

- `ink` on `surface` for text, headlines and primary buttons.
- `accent` for links, badges, selected states, focus rings and the turtle's shell. One accent-filled element per screen is usually enough.
- `accent` as text only on `surface`. On `accent-soft` use `accent-strong`.
- `ink-muted` for secondary text. `border` is decorative; inputs and controls take `border-strong`.
- `success`, `warning` and `danger` appear only for status, always with an icon or words as well as the color.
- `mascot-blush` and `mascot-shade` are for illustration only.

There is one theme, Light. Dark mode is not designed yet.

**Type.** Two families, both free on Google Fonts with Hebrew and Latin.

- Fredoka (`display`, weight 600) for the wordmark and the `display`, `h1` and `h2` styles.
- Rubik (`sans`) for everything else: `h3`, `body`, `body-sm`, `label`, `caption`.

Do not use Fredoka below 24px or for running text.

**Shape and space.** Cards use `radius-lg`, buttons and inputs `radius-md`, chips and badges `radius-pill`. Phone screens have `space-4` side padding; cards sit `space-3` apart. No shadows on cards: separate them with `border`.

**Photos.** Listing photos are shown as uploaded, cropped to 16:10 with `radius-lg` top corners. No filters or overlays except a badge in the top corner.

## Logo

The logo is the wordmark, set in Fredoka 600 and converted to outlines: `homie-wordmark-he.svg` (הומי) and `homie-wordmark-en.svg`. Hebrew is the primary version; use the English one only in English contexts.

- Lockups pair the wordmark with the app icon: `homie-lockup-he.svg` (icon on the right) and `homie-lockup-en.svg` (icon on the left).
- Use the black wordmark on `surface`, `surface-subtle` and `accent-soft`, and the `-white` files on `ink` and `accent`.
- Keep clear space around the logo equal to the height of the letter ו / o.
- Do not recolor, stretch, outline or retype the wordmark in another font.

## Mascot

The homie turtle carries a small blue house as its shell: a pitched shingled roof, chimney, door and two windows. It is drawn with a thick `ink` outline, a white body, an `accent` shell, and `mascot-blush` on the cheek.

Poses in the Mascot group:

| File | Use |
| --- | --- |
| `homie-turtle.svg` | Default. Onboarding, about, marketing. |
| `homie-turtle-hello.svg` | Welcome and sign-up screens. |
| `homie-turtle-search.svg` | No search results; loading a search. |
| `homie-turtle-celebrate.svg` | Listing published; application sent. |
| `homie-turtle-sleep.svg` | Empty states: no saved listings, no messages. |

Rules: one turtle per screen. Never place it on `accent` (the shell disappears); use `surface` or `accent-soft`. Do not flip it horizontally, recolor the shell, or draw it without the house. Minimum width 96px; below that use the app icon or favicon.

## Iconography

- App icon: `homie-app-icon.svg`, a close-up of the head and the front of the house on `accent-soft`.
- Favicon and anything under 48px: `homie-favicon.svg`, the face on `accent`.
- Interface icons: outline icons with a 1.5–2px stroke and round caps, in `ink` or `ink-muted`, to echo the mascot's line. No filled or two-tone icon sets, and no emoji in the interface.

## Status of this kit

Version 1. It holds tokens, logo files, the app icon and five mascot poses. There are no coded components yet; the interface is being built separately and should take its values from `tokens.json`.
