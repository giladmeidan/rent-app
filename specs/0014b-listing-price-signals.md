---
id: 0014b
title: A listing remembers every price it had and, once it is paused or expired, what happened to it (optional and private); an apartment listing can say four more facts (ממ״ד, balcony, condition, air conditioning)
status: in-review
depends_on: []   # no code dependency on 0014a; only the migration chain (0014a's 0019 merges first, see Data)
reviewers: [code, qa, ux]   # qa: wizard, edit, listing page and my-listings end to end; ux: new fields in the wizard and a new dialog. No security: the one new endpoint copies PATCH /listings/{id}'s owner rule, and AC6 proves the private fields never reach a public response
estimate: 1 coder run, large   # coder Opus/high (migration + money data; Speed rule 6); about 40 files, half of them tests and fixtures
---

## Goal
After this ships homie records the three things the rent price estimate (PRODUCT.md "Rent price estimate") can
never recover later:

1. **Every price a listing had**, from the day it is published.
2. **What happened to an apartment** once it is paused or expired: rented through homie, rented elsewhere or not
   rented, and the final rent. The lister is asked once, may skip, and nobody else ever sees the answer.
3. **Four apartment facts that move the rent** and are missing today: ממ״ד, balcony, the apartment's condition
   and air conditioning. All optional.

The estimate engine is a later spec (after Slice 11); nothing in this spec computes or shows a price.

## Scope
**In:**
- API: table `listing_price_changes`; six new columns on `listings`; `ck_listings_room_fields` stops forcing
  `balcony IS NULL` on an apartment (migration `0020`, file `api/alembic/versions/0020_price_signals.py`).
- API: `POST /listings` and `PATCH /listings/{id}` accept the new facts, write a price row, and a resume clears
  the closure answer. New `PUT /listings/{listing_id}/closure`. `GET /me/listings` returns the closure answer.
  The public listing schemas `ListingPublic` and `ListingDetail` (`api/app/schemas/search.py`) return the three
  new facts.
- Web, new-listing wizard and edit page (`DetailsStep.tsx`): four optional facts, on an apartment only.
- Web, listing page (`ListingFacts.tsx`): the facts that were filled, on an apartment only.
- Web, my listings (`MyListingsPage.tsx`, new `ClosureDialog.tsx`): the closure question, on an apartment only.
- `web/src/locales/he.json` keys, `make client`, and every web mock or fixture that builds a listing
  (`ListingOut` / `MyListingOut` gain required keys), including the `make screens` mocks.

**Out:**
- Rooms on screen: the room wizard, room page and room cards do not change, and pausing a room asks nothing
  (PRODUCT.md: apartments only for now). The API accepts the new facts and a closure on any listing; no rule
  ties them to apartments, so rooms can follow without a migration.
- Anything that reads the price history or the closure answer (the engine spec).
- Search filters on the new facts, the match score, the listing card.
- The wizard's preview (`PreviewStep.tsx`): it shows no amenity today and stays unchanged.
- Listing renewal (Slice 11): when it is built it must clear the closure answer the way a resume does. Log a
  follow-up.
- Reminders or notifications asking for the answer; an admin view.

**New dependencies:** none.

## Data
Migration file `api/alembic/versions/0020_price_signals.py` with `revision = "0020"` (this repo's revision ids
are the bare number). It is built with `down_revision = "0018"`. **Migration chain:** 0014a's migration `"0019"`
(`0019_rent_reference.py`) merges first; when this branch merges `origin/main` after that, `down_revision` is
re-pointed to `"0019"` (one line). If `origin/main` already has `0019_rent_reference.py` before this spec's one
push, merge it and re-point before pushing.

Backwards-compatible: every new column is nullable, the new table is read by nothing, and the relaxed CHECK
accepts every row the old one did, so the running app keeps working during a deploy.

New table `listing_price_changes`:

| Column | Type | Rule |
| --- | --- | --- |
| `id` | uuid PK | `gen_random_uuid()` |
| `listing_id` | uuid NOT NULL | FK `listings.id` ON DELETE CASCADE |
| `price_ils` | integer NOT NULL | `ck_listing_price_changes_price_ils`: 500–100000 |
| `created_at` | timestamptz NOT NULL DEFAULT `now()` | when this price started |

Index `ix_listing_price_changes_listing_id` on (`listing_id`, `created_at`). Model
`api/app/models/listing_price_change.py` (`ListingPriceChange`), imported in `api/app/models/__init__.py` and
listed in its `__all__`.

**Backfill** in `upgrade`: one row per existing listing, with its current `price_ils` and `created_at` =
the listing's `updated_at` (the price was certainly that by then; its earlier prices are unknown).

New columns on `listings`:

| Column | Type | Rule |
| --- | --- | --- |
| `safe_room` | boolean NULL | NULL = not said |
| `air_conditioning` | boolean NULL | NULL = not said |
| `condition` | text NULL | `ck_listings_condition`: `new`, `renovated`, `good` or `needs_work` |
| `close_reason` | text NULL | `ck_listings_close_reason`: `rented_here`, `rented_elsewhere` or `not_renting` |
| `final_rent_ils` | integer NULL | `ck_listings_final_rent_ils`: NULL, or 500–100000 with a `rented_*` reason |
| `closed_at` | timestamptz NULL | `ck_listings_closed_at`: set exactly when `close_reason` is set |

`balcony` (spec 0010f, until now room-only) becomes a fact of any listing: `ck_listings_room_fields` is dropped
and re-created without `AND balcony IS NULL`; the other room-only columns keep their rule.

The CHECKs as SQL, identical in the model and the migration (`command.check` at the end of `test_migrations.py`
compares them):
- `ck_listings_condition`: `condition IS NULL OR condition IN ('new', 'renovated', 'good', 'needs_work')`
- `ck_listings_close_reason`: `close_reason IS NULL OR close_reason IN ('rented_here', 'rented_elsewhere',
  'not_renting')`
- `ck_listings_final_rent_ils`: `final_rent_ils IS NULL OR (final_rent_ils BETWEEN 500 AND 100000 AND
  close_reason IS NOT NULL AND close_reason IN ('rented_here', 'rented_elsewhere'))`
- `ck_listings_closed_at`: `(close_reason IS NULL) = (closed_at IS NULL)`
- `ck_listing_price_changes_price_ils`: `price_ils BETWEEN 500 AND 100000`

