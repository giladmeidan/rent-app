---
id: 0010e
title: A lister adds, removes and orders photos in the listing wizard; they upload after publish or save, a partial failure is reported, and the lister's own cards show the cover
status: done
depends_on: [0010a, 0010d]   # 0010a: the wizard's type-skip (firstStep/shown/total) and publish destination; 0010d: listing photo endpoints and the `photos` field
reviewers: [code, qa, ux]   # no security: the client only picks files, the server re-checks everything (0010d has security); ux: a new wizard step with no artboard body; qa: upload sync after publish/save, partial failure, the step refactor
estimate: 1 coder run   # coder Opus/high: the wizard step refactor shifts ~40 test assertions
---

## Goal
After this ships, the listing wizard has a **"תמונות"** step after the details (as `CreateListing.dc.html`'s
stepper: סוג, פרטים, תמונות, העדפות, תצוגה מקדימה). The lister picks up to 10 photos, removes them and moves
them; the first is the cover. The files stay in the browser until the listing is published or saved, then
they are uploaded. If some uploads fail, the listing is still saved, and "my listings" says how many photos did
not upload. The wizard's preview card and the lister's "my listings" cards show the cover.

This serves PRODUCT.md "שוק השותפים" (photos for rooms and apartments; limits Q11) and MARKET-PLAN §7 "Photos
(0010d)". The API is `0010d`. The display side (gallery, public card covers, `Avatar`, profile photo) is
`0010k-photos-display-web` (split by the orchestrator, 2026-11-13). No artboard has a body for the photo step
(MARKET-PLAN §3 Step 3; PRODUCT.md: no new artboards), so the design is in UI below, from the brand kit
(`design/brand/README.md:50`: shown as uploaded, cropped 16:10, only a corner badge) and the artboard stepper.

## Scope
**In:**
- `make client` regenerates `web/src/api/schema.d.ts` (git-ignored). The typed fixtures already carry the new
  fields (`0010d` and `0010j` added them for their own CI). `features/listings/api.ts` exports `type PhotoOut =
  components['schemas']['PhotoOut']`.
- `web/src/features/photos/api.ts` (new): `uploadListingPhoto(listingId, file): Promise<PhotoOut>`,
  `deleteListingPhoto(listingId, photoId)`, `reorderListingPhotos(listingId, ids): Promise<PhotoOut[]>`. Each
  throws `ApiError` (from `features/listings/api.ts`, with the response headers so a 429 carries `retryAfter`)
  like the existing calls (`listings/api.ts:41-60`); the delete (204, so openapi-fetch's `data` is `undefined`)
  checks `!response.ok` as `likes/api.ts:29-33`. The upload sends the `File` itself as the body (0010d: raw
  body, not multipart): `api.POST(path, { params, body: file as unknown as string, bodySerializer: (body) =>
  body, headers: { 'Content-Type': file.type } })`, the cast commented once (`format: binary` is generated as
  `string`). No `FormData`.
- **Shared code with `0010k`** (identical text in both specs, so the two build in parallel; the second to
  merge keeps the first one's copy on rebase and drops its own):
  - `web/src/features/photos/limits.ts`: `MAX_PHOTOS = 10`, `MAX_PHOTO_BYTES = 8 * 1024 * 1024`, `PHOTO_TYPES =
    ['image/jpeg', 'image/png', 'image/webp']`, `PHOTO_ACCEPT = PHOTO_TYPES.join(',')`, and `checkFile(file):
    'type' | 'size' | null` (the API checks again; this only saves a wasted upload). Mirrors 0010d's
    constants; a comment names them.
  - `web/src/features/photos/errors.ts`: `photoErrorText(t, error: unknown): string`: 413 →
    `photos.errors.size`, 415 → `photos.errors.type`, 409 `photo_limit` → `photos.errors.limit`, 429 →
    `photos.errors.rateLimitedIn` with `{{when}}` = `retryAfterText(t, retryAfter)`
    (`components/retryAfter.ts:14-19`), or `photos.errors.rateLimited` without a `Retry-After` (the house
    pair, `he.json:414,417`), anything else (503, network) → `photos.errors.failed`.
  - `he.json` `photos.errors.type` ("אפשר להעלות רק תמונות JPEG, ‏PNG או WebP."), `photos.errors.size` ("התמונה
    גדולה מדי. אפשר לבחור תמונה של עד 8MB."), `photos.errors.limit` ("כבר יש 10 תמונות. אפשר להסיר אחת ולהוסיף
    אחרת."), `photos.errors.rateLimited` ("הרבה העלאות בזמן קצר. אפשר לנסות שוב מאוחר יותר."),
    `photos.errors.rateLimitedIn` ("הרבה העלאות בזמן קצר. אפשר לנסות שוב {{when}}."), `photos.errors.failed`
    ("התמונה לא הועלתה. אפשר לנסות שוב.").
  - `features/listings/ListingCard.tsx` gains `coverUrl?: string | null`. The photo box (`:154-179`) keeps its
    16:10 box and room `Tag`; with a `coverUrl` it renders `<img src={coverUrl} alt="" loading="lazy"
    decoding="async" className="absolute inset-0 size-full object-cover">` (rounded by the box,
    `overflow-hidden`) under the tag, and the placeholder icon only without one or after `onError` (the error
    state resets when `coverUrl` changes). `alt=""`: the card's title names the listing. Test:
    `ListingCard.test.tsx::cover` (image, `alt=""`, error → placeholder, none → today's card).
- Wizard (`features/listings/ListingWizard.tsx`, `PhotosStep.tsx` new, `PreviewStep.tsx`):
  - **Steps.** A step named `photos` comes after `details` and before `preferences`. 0010a keeps the internal
    `step` numeric (1–4) with `firstStep`, `shown = step - firstStep + 1` and `total = 5 - firstStep`; a step
    in the middle breaks that arithmetic, so this spec makes the internal step a name: `type StepName = 'type'
    | 'details' | 'photos' | 'preferences' | 'preview'`, `const order: StepName[]` = all five, minus `type`
    when `firstStep` would be 2 (edit, or `?type=`); `shown = order.indexOf(step) + 1`, `total =
    order.length` (5 with the type step, 4 without). **Every** numeric branch in `ListingWizard.tsx` moves to
    names (line numbers are `main`'s; 0010a shifts them): the initial step `:129`; `goTo(2)` `:302`; the 422
    mapping `goTo(PREFERENCE_FIELDS ... ? 3 : 2)` `:259`; `onSubmit` `:301-319` (type → details; details
    validates → photos; **photos has no validation → preferences**; preferences validates → preview; only
    `preview` calls `publish()`, today every step other than 2 and 3 publishes); the heading chain `:346-357`
    (a `photos` branch); the stepper done/current `:418-419`; the progressbar `:455-463`; `listings.stepOf`
    `:480`; the `onBlur` `step === 2` `:473`; the render switches `:489/:495/:505/:513`; `onBackToDetails`
    `goTo(2)` `:523`; the back button `:534/:539` (`goTo(order[index - 1])`, shown while index > 0); the
    disabled rule `:550` and the label/chevron `:554`/`:559` (`step !== 'preview'`). `listings.steps.photos`
    = "תמונות".
  - **State.** `photos: WizardPhoto[]` in the wizard, where `WizardPhoto = { kind: 'stored'; id: string;
    url: string } | { kind: 'new'; localId: string; file: File; url: string }` (`url` = `small_url` or
    `URL.createObjectURL(file)`). New mode starts empty; edit mode starts from `base.photos` (the
    `MyListingOut` 0010d now carries). Object URLs are created in the file input's change handler (never in a
    `setState` updater) and revoked when a photo is removed and on unmount.
    Leaving the photos step keeps them (as every other field). `dirty` (the unsaved-edit guard,
    `:161-162`) is also true when the photo list differs from `base.photos` (ids and order).
  - **`PhotosStep`.** Heading `listings.stepTitle.photos` ("תמונות של הדירה" / room:
    `listings.stepTitle.photosRoom` "תמונות של החדר והדירה"), hint `listings.photos.hint` ("עד 10 תמונות. הראשונה
    היא התמונה הראשית."). A grid of tiles (2 columns below `md`, 3 from `md`), each a 16:10 `rounded-md`
    image (`alt` = `listings.photos.tileAlt` "תמונה {{n}}") with, under it, three icon-only buttons (`Button variant="secondary" size="sm"`, 44 px `w-tap`) with
    `aria-label`s: move earlier (`listings.photos.moveEarlier` "הזזת תמונה {{n}} קדימה", disabled on the
    first), move later (`listings.photos.moveLater` "הזזת תמונה {{n}} אחורה", disabled on the last), remove
    (`listings.photos.remove` "הסרת תמונה {{n}}"). The first tile carries the `Tag` "תמונה ראשית"
    (`listings.photos.cover`) in its top start corner (the brand's one corner badge). After a move focus
    goes to the same button on the photo's new tile, or, if that button is now disabled (first or last
    place), to the tile's other move button. After a removal focus goes to the remove button of the tile now
    at that index, else the previous tile's, else the add button. When the 10th photo is added the add button
    goes and focus moves to the count line (`tabIndex={-1}`). An add tile/button `listings.photos.add` ("הוספת תמונות", count line `listings.photos.count`
    "{{count}} מתוך 10") opens a hidden `<input type="file" multiple accept={PHOTO_ACCEPT}>`; hidden once 10
    are chosen. Chosen files run through `checkFile` and the room left: accepted ones are appended in pick
    order; the input's `value` is reset to `''` after each pick. Rejected ones give one `role="alert"` line
    under the grid joining the distinct reasons' sentences in the order type, size, too many
    (`photos.errors.type`, `photos.errors.size`, `listings.photos.tooMany`, a plural family below). Empty state:
    the add button and `listings.photos.empty` ("אפשר לפרסם גם בלי תמונות ולהוסיף אותן אחר כך"). No step
    validation: "הבא" always proceeds.
  - **Preview.** `PreviewStep` passes `coverUrl` (the first photo's `url`) to its `ListingCard`.
  - **Sync after save** (`features/listings/syncPhotos.ts`, new, pure apart from the four API calls):
    `syncPhotos(listingId, stored: PhotoOut[], wanted: WizardPhoto[], onProgress) => Promise<{ failed:
    number; unauthenticated: boolean }>`, run after the POST succeeds (new mode; `stored = []`) or after the
    PATCH succeeds (`stored` = the PATCH response's `photos`) or is skipped because no field changed (`stored =
    base.photos`). In order: (1) delete every stored photo not in `wanted`; (2) upload each `new` photo one at
    a time, in list order; (3) the server order is now: the stored photos kept (and any whose delete failed) in
    stored order, then the uploaded ones; the target order is the wanted ids that exist on the server, in
    wanted order, followed by any photo whose delete failed (in stored order). If the two differ, one `PUT
    .../photos/order` with the target (0010d needs exactly the listing's ids). A failed delete, upload or
    reorder adds one to `failed` and the rest continues. A 401 stops the sync with `unauthenticated: true`.
    Edit mode with no field and no photo change keeps today's navigate-without-request (`:286-289`).
  - **While it syncs** a `syncing: { done: number; total: number } | null` state (not the `publishing` ref,
    which does not re-render, and not `active.isPending`, which goes false when the POST succeeds) drives
    `disabled` and `aria-busy` on the submit button, disables the back button and the edit back link, and shows
    a `role="status"` line under the button: `listings.photos.uploading` ("מעלים תמונה {{done}} מתוך
    {{total}}…", `done` = the 1-based photo being uploaded). Then: on `unauthenticated`,
    `queryClient.setQueryData(ME_KEY, null)` as `onSaveError` does (`:243`; the page redirects to login);
    otherwise navigation goes where it goes today (0010a: by type) with `state: { published | saved: true,
    photosFailed: failed }`.
  - **After it.** `MY_LISTINGS_KEY` and `['listing', id]` are invalidated (the cover and gallery update).
    `useCreateListing`'s optimistic row needs no change (`...created` already carries `photos: []`).
- My listings (`MyListingsPage.tsx:24-33`, `:170-190`): `isPublished` / `isSaved` keep working; a new
  `photosFailed(state)` reader shows, under the published or saved message, a `role="alert"` line
  `listings.mine.photosFailed`, a plural family with no base string (`scripts/i18n-check.mjs:44,93` require
  every `Intl.PluralRules('he')` category, as `he.json:19-27`): `_one` "תמונה אחת לא הועלתה. אפשר להוסיף אותה
  שוב בעריכה.", `_two` "2 תמונות לא הועלו. אפשר להוסיף אותן שוב בעריכה.", `_other` "{{count}} תמונות לא הועלו.
  אפשר להוסיף אותן שוב בעריכה.".
- Cover on the lister's own cards: `MyListingsPage.tsx` passes `listing.photos[0]?.small_url` to `ListingCard`.
- i18n (`web/src/locales/he.json`): the keys named above, plus `listings.photos.tooMany` as a plural family
  (`_one` "אפשר עד 10 תמונות. תמונה אחת לא נוספה.", `_two` / `_other` "אפשר עד 10 תמונות. {{count}} תמונות לא
  נוספו."). Voice: plural or infinitive, no slash forms, never one gender (`specs/0009-brand-amendment.md`). `make i18n-check` green.
- PWA: nothing changes. Photos are `<img>` requests to the API's `/media` (dev/CI) or the R2 address, never
  cached by the worker (`web/pwa.config.ts`: no `runtimeCaching`; `web/scripts/build-check.mjs:228-267` fails
  on any runtime strategy). `make build-check` stays green. No photo URL is added to the precache.

**Out:**
- The gallery, public card covers, `Avatar`, the profile photo (`0010k`).
- Drag-and-drop ordering (the move buttons are the keyboard- and touch-safe path); client-side resizing or
  HEIC conversion before upload (8 MB covers phone photos; iOS hands JPEG to an input that accepts only
  JPEG/PNG/WebP).
- Retrying failed uploads automatically, or keeping chosen files across a reload (the wizard keeps nothing
  across a reload today).
- Photo management anywhere but the wizard (no "manage photos" on the my-listings card).

**New dependencies:** none.

## Data
None (0010d).

## API
None new. Consumed (0010d): `POST /listings/{id}/photos`, `DELETE /listings/{id}/photos/{photo_id}`,
`PUT /listings/{id}/photos/order`, and `photos` on `ListingOut` / `MyListingOut`.

## UI
- **Wizard photos step** (no artboard body; stepper from `CreateListing.dc.html:30-50`): states — empty (add
  button + `listings.photos.empty`), some (tiles, cover tag, count line), full (10: add hidden, count "10
  מתוך 10"), rejected files (alert line), syncing after publish/save (busy button + status line), partial
  failure (my listings alert). RTL: "move earlier" points to the start side (the chevron icons use
  `ltr:rotate-180` as the wizard's); the cover tag sits at `start-2 top-2`.
- **Card cover** (preview, my listings): with cover / without / image error.
- All logical properties; every image box has a fixed aspect, so nothing shifts while an image loads.

## Acceptance criteria
- [ ] AC1 Given a new listing wizard, When the lister reaches the photos step, picks 3 files (one GIF, one
  9 MB JPEG, one valid JPEG), Then one tile is added and one alert names the type and size problems; moving,
  removing and the cover tag follow the list order, with focus kept on the moved photo's button; at 10 photos
  the add button is gone and focus is on the count line. — `web/src/features/listings/__tests__/PhotosStep.test.tsx::ac1_pick_check_move_remove`
- [ ] AC2 Given 2 new photos, When the listing is published (POST 201), Then the two files are uploaded one
  after the other to the new id **after** the POST (each request's `arrayBuffer().byteLength` equals the file's
  size and its `Content-Type` is the file's type), the button stays disabled and busy with "מעלים תמונה 1 מתוך
  2…" while the first uploads, and
  navigation carries `published: true, photosFailed: 0`; the preview card showed the first photo. —
  `ListingWizard.test.tsx::ac2_publish_then_upload`
- [ ] AC3 (partial failure) Given 3 new photos where the second upload answers 503, When published, Then the
  third is still uploaded, no order PUT is sent (the server order already matches), and "my listings" shows
  "תמונה אחת לא הועלתה…" next to the published message; a POST that fails uploads nothing; a 401 on an upload
  clears the cached user instead of navigating. —
  `ListingWizard.test.tsx::ac3_partial_upload_failure`, `MyListingsPage.test.tsx::ac3_photos_failed_message`
- [ ] AC4 (edit) Given a listing with stored photos A, B, C, When the lister removes B, adds D and moves D
  first, with no field changed, Then no PATCH is sent, B is deleted, D uploaded, and one order PUT sends `[D,
  A, C]`; the back link asks before leaving while these changes are unsaved; with no change at all nothing is
  sent. — `ListingWizard.test.tsx::ac4_edit_photo_sync`
- [ ] AC5 Steps: with `?type=room` the stepper shows 4 steps with "תמונות" second ("שלב 2 מתוך 4" on it); with
  no type it shows 5; edit starts at details ("שלב 1 מתוך 4"); "הבא" on the photos step goes to preferences and
  never publishes; the progress bar's `aria-valuenow`/`aria-valuemax` follow; a 422 naming a preference field
  still lands on the preferences step. — `ListingWizard.test.tsx::ac5_step_list`. Amended (after 0010a's own
  amendments): the `stepOf` helper and `aria-valuemax` at `ListingWizard.test.tsx:94,265,549,617`, the
  `aria-valuenow` assertions at `:46,414,642,707`, `EditListingPage.test.tsx:108,110,121,391,631,642,659,693,754,756,776,802,824`,
  `DetailsStep.test.tsx`'s step assertions, `wizard.tsx:90-97` `toPreferences` (one more "הבא" through
  photos), and 0010a's `ac10_type_param_skips_type_step` ("מתוך 3"/"מתוך 4" become 4/5).
- [ ] AC6 Cover on own cards: `MyListingsPage` shows `photos[0].small_url` on a listing with photos and the
  placeholder on one without; the `ListingCard` prop itself is covered by the shared `ListingCard.test.tsx::cover`. —
  `MyListingsPage.test.tsx::ac6_cover`, `ListingCard.test.tsx::cover`
- [ ] AC7 E2E (CI only): sign up, open `/listings/new?type=apartment`, fill details, add
  `web/e2e/fixtures/photo.jpg` (a small committed JPEG) on the photos step, publish; the my-listings card shows
  an `img` whose `src` ends in `-s.webp` and loads (natural width > 0). — `web/e2e/photos.spec.ts::ac7_wizard_photo`
- [ ] AC8 E2E updates: one more "הבא" right after the **details** step's "הבא" in every run that goes past
  details: `web/e2e/listings.spec.ts` after `:62` (publish), `:155` (edit), `:202` (room); `:46/:69/:192/:221`
  and the 0009k test (`:262/:273`, details only) need nothing; 0010a's `web/e2e/market.spec.ts::ac14_two_sides`
  (the room wizard) gets the same click. The publish run asserts no photo request is sent when none is chosen.
  Not in CI but kept compiling and correct: `web/e2e/screens/listings.screens.ts:104-108,139,194,234,254`. —
  `listings.spec.ts`, `market.spec.ts` (amended)
- [ ] NF1 `make build-check` passes (no runtime caching); `make i18n-check` passes; axe on the wizard photos
  step (existing `e2e` axe helpers) reports no new violations. — CI

## Tests to write
Unit (vitest): `PhotosStep.test.tsx` (AC1), `ListingWizard.test.tsx` (AC2–AC5), `syncPhotos.test.ts` (the
delete/upload/reorder plan for: only new, only removed, reorder only, a failed upload, a failed delete then a
reorder, a 401 midway), `MyListingsPage.test.tsx` (AC3, AC6), `ListingCard.test.tsx::cover` (shared),
`photos/__tests__/limits.test.ts` (`checkFile`, shared), `photos/__tests__/errors.test.ts` (`photoErrorText`,
shared). jsdom has no `URL.createObjectURL`: the tests stub it and `revokeObjectURL` (assert revocation on
remove and unmount). Test files are built with `node:buffer`'s `File` if jsdom's is not accepted as a fetch
body.
E2E (CI only, never locally): `photos.spec.ts::ac7_wizard_photo` (AC7), `listings.spec.ts` / `market.spec.ts`
amendments (AC8). CI's e2e job runs `make dev`, which creates `.media` (0010d). If `0010k` merged first,
`photos.spec.ts` exists: add the test to it.

## Risks / open questions
- **Order of merges.** This spec needs 0010a's wizard entry and step logic and 0010d's endpoints. Line numbers
  are `main`'s at the time of writing; the coder re-reads them after rebasing. `0010k` shares four small
  pieces (Scope, "Shared code"); the second to merge drops its own copy. The map specs `0009v`–`0009y` may
  touch `ListingCard` too; the second to merge rebases.
- **A published listing with failed photos** is the chosen behaviour (the listing exists once the POST
  succeeded; rolling it back would lose the lister's typing). The alert and the edit path cover it.
- **Uploads run sequentially** (simplest; the 60/hour limit is far away for 10). A slow phone uploading
  10 × 4 MB waits on the busy button with visible progress. Parallel uploads are a follow-up if listers ask.

Spec-verifier round 1 (Opus/high) ran on the combined `0010e` (wizard + display): 1 blocker-free reject
with 8 majors and 9 minors plus nits; **round 1: 17 findings applied** across `0010e` and `0010k` (finding 6,
the split, decided by the orchestrator 2026-11-13: option b; finding 4, fixtures, moved to `0010d`/`0010j`). No
second round (one verifier round).

## Digest (filled by orchestrator after verification)
See `/digest`.