`downgrade`: sets `balcony = NULL` on apartments (an apartment's balcony answer is lost; said here on purpose),
restores the old `ck_listings_room_fields`, drops the six columns with their CHECKs, drops the table.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/listings` | unchanged | `ListingIn` + optional `safe_room`, `air_conditioning`, `condition`; `balcony` now also on an apartment | `ListingOut` + the three new facts | unchanged; 422 for an unknown `condition` |
| PATCH | `/listings/{listing_id}` | unchanged | `ListingPatch` + the same four; an explicit `null` clears each | `ListingOut` | unchanged; `close_reason`, `final_rent_ils` and `closed_at` are not patchable (422, `extra="forbid"`) |
| PUT | `/listings/{listing_id}/closure` | signed in **and** the listing's owner; another account's listing or an unknown id is 404 `not_found`, as on PATCH | `{"reason": "rented_here" \| "rented_elsewhere" \| "not_renting", "final_rent_ils": int \| null}` (the key may be left out) | 204, no body | 401 signed out; 404 `not_found`; 409 `listing_live` while the listing is live (`status = 'active'` and `expires_at > now()`); 422 for an unknown reason, a rent outside 500–100000, or a rent sent with `not_renting` |
| GET | `/me/listings` | unchanged | — | `MyListingOut` + `close_reason`, `final_rent_ils` (both nullable) | unchanged |
| GET | `/listings` (search, its map box, the market's rooms), `/listings/{id}`, and `LikedRoomOut.listing` on `/me/likes`: the schemas `ListingPublic` / `ListingDetail` | unchanged | — | + `safe_room`, `air_conditioning`, `condition`, after `poster`; `balcony` may now be set on an apartment | unchanged |

Rules:
1. **Price rows.** `create_listing` writes one `listing_price_changes` row with the new listing's price.
   `update_listing` writes one when the PATCH sends a `price_ils` different from the stored one; the same price,
   or a PATCH without `price_ils`, writes none. The row is written in the listing's own transaction.
2. **Closure.** `PUT …/closure` is allowed only while the listing is **not live** (paused, or past `expires_at`).
   It replaces any earlier answer and sets `closed_at = now()`. It does **not** move `updated_at` and is allowed
   on an expired listing (PRODUCT.md "Listing edit" forbids editing an expired listing's fields; this is not one
   of them). `final_rent_ils` left out or `null` stores NULL.
3. **Only a real resume clears it.** In `update_listing`'s cap branch (`patch.status == "active"` and
   `listing.status == "paused"`), `close_reason`, `final_rent_ils` and `closed_at` are set NULL in the same
   statement: a listing that is live again was not rented. A PATCH of a paused listing without `status`, and
   `{"status": "active"}` on an active listing that is past `expires_at` (PATCH does not refuse an expired
   listing), keep the answer.
4. **Private.** `close_reason`, `final_rent_ils`, `closed_at` and the price history appear in no schema except
   `MyListingOut` (the first two), which only the owner's `GET /me/listings` returns.
5. **Facts on any type.** `safe_room`, `air_conditioning`, `condition` and `balcony` are valid on an apartment
   and on a room. `balcony` leaves `ROOM_FIELD_DEFAULTS` (`api/app/schemas/listing.py`); the three new names join
   `NULLABLE_FIELDS`.
6. No rate limit is added: `PATCH /listings/{id}` has none today and this endpoint writes one row of the
   caller's own listing.

## UI
No artboard exists for these (PRODUCT.md "Brand": no new artboards); the design is taken from the kit and the
screens named below. Hebrew copy follows `design/brand/` voice: no single gender, no slash forms.

**1. Wizard details step and edit page** (`DetailsStep.tsx`, group `listings.section.amenities`, anatomy as
`design/screens-v1/` CreateListing). On an **apartment** only, after "pets", four optional controls:
- `balcony`, `safe_room`, `air_conditioning`: the optional yes / no `ChoiceGroup` that `RoomFields.tsx` uses for
  `private_bathroom` (option labels `common.yes`, `common.no`, `listings.room.unset`; "not said" sends `null`).
  The form's existing `balcony` field and its label `listings.room.balcony` are reused; on a room it keeps
  showing in `RoomFields.tsx` only.
- `condition`: a `ChoiceGroup` with the four values and "not said".
States: the step's own (loading areas, validation errors, submit error) are unchanged; the new controls have no
error state (every value is valid) and no empty state (unanswered is the default). The edit page loads stored
values and can clear each back to "not said".

**2. Listing page** (`ListingFacts.tsx`, anatomy as the Listing artboard). `ListingPage.tsx` renders
`ListingFacts` for rooms too, so the new cells show only when `listing_type === 'apartment'`: one `FactCell` per
filled fact, in the order elevator, parking, furnished, pets, balcony, ממ״ד, air conditioning, condition, then
arnona, vaad. Balcony, ממ״ד and air conditioning read `listing.yes` / `listing.no`; condition reads its label.
An unanswered fact shows no cell. Loading, error and empty states of the page are unchanged.

**3. My listings** (`MyListingsPage.tsx`, new `ClosureDialog.tsx` on the kit's `Dialog`):
- After an **apartment** is paused successfully the dialog opens once. Title `listings.closure.title`, a line
  `listings.closure.intro`, a `ChoiceGroup` of the three reasons, and, only for a "rented" reason, an optional
  ILS field `listings.closure.finalRent` (the wizard's money field). Buttons: `listings.closure.save` (disabled
  until a reason is chosen) and `listings.closure.skip`.
- A **paused or expired apartment** card shows a text button: `listings.closure.title` while unanswered; once
  answered, the reason's label with `listings.closure.change`. Both open the dialog, pre-filled.
- States: **idle**; **saving** (save disabled, `aria-busy`); **error** (the dialog stays open and shows
  `common.error`; a rent outside 500–100000 shows the price field's existing range message before any request);
  **success** (the dialog closes, the card shows the answer, and the page's status line announces
  `listings.closure.saved`). Skipping or Esc closes it and leaves the card's button. A room card shows none of
  this.
- RTL: logical properties only; the ILS unit sits at the field's `end` as in the wizard. Focus goes into the
  dialog on open and back to the card's button on close (the kit's `Dialog`).

i18n keys added (`web/src/locales/he.json`):

| Key | Text |
| --- | --- |
| `listings.fields.safeRoom` | ממ״ד |
| `listings.fields.airConditioning` | מיזוג אוויר |
| `listings.fields.condition` | מצב הדירה |
| `listings.condition.new` | חדשה |
| `listings.condition.renovated` | משופצת |
| `listings.condition.good` | שמורה |
| `listings.condition.needsWork` | דורשת שיפוץ |
| `listings.closure.title` | מה קרה עם הדירה? |
| `listings.closure.intro` | התשובה פרטית ולא מוצגת באתר. היא עוזרת לנו להעריך מחירי שכירות. |
| `listings.closure.reason` | בחירת תשובה |
| `listings.closure.reasons.rentedHere` | הושכרה דרך הומי |
| `listings.closure.reasons.rentedElsewhere` | הושכרה במקום אחר |
| `listings.closure.reasons.notRenting` | לא הושכרה |
| `listings.closure.finalRent` | בכמה הושכרה? (שכר דירה לחודש) |
| `listings.closure.save` | שמירה |
| `listings.closure.skip` | לא עכשיו |
| `listings.closure.change` | עדכון התשובה |
| `listings.closure.saved` | התשובה נשמרה, תודה |

Reused: `listings.room.balcony` (the balcony label, in the wizard and on the page); the form options
`common.yes`, `common.no`, `listings.room.unset`; the page values `listing.yes` / `listing.no`;
`listings.errors.range`; `listings.units.ils`; `listings.fields.optional`; `common.error`. None of the 18 new
keys exists today or collides with one.

## Acceptance criteria
- [ ] AC1 Given a new listing, When it is created, Then exactly one `listing_price_changes` row holds its price;
  a create that fails (cap reached, unknown area) writes none —
  `api/tests/test_price_signals.py::test_ac1_create_writes_one_price_row`
- [ ] AC2 Given a listing at 7000, When a PATCH sets 7500, Then a second row holds 7500; a PATCH with the same
  price, or without `price_ils`, adds none — `test_price_signals.py::test_ac2_price_change_adds_a_row`
- [ ] AC3 Given listings at `0018` (an apartment and a room, one edited after creation), When the migration
  runs, Then each has one price row with its price at its `updated_at`; When it is downgraded with an apartment
  holding `balcony = true`, Then the downgrade succeeds, that balcony is NULL and the old CHECK is back —
  `api/tests/test_migrations.py::test_ac3_price_signals_backfill_and_downgrade`
- [ ] AC4 Given an apartment, When it is created or patched with `balcony`, `safe_room`, `air_conditioning`
  and `condition`, Then they are stored and returned; an explicit `null` clears each; `condition: "old"` is
  422 — `api/tests/test_listings.py::test_ac4_apartment_facts`
- [ ] AC5 Given a room, When it is created with `balcony` and the three new facts, Then they are stored, and the
  other room-only fields are still refused on an apartment —
  `test_listings.py::test_ac5_facts_on_a_room_and_room_fields_still_room_only`
- [ ] AC6 Given an apartment with facts, a closure answer and two prices, When search, the map search and the
  listing page return it (after a resume, and for its owner signed in), Then the responses carry the four facts
  and none of `close_reason`, `final_rent_ils`, `closed_at` or any price history —
  `test_price_signals.py::test_ac6_public_responses_carry_facts_never_closure`
- [ ] AC7 Given a paused listing, When its owner PUTs `rented_elsewhere` with 6800, Then 204, `GET /me/listings`
  shows both, and `updated_at` did not move; a second PUT `not_renting` replaces the reason and clears the
  rent — `test_price_signals.py::test_ac7_closure_stored_and_replaced`
- [ ] AC8 Given an active listing past `expires_at`, When its owner PUTs a closure, Then 204 —
  `test_price_signals.py::test_ac8_closure_on_expired_listing`
- [ ] AC9 Given a live listing, Then PUT closure is 409 `listing_live`; another account's listing or an unknown
  id is 404 `not_found`; signed out is 401 — `test_price_signals.py::test_ac9_closure_auth_and_live`
- [ ] AC10 Then PUT closure is 422 for an unknown reason, a rent of 499 or 100001, and a rent with
  `not_renting`; a PATCH carrying `close_reason` is 422 — `test_price_signals.py::test_ac10_closure_validation`
- [ ] AC11 Given a paused listing with a closure answer, When it is resumed, Then `close_reason`,
  `final_rent_ils` and `closed_at` are NULL and the cap rule is unchanged; a PATCH of the paused listing without
  `status` keeps the answer; `{"status": "active"}` on an active, expired listing keeps it —
  `test_price_signals.py::test_ac11_resume_clears_closure`
- [ ] AC12 Given the wizard on an apartment, Then the four facts show, are optional, and are sent as chosen
  (`null` when not said); on a room the three new facts do not show and balcony shows in `RoomFields` only —
  `web/src/features/listings/__tests__/DetailsStep.test.tsx` (`ac12 …`)
- [ ] AC13 Given the edit page of an apartment with facts, Then they load, and clearing one sends `null` —
  `web/src/features/listings/__tests__/EditListingPage.test.tsx` (`ac13 …`)
- [ ] AC14 Given an apartment with two facts filled, Then the listing page shows those two rows and no row for
  the others — `web/src/features/listings/__tests__/ListingPage.test.tsx` (`ac14 …`)
- [ ] AC15 Given a live apartment, When it is paused, Then the dialog opens; saving a reason and a rent calls
  PUT with both and announces `listings.closure.saved`; "לא עכשיו" calls nothing; a failed PUT keeps the dialog
  open with `common.error`; pausing a room opens no dialog —
  `web/src/features/listings/__tests__/ClosureDialog.test.tsx` and `MyListingsPage.test.tsx` (`ac15 …`)
- [ ] AC16 Given a paused apartment without an answer, an expired one with an answer and a paused room, Then the
  first card shows the question, the second its reason with "עדכון התשובה", the third neither —
  `web/src/features/listings/__tests__/MyListingsPage.test.tsx` (`ac16 …`)
- [ ] NF1 `GET /me/listings` sends no extra statement (the closure fields are columns of `listings`) —
  `api/tests/test_listings.py::test_ac6_me_listings_is_own_newest_first`: `len(sent) == 3` stays, and both
  closure keys are present and `null`
- [ ] NF2 The dialog has no axe violation and is keyboard-complete (focus in on open, back on close) —
  `ClosureDialog.test.tsx` and the e2e below

## Tests to write
Unit: the schema rules (facts on both types, closure validation), the web form mapping in `validate.ts`.
Integration: `api/tests/test_price_signals.py` against Postgres; the migration test. Web: the vitest files
named above. E2E (smoke, CI only, never locally):
`web/e2e/listings.spec.ts::ac9_owner_creates_and_pauses_listing` pauses an apartment today; it is extended with
the dialog flow: answer the dialog, see the answer on the card, `expectNoAxeViolations`. The existing tests and
fixtures that must change are listed in Build notes 1, 6, 7 and 8.

## Risks / open questions
- **Size.** One table, six columns, one endpoint and three screens. It is kept as one spec because every part
  edits the same files (`models/listing.py`, `schemas/listing.py`, `services/listings.py`, one migration,
  `he.json`), so two specs could not build in parallel anyway. The verifier agreed: one large run, about 40
  files, half of them tests and fixtures, no split.
- **The spread of fixtures and key-set tests** is the biggest risk: the listing types gain required keys, so a
  few dozen test, mock and screens files break at once. Build notes 1 and 8 name them; `tsc` and the key-set
  tests catch a miss. Two traps beyond that: the stale closure answer in the `usePatchListing` cache after a
  resume (Build note 7), and the `conftest.py` TRUNCATE that would fail every API test (Build note 1).
- **Verification:** round 1 rejected with 13 findings, all applied above and in the Build notes by the
  orchestrator; second round waived (one verifier round).
- **Relaxing `ck_listings_room_fields`** touches the room rule: AC5 proves the other room-only fields are still
  refused on an apartment.
- **Backfill honesty.** Listings from before this spec get one price row dated `updated_at`; before launch these
  are demo listings only.
- **Hebrew copy** in the table above is the orchestrator's draft in the brand voice; the ux reviewer checks it.
- No open product question: where the question shows, that it is optional and private, the three reasons and the
  four facts are Gilad's decisions of 2026-11-14 (PRODUCT.md "Rent price estimate").

## Blast radius
`graphify affected` on `main` (2026-11-14), plus grep where the graph has no node (`ROOM_FIELD_DEFAULTS`, the
key-set tests). Every hit is in Scope with the Build notes below, or named untouched with a reason.
- `ListingIn` (api): `services/listings.py` `create_listing` (`data.model_dump()` inserts the new facts as is),
  `_merged` (reads `ListingIn.model_fields`, so the merged row carries them), `routers/listings.py`
  `create_listing`; `test_listings.py` (`test_ac9_concurrent_creates_respect_cap` untouched: no fact sent),
  `test_flat_profile.py` (`test_ac2_room_fact_rules` changes, Build note 1). The `imports_from` hits in other
  routers/services are module-level imports of `app.schemas`, untouched.
- `ListingPatch` (api): `services/listings.py` `update_listing`, `_merged`; `test_listings.py`. No other caller.
- `ListingOut` (api): `MyListingOut` (inherits), `routers/listings.py` `create_listing`, `update_listing`,
  `my_listings`; `test_inbox.py` (`LISTING_OUT_KEYS` follows the model; its `/me/listings` key set needs the two
  closure keys, Build note 1); `test_geocoding.py::test_ac2_create_and_address_change_mark_pending` (reads
  `ListingOut.model_fields`, untouched).
- `MyListingOut` (api): `routers/listings.py` `my_listings` only (must pass the two closure fields, Build note 2).
- `ListingPublic` / `ListingDetail` (api, `schemas/search.py`): `routers/search.py` `search_listings`,
  `get_listing`; `routers/people.py` `my_likes` (`LikedRoomOut.listing`); all through `from_listing`, which
  reads the new fields by name: no code change there. `test_search.py` `PUBLIC_KEYS` and
  `test_ac2_public_shape_hides_owner_and_lifecycle` change; `test_applications.py` (L550, L563) and
  `test_room_search.py` (L174, L180) import `PUBLIC_KEYS`, untouched.
- `ROOM_FIELD_DEFAULTS` / `NULLABLE_FIELDS` (grep): only `ListingIn._room_fields` and
  `ListingPatch._at_least_one_key_and_null_only_where_nullable`; the 422 text "… are for a room only" loses
  `balcony` (`test_flat_profile.py` L240). `test_inbox.py` L966 names it in a docstring only.
- `create_listing` (service): router `create_listing`; `test_listings.py` `create()` / the cap test, untouched.
- `update_listing` (service): router `update_listing` only.
- `ck_listings_room_fields` (grep): `test_migrations.py::test_ac6_flat_profile_upgrade_downgrade` pins `0016`,
  untouched; `test_ac10_listings_roundtrip` checks the head CHECK names (Build note 1).
- `listings` FK target (grep): `tests/conftest.py` `db_engine` TRUNCATE (Build note 1).
- `DetailsStep` (web): `ListingWizard` (New / Edit pages), `ListingWizard.test.tsx`, `DetailsStep.test.tsx`.
- `ListingFacts` (web): `ListingPage` (both types), `routes.tsx`; `ListingPage.test.tsx`, `ApplySection.test.tsx`
  and `ProfileNudge.test.tsx` render the page with fixtures (keys only, via the shared fixtures);
  `rooms/RoomFacts.tsx` imports `FactCell`, untouched.
- `toListingIn` / `changedFields` / `formFromListing` (web, `validate.ts`): `ListingWizard` (`publish`,
  `onSubmit`), `validate.test.ts`, `ListingWizard.test.tsx`.
- `usePatchListing` / `useCreateListing` (web): `ListingWizard`, `MyListingsPage` `ListingRow`; both write the
  `MyListingOut` cache (Build note 7).
- `MyListingsPage` (web): `routes.tsx`, `MarketMinePage` (rooms panel: no closure UI), `MyListingsPage.test.tsx`
  (pause flows change, Build note 7), `MarketMinePage.test.tsx`, `RequireOwner.test.tsx`, `wizard.tsx` and the
  app-level tests that mount routes (untouched: they never pause an apartment).

## Build notes (from verification; binding, part of the spec)
The verifier checked the spec against the code on `main`. These notes name the files, shapes and existing tests
the sections above rely on.

**1. API files and existing tests that change.**
- `api/tests/conftest.py` `db_engine`: add `listing_price_changes` to the `TRUNCATE` list (and its docstring).
  Without it every API test fails: `TRUNCATE listings` is refused while a table references it.
- `api/tests/test_migrations.py::test_ac10_listings_roundtrip`: `_LISTINGS_CHECKS` gains the four new
  `ck_listings_*` names.
- `api/tests/test_flat_profile.py::test_ac2_room_fact_rules` (L237–240): the `SET_FACTS` loop skips `balcony` (an
  apartment with a balcony is now 201, which would also break `count() == 0`), and the refused message becomes
  `"room_size_sqm, private_bathroom, bills_included, poster"`, asserted on another fact.
- `api/tests/test_search.py`: `PUBLIC_KEYS` gains `safe_room`, `air_conditioning`, `condition`; the exact dict in
  `test_ac2_public_shape_hides_owner_and_lifecycle` gains the three as `None`. `test_applications.py` and
  `test_room_search.py` import `PUBLIC_KEYS` and need no edit.
- `api/tests/test_inbox.py` (L533, `set(item) == LISTING_OUT_KEYS | COUNT_KEYS` on `/me/listings`): the expected
  set gains `close_reason` and `final_rent_ils`.
- Docstrings that say balcony is room-only or NULL on an apartment are updated: the header of
  `api/app/models/listing.py` and its `balcony` column comment, `api/app/schemas/search.py` (L34–36),
  `api/app/schemas/listing.py` (L170).

**2. Schemas.**
- `api/app/schemas/listing.py`: `CloseReason = Literal["rented_here", "rented_elsewhere", "not_renting"]` and
  `Condition = Literal["new", "renovated", "good", "needs_work"]`.
- The three new facts go after `poster` in `ListingOut` and in `ListingPublic` (`api/app/schemas/search.py`;
  `ListingDetail` inherits). `from_listing` reads fields by name, so the search and listing-page code needs no
  change. `ApplicationListingOut` (applications, chat, flatmates) carries no facts and is unchanged.
- `MyListingOut` gains `close_reason: CloseReason | None` and `final_rent_ils: int | None`.
  `routers/listings.py::my_listings` builds it from `dict(ListingOut.model_validate(listing))`, so it must pass
  `close_reason=listing.close_reason, final_rent_ils=listing.final_rent_ils` explicitly.

**3. Closure endpoint.** The request key is `reason`; the column is `close_reason`.
- `ClosureIn` (`extra="forbid"`): `reason: CloseReason`, `final_rent_ils: PriceIls | None = None`, and an
  after-validator: a rent sent with `not_renting` raises `ValueError` (422).
- `set_closure(db, owner, listing_id, data)` in `api/app/services/listings.py`: `SELECT … WHERE id = :id AND
  owner_id = :owner FOR UPDATE`, as `update_listing` does, so it serialises with a concurrent resume. No row:
  `ListingNotFoundError`. Live (`status = 'active' AND expires_at > now()`, evaluated in SQL): a new
  `ListingLiveError`. Otherwise `UPDATE … SET close_reason, final_rent_ils, closed_at = now()` without
  `updated_at`, then commit.
- Router in `api/app/routers/listings.py`: `status_code=204`, returns `Response(status_code=204)` as
  `routers/auth.py` does (L46, L67); `responses` lists 401, 404, 409 `listing_live` and 422.

**4. Price rows.** In `update_listing`, compare `data.price_ils != listing.price_ils` before the `UPDATE` and
insert with `insert(ListingPriceChange)` before `db.commit()`. In `create_listing`, insert after the listing's
own `INSERT`, before the commit.

**5. Listing page.** Each new cell is a `FactCell` with an icon: balcony reuses `ArnonaIcon`, as `RoomFacts`
does; `SafeRoomIcon`, `AirConditioningIcon` and `ConditionIcon` are new in `factIcons.tsx`, drawn with that file's
`Icon` wrapper. Condition labels go through a static map (`needs_work` to `listings.condition.needsWork`, and so
on): `make i18n-check` sees static keys only.

**6. Web form mapping (`validate.ts`, `api.ts`, `constants.ts`).** Today `toListingIn` sends no flat fact for an
apartment, and `changedFields` skips `ROOM_FIELDS` (which holds `balcony`) for an apartment, so an apartment's
balcony edit would never be sent.
- `ListingForm` gains `safe_room: YesNo`, `air_conditioning: YesNo`, `condition: Condition | ''` (`emptyForm`:
  `''`; `formFromListing` through `yesNoOf` / `?? ''`).
- `toListingIn`: an apartment sends `balcony`, `safe_room`, `air_conditioning` and `condition` (`null` for
  `''`); a room sends its five facts as today and none of the three new ones.
- `changedFields`: `balcony` leaves `ROOM_FIELDS`.
- `api.ts`: `ApartmentFactKey = 'safe_room' | 'air_conditioning' | 'condition'`, left out of the `Required<…>`
  in `ListingInBody` and added back with `Pick`, as `RoomFactKey` is; `Condition =
  NonNullable<ListingOut['condition']>`. `constants.ts`: `CONDITIONS` (new, renovated, good, needs_work).
- `DetailsStep.tsx`: the four `ChoiceGroup`s go inside the amenities `Card` after pets, each in `px-4 py-3` like
  `furnished`. A balcony answer carries over when the new wizard's type switches (one form field), on purpose.
- Existing tests that change: `validate.test.ts` (the 0010f facts test, about L597–622: an apartment still never
  sends the four room-only facts, and now sends `balcony`), `ListingWizard.test.tsx` `expectedBody` (the four keys
  as `null`), `RoomFields.test.tsx` (its form literal).

**7. My listings.**
- Cache: `usePatchListing.ts` merges the PATCH's `ListingOut` (no closure keys) into the cached `MyListingOut`, so
  after a resume the stale answer would stay and a re-pause would pre-fill it. When the sent body has
  `status: 'active'`, the merge also sets `close_reason: null, final_rent_ils: null`. `useCreateListing.ts` adds
  both as `null` to the row it builds. New `putClosure(id, body)` in `api.ts` and `useSaveClosure(id)`, which on
  204 writes the sent values into the cached row.
- Status line: the page's one `role="status"` paragraph holds `listings.edit.saved` through `saved: boolean`; it
  becomes which message to show (`'saved' | 'closureSaved' | null`); a pause or resume clears it as today.
- Card: the action row is hidden on an expired card (`next !== null || !past`), so the closure line is its own
  block before the bordered links row. Unanswered: a ghost `sm` `Button` with `listings.closure.title`.
  Answered: a caption with the reason's label, then a ghost `sm` `Button` with `listings.closure.change`. Both
  carry `aria-describedby={titleId}`.
- Opening: the dialog opens from `patch.mutate`'s `onSuccess` when `listing_type === 'apartment' && next ===
  'paused'`; the kit's `Dialog` returns focus to the opener (the pause button, by then "resume").
- Dialog: the reasons `ChoiceGroup` takes its `legend` from `listings.closure.reason`; the intro goes in
  `Dialog`'s `description`. The rent field is `Field` + `TextInput type="text" inputMode="numeric"`, digits only
  on change (as the wizard's price field), `end={t('listings.units.ils')}`, hint `listings.fields.optional`. It
  shows for the two `rented_*` reasons only; switching to `not_renting` hides it and sends `null`. On save, a
  value outside `LIMITS.price_ils` shows `listings.errors.range` with {min, max} and sends nothing.
- Existing tests that pause an apartment now open the dialog: `MyListingsPage.test.tsx` (about L114–146, L274,
  L342) close it with "לא עכשיו" before their next step.

**8. Web fixtures that gain the new keys.** vitest: `listings/__tests__/fixtures.ts` (listing and my-listing),
`search/__tests__/fixtures.ts`, `ListingPage.test.tsx`, `ListingWizard.test.tsx`, `validate.test.ts`,
`RoomFields.test.tsx`. Production: `useCreateListing.ts`. `make screens`: `e2e/screens/fixtures-listings.ts`,
`fixtures-seeker.ts`, `fixtures-flatmates.ts`, `applicants.screens.ts`, `people.screens.ts`,
`listing.screens.ts`. `tsconfig.json` includes `e2e/`, so `make lint` catches a missed literal.

**9. Collisions.**
- 0010m merged on 2026-11-14 (PR #88) and is in `origin/main`. It edited `web/src/locales/he.json` and
  `web/e2e/screens/people.screens.ts` (label lines, not the listing literal). Any `MyListingOut` or
  `ListingPublic` literal it added (for example the `GET /me/listings` mock in `market-people.screens.ts`) needs
  the new keys: run `make client && make lint` after merging `origin/main`.
- 0014a: both specs append to `api/tests/test_migrations.py` and edit `api/app/models/__init__.py`; the second to
  merge resolves when it merges `origin/main`.

## Digest (filled by orchestrator after verification)
    Spec 0014b — A listing remembers its prices and what happened to it; four more apartment facts   (verified, one part)
    What a user can do after this: an owner can say whether the apartment has a ממ״ד, a balcony and air
      conditioning and what condition it is in; after pausing an apartment the owner is asked, optionally and
      privately, what happened to it and the final rent.
    Decisions I need from you: none. The Hebrew texts in the spec's table are a draft in the brand voice; say
      if one should read differently.
    KPIs this slice moves: share of closed apartments with a final rent (the estimate's only source of real
      rents); share of apartments with the four facts filled.
    Acceptance targets: GET /me/listings sends no extra statement; the dialog passes axe and works by
      keyboard; the closure answer and the price history are in no public response.
    Risks: about 40 files change, half of them tests and fixtures, because the listing types gain required
      keys — the spec names each file, and tsc and the key-set tests catch a miss. Migration chain with 0014a
      — 0014a merges first, then one re-point line here.
    Reviewers: code, qa, ux   Estimated: 1 coder run, large (Opus/high), 1 review round
    Links: specs/0014b-listing-price-signals.md · PRODUCT.md "Rent price estimate" · no artboard (design from the kit)

Built 2026-11-14 (merged shape; PR #90 open, not merged — the orchestrator merges with `make merge PR=90`):

    Spec 0014b — A listing remembers its prices and what happened to it; four more apartment facts   IN REVIEW (PR #90, ready-to-merge)
    Shipped: every price a listing had is recorded; after pausing an apartment the owner is asked, optionally
      and privately, what happened to it and the final rent; the wizard, the edit page and the listing page
      carry four optional apartment facts (ממ״ד, מרפסת, מצב הדירה, מיזוג אוויר). Rooms are unchanged on screen.
    Demo: 1. `make dev`, sign in as an owner, new listing → דירה שלמה → details: answer the four facts and
      publish; the listing page shows them  2. הדירות שלי → pause the apartment: the dialog opens; choose
      "הושכרה במקום אחר", type 6800, save; the card shows the answer with "עדכון התשובה"  3. resume it: the
      answer is gone; search and the listing page never showed it.
    Tests: +10 unit, +11 integration, +0 e2e (one e2e extended with the dialog flow; pytest 626 green,
      vitest 695 green)   CI: on the PR
    Findings: 0 blockers; 1 major fixed (the condition options overflowed the card at 390 px); 4 minors
      fixed (a rent could be stored without a reason at DB level; the page cleared a cached answer in a case
      the server keeps it; the privacy line's wording; a duplicated helper); 0 waived; 5 follow-ups logged
      (4 from the review, 1 from Scope: Slice 11 renewal must clear the answer as a resume does).
    Changed in PRODUCT.md: nothing. Differences from the spec's first text, both applied above: the
      `ck_listings_final_rent_ils` SQL and the `listings.closure.intro` copy.
    Next spec I propose: the rent estimate engine, after Slice 11 (PRODUCT.md "Rent price estimate"); no
      decision needed now. `make screens` has 24 states red from before this spec (FOLLOWUPS, 0010f line).
