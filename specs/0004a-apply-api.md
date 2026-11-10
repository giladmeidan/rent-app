---
id: 0004a
title: A logged-in seeker applies to a live apartment with a short message, sees their applications and their status, and can withdraw; the public listing shows the exact applicant count and every view is counted
status: in-progress
depends_on: [0003c]      # migration chain: 0003c adds 0004_listing_location, this spec adds 0005; 0003a, 0002a, 0002d are merged
reviewers: [code, qa, security, perf]   # security: messages between users (free text from a seeker to an owner), PII exposure in two directions (seeker <-> owner), rate limits, a new auth guard; qa: status and re-apply edge cases; perf: a write and a count on every public listing-page hit (verifier 4)
estimate: 1 coder run
---

## Goal
After this ships, a logged-in **seeker** calls `POST /listings/{id}/applications` with `{"message": "..."}` and
gets a `submitted` application for a live apartment; `GET /me/applications` lists their applications with a
listing summary and status (`submitted` / `shortlisted` / `declined` / `withdrawn`); `POST
/me/applications/{id}/withdraw` withdraws one; and anyone's `GET /listings/{id}` carries `applicant_count`, the
exact number of applicants, while each such view adds one to the listing's `view_count`, so applications per
view can be computed later. Serves Dev Plan slice 4 (Apply + inbox), part a of four (split below). PRODUCT.md
rows: "Applicant count — shown to seekers as the exact number; Slice 4 logs applications-per-view to revisit",
"Account roles — every account picks owner or seeker", "Chat — opens only on owner shortlist" (the status this
slice stores; chat itself is Slice 5), "Trust (MVP) — rate limits", "Search — applying needs login in Slice 4",
"Search — the public listing shows no owner name".

**Slice 4 is split in four** (each one coder run; the request was two parts, but the owner side alone is two
more endpoints and a third screen):
- `0004a` (this) — table, apply / my applications / withdraw API, applicant count, view counter.
- `0004b` — web: apply on the listing page, "my applications" page, login return path. `depends_on: [0004a]`.
- `0004c` — owner API: applicants per listing, shortlist / decline, counts on "my listings". `depends_on: [0004a]`.
- `0004d` — web: owner applicants inbox. `depends_on: [0004b, 0004c]`.

## Scope
**In:**
- Migration `api/alembic/versions/0005_applications.py` (revision `"0005"`, down `"0004"`): table
  `applications` and column `listings.view_count` (see Data); working `downgrade`.
- `api/app/models/application.py` (new) `Application`, registered in `api/app/models/__init__.py` (`__all__`
  too); `api/app/models/listing.py` gains `view_count`. Autogenerate must see no diff
  (`test_migrations.py::test_ac4_autogenerate_sees_no_diff_with_postgis_extensions` stays green).
- `api/app/auth.py`: `current_seeker` (copy of `current_owner`): 401 `unauthenticated` without a session,
  403 `seeker_only` when `role != 'seeker'`.
- `api/app/services/rate_limit.py` (new): the `_COUNT_REQUEST` Lua script, `RateLimitedError` and
  `count_or_raise(r, counters: Sequence[tuple[str, int, int]]) -> None` (key, limit, window s) **moved** out of
  `services/auth.py`; `count_or_raise` makes its own `r.eval(...)` call (with the same `type: ignore` comment
  as `auth._eval`). `auth._count_request` calls `count_or_raise`; `services/auth.py` does **not** import
  `RateLimitedError` (it no longer raises it). `routers/auth.py` imports `RateLimitedError` from
  `app.services.rate_limit` and catches that (a one-line change), so ruff `F401` and mypy's
  `no_implicit_reexport` stay clean. `_eval`, `_RESERVE_ATTEMPT`, `_SETTLE_CODE` and `_RESTORE_CODE` stay in
  `services/auth.py` (`test_auth.py` calls `auth_service._eval`). Behaviour of the OTP limits is unchanged (NF2).
- `api/app/schemas/application.py` (new): `ApplicationIn`, `ApplicationListingOut`, `MyApplicationOut`,
  `ApplicationStatus` (see API). `api/app/schemas/search.py` gains `ListingDetail(ListingPublic)` with
  `applicant_count: int`.
- `api/app/services/applications.py` (new):
  - `apply(db, r, seeker, listing_id, message) -> tuple[Application, Listing]`: (1) `count_or_raise` on
    `rl:apply:user:{seeker.id}` (`APPLY_RATE_LIMIT_HOUR = 10`, 3600 s) and `rl:apply:user:day:{seeker.id}`
    (`APPLY_RATE_LIMIT_DAY = 30`, 86 400 s) — every authenticated, body-valid attempt counts, a refused one
    does not; (2) `search.get_public_listing(db, listing_id)` (reused: the one visibility rule; raises
    `ListingNotFoundError` for unknown / paused / expired / room / inactive-area); (3) `listing.owner_id ==
    seeker.id` → `ListingNotFoundError` too (a user whose role changes later must never apply to their own
    listing); (4) **one** upsert: `postgresql.insert(Application).values(listing_id, seeker_id, message)
    .on_conflict_do_update(constraint="uq_applications_listing_seeker", set_={status: 'submitted', message:
    excluded.message, created_at: now(), updated_at: now()}, where=Application.status == 'withdrawn')
    .returning(Application)`; no row back → `AlreadyAppliedError` (an existing submitted / shortlisted /
    declined application; also the loser of two concurrent applies). Commits; rolls back on any error.
  - `list_my_applications(db, seeker) -> Sequence[tuple[Application, Listing]]`: one statement,
    `select(Application, Listing).join(Listing, Listing.id == Application.listing_id).where(seeker_id ==
    seeker.id).order_by(Application.created_at.desc(), Application.id)`; every status, every listing state.
  - `withdraw(db, seeker, application_id) -> tuple[Application, Listing]`: `UPDATE applications SET
    status='withdrawn', updated_at=now() WHERE id=:id AND seeker_id=:me AND status IN ('submitted',
    'shortlisted') RETURNING`; no row → one `SELECT status … WHERE id=:id AND seeker_id=:me`: none →
    `ApplicationNotFoundError`, else `NotWithdrawableError`. Then the listing by id. Commits.
  - `record_view(db, listing_id) -> int`: `UPDATE listings SET view_count = view_count + 1 WHERE id = :id`, then
    `SELECT count(*) FROM applications WHERE listing_id = :id AND status <> 'withdrawn'`, commit, return the
    count. Called only after `get_public_listing` succeeded.
- `api/app/routers/applications.py` (new, tag `applications`, thin, included in `main.py`): the three
  endpoints below; maps `ListingNotFoundError` / `ApplicationNotFoundError` → 404 `not_found`,
  `AlreadyAppliedError` → 409 `already_applied`, `NotWithdrawableError` → 409 `not_withdrawable`,
  `RateLimitedError` → 429 `rate_limited` with `Retry-After` (as `routers/auth.py`).
- `api/app/routers/search.py` `get_listing`: `response_model=ListingDetail`; after `get_public_listing`,
  `count = applications_service.record_view(db, listing.id)`; returns
  `ListingDetail(**ListingPublic.model_validate(listing).model_dump(), applicant_count=count)` (the loaded
  `lat` / `lng` survive: `expire_on_commit=False` in `db.py`, so `record_view`'s commit does not expire
  `listing`). `GET /listings` (search) is unchanged: no count, no view.
- `MyApplicationOut` is built in `routers/applications.py` from each `(Application, Listing)` tuple the service
  returns: `MyApplicationOut(id=…, status=…, message=…, created_at=…, updated_at=…,
  listing=ApplicationListingOut.model_validate(listing))` (`Application` has no `listing` relationship), the same
  for all three endpoints.
- `api/tests/conftest.py`: `db_engine` truncates `applications` too (`TRUNCATE TABLE applications, listings,
  sessions, users, areas`); new helpers `make_seeker(engine, email, display_name="\u05de\u05d9\u05db\u05dc") ->
  uuid.UUID` (as `make_owner`, `role='seeker'`) and `make_application(engine, listing_id, seeker_id,
  **overrides) -> uuid.UUID` (direct `INSERT … RETURNING id`; defaults `message='Hello'`,
  `status='submitted'`; overrides any column incl. `created_at`).
- Tests: `api/tests/test_applications.py` (new), `api/tests/test_migrations.py` (AC10), `api/tests/test_search.py`
  (AC8's key set for `GET /listings/{id}`: the by-id key set becomes `PUBLIC_KEYS | {"applicant_count"}`; the
  search-item key set stays `PUBLIC_KEYS`).
- `README.md`: under "Posting a listing locally", one curl for applying as a seeker.

**Out:**
- The owner's side (applicants per listing, shortlist, decline, counts on "my listings"): `0004c`.
- All web: `0004b`, `0004d`.
- Chat and anything that happens on shortlist: Slice 5. Notifications (email or other) of any kind: Q1.
- A "listing no longer available" flag on the seeker's applications (needs the visibility predicate in the
  list query; the web's link to the listing shows `listing.notFound` instead). FOLLOWUPS entry.
- Pagination of `GET /me/applications` (bounded by the 30-per-day rate limit; revisit with Slice 10).
- Unique viewers, bot filtering, or excluding the owner's own views from `view_count` (approximate by design).
- Per-IP limits (need real client IPs behind the Slice 12 proxy, FOLLOWUPS `0001a`).
- Applying to rooms (hidden until Slice 7, so 404 like every non-public listing).

**New dependencies:** none.

## Data
Migration `0005_applications` (revision `"0005"`, `down_revision = "0004"`):

`applications` (new):
| column | type | notes |
| --- | --- | --- |
| `id` | `uuid` PK, `server_default gen_random_uuid()` | |
| `listing_id` | `uuid` NOT NULL, FK `listings.id` `ON DELETE CASCADE` | |
| `seeker_id` | `uuid` NOT NULL, FK `users.id` `ON DELETE CASCADE` | a deleted account takes its messages with it |
| `message` | `text` NOT NULL | `ck_applications_message_length`: `char_length(message) BETWEEN 1 AND 500` (Q4) |
| `status` | `text` NOT NULL, `server_default 'submitted'` | `ck_applications_status`: `status IN ('submitted', 'shortlisted', 'declined', 'withdrawn')` |
| `created_at` | `timestamptz` NOT NULL, `server_default now()` | reset to `now()` on a re-apply after withdrawal, so the owner sees it as new |
| `updated_at` | `timestamptz` NOT NULL, `server_default now()` | set to `now()` by every status change |

Constraints and indexes: `uq_applications_listing_seeker UNIQUE (listing_id, seeker_id)` (one application per
seeker per listing, ever; its index also serves "applications of a listing"), `ix_applications_seeker_id`
(`seeker_id`). The model declares every CHECK, the unique constraint and the index exactly as the migration.

`listings` (changed): `view_count integer NOT NULL server_default 0`. Not in any API schema except
`0004c`'s owner-only `MyListingOut`.

`downgrade`: drop `ix_applications_seeker_id`, drop table `applications`, drop column `listings.view_count`.
Backwards compatible: a new table and a defaulted column; the running app ignores both. Applications-per-view
for a listing is then `SELECT count(*) FILTER (WHERE status <> 'withdrawn') / NULLIF(view_count, 0)` — no further
logging is needed (PRODUCT.md "Slice 4 logs applications-per-view").

## API
`ApplicationStatus = Literal['submitted', 'shortlisted', 'declined', 'withdrawn']`.
`ApplicationIn` (`str_strip_whitespace=True`, `extra='ignore'` as other bodies): `message`: `Annotated[str,
BeforeValidator(_lf_newlines), Field(min_length=1, max_length=500), AfterValidator(visible_characters_only with
allow_newlines=True, field="message", require_alnum=True)]` (`_lf_newlines` imported from `schemas/listing.py`).
So: stripped, `\r\n` → `\n`, 1–500 characters, no control / format / bidi / invisible characters, at most 4
combining marks in a row, at least one letter or digit.
`ApplicationListingOut` (from attributes): `id`, `listing_type`, `city`, `street`, `rooms` (JSON number, the
`PlainSerializer(float)` of `ListingPublic`), `price_ils`. **No** `owner_id`, owner name, `status`,
`expires_at`, `view_count`.
`MyApplicationOut`: `id`, `status`, `message`, `created_at`, `updated_at`, `listing: ApplicationListingOut`.
**No** `seeker_id` (the caller is the seeker) and nothing about the owner (Q3).
`ListingDetail(ListingPublic)`: every `ListingPublic` field (incl. `0003c`'s `lat` / `lng`) plus
`applicant_count: int` = applications of the listing with `status <> 'withdrawn'` (declined ones count: they
applied; the inbox artboard's total 12 = 5 new + 3 shortlisted + 4 declined).

| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | /listings/{listing_id}/applications | seeker session (`current_seeker`) | path `uuid`; body `ApplicationIn` | 201 `MyApplicationOut` (`status: "submitted"`) | 401 `unauthenticated` · 403 `seeker_only` (every owner, incl. on their own listing) · 404 `not_found`: unknown id, paused / expired / room / inactive-area listing, or the caller's own listing (identical bodies) · 409 `already_applied` (an existing non-withdrawn application) · 422 list `detail` (body, or non-uuid path) · 429 `rate_limited` + `Retry-After` · 503 |
| GET | /me/applications | seeker session (`current_seeker`) | – | 200 `list[MyApplicationOut]`, the caller's own only, every status, newest `created_at` first then `id`; `[]` when none | 401 · 403 `seeker_only` · 503 |
| POST | /me/applications/{application_id}/withdraw | seeker session **and** `applications.seeker_id == user.id` (in the `WHERE`) | path `uuid`, no body | 200 `MyApplicationOut` (`status: "withdrawn"`) from `submitted` or `shortlisted`; the listing's state does not matter | 401 · 403 `seeker_only` · 404 `not_found` (unknown id or another seeker's) · 409 `not_withdrawable` (already `withdrawn`, or `declined`: withdrawing a declined application would reopen it) · 422 non-uuid · 503 |
| GET | /listings/{listing_id} (changed, `0003a`) | public (unchanged: no session dependency, a cookie is ignored) | path `uuid` | 200 `ListingDetail`; adds 1 to `listings.view_count` | unchanged: 404 `not_found` (no view counted) · 422 · 503 |

Re-apply (Q2): applying again after **withdrawing** reopens the same row (same `id`, `status: submitted`, the new
message, `created_at` = now) and returns 201; after `declined`, `submitted` or `shortlisted` it is 409
`already_applied`. The 429 body is `{"detail": "rate_limited"}`; `Retry-After` is the larger remaining window
in seconds (the `_COUNT_REQUEST` rule).

## UI
None in this part. The apply form, "my applications" and the applicant count are rendered by `0004b`; the
owner's inbox by `0004d`.

## Acceptance criteria
Fixtures: `gush_dan`, `make_owner`, `make_listing`, `make_seeker`, `make_application`, `redis_clean`, `outbox`,
`signup` (cookies). "Seeker" = `signup(client, outbox, "s@example.com", "seeker")` unless stated; its id comes
from `GET /me`. Non-ASCII test inputs are written as `\uXXXX` escapes in the tests (and here).
- [ ] AC1 Given a live apartment A, When the seeker posts `{"message": "  Hi, we are a quiet couple  "}` to `/listings/{A}/applications`, Then 201, body keys exactly `{id, status, message, created_at, updated_at, listing}`, `status` `"submitted"`, `message` `"Hi, we are a quiet couple"`, `listing` keys exactly `{id, listing_type, city, street, rooms, price_ils}` with A's values and `rooms` the JSON number `3.5`; one `applications` row with that `seeker_id`; no key anywhere in the body names the owner (`owner_id`, `display_name`, `email`) — `api/tests/test_applications.py::test_ac1_seeker_applies_to_live_listing`
- [ ] AC2 Given A, When applying with no cookie, Then 401 `unauthenticated`; with an owner's cookie, Then 403 `seeker_only`, and with the cookie of A's own owner (A created by that owner through `POST /listings`), Then 403 `seeker_only`; Given a listing B inserted with `make_listing(owner_id=<the seeker's id>)` (a role switch later), When the seeker applies to B, Then 404 `{"detail":"not_found"}`; no `applications` row is written in any case — `test_applications.py::test_ac2_only_seekers_apply_never_to_own_listing`
- [ ] AC3 Given a paused listing, one with `expires_at` 1 hour ago, a live room, a live apartment in an inactive area (as `0003a` AC1) and a random uuid, When the seeker applies to each, Then 404 with identical bodies `{"detail":"not_found"}` and no row; When `POST /listings/not-a-uuid/applications`, Then 422 — `test_applications.py::test_ac3_non_public_listing_is_404`
- [ ] AC4 Given the seeker applied to A, When they apply again, Then 409 `already_applied` and the stored message is unchanged; Given the row is set to `shortlisted`, then `declined` (SQL), Then each re-apply is 409; Given the seeker withdrew (`POST /me/applications/{id}/withdraw`), When they apply with `"Second try"`, Then 201 with the **same** `id`, `status` `"submitted"`, `message` `"Second try"` and `created_at` later than the first; Given two threads apply for one fresh seeker to one fresh listing at once (as `test_listings.py::test_ac9_concurrent_creates_respect_cap`), Then exactly one 201 and one 409 and one row — `test_applications.py::test_ac4_one_application_per_seeker_and_listing`
- [ ] AC5 Given A, When the message is `"   "`, `""`, missing, 501 `x`, `"..."` (no letter or digit), `"hi\u202ethere"` (bidi override), `"\u200b\u200b"`, `"a\u3164b"` (Hangul filler), or `"\u05d0" + "\u05b8" * 5` (5 combining marks), Then 422 with a list `detail` whose `loc` is `["body", "message"]` (or `["body"]` for a non-object body) and no `input` key; When the message is 500 `x`, Then 201; When it is `"line one\r\nline two"`, Then the stored and returned message is `"line one\nline two"` — `test_applications.py::test_ac5_message_text_rules`
- [ ] AC6 Given the seeker applied through the API to A (then withdrew), to B (submitted; B then paused by SQL) and to C (row then set `declined` by SQL), their `created_at` then set by SQL to now − 3 s (A), now − 2 s (B), now − 1 s (C), and another seeker applied to A, When `GET /me/applications`, Then 200 with exactly the seeker's three in the order C, B, A with statuses `declined`, `submitted`, `withdrawn`, each item's key set as AC1 (no owner, no `seeker_id`); and after one warm-up `GET /me/applications`, `statements.clear()`, then the measured request executes exactly 2 `before_cursor_execute` statements (session lookup + one containing `FROM applications`; the `statements` fixture copied from `test_listings.py`); a fresh seeker gets `[]`; no cookie → 401; an owner → 403 `seeker_only` — `test_applications.py::test_ac6_my_applications_own_only_newest_first`
- [ ] AC7 Given the seeker's submitted application X, When `POST /me/applications/{X}/withdraw`, Then 200 `status` `"withdrawn"` and `updated_at` moved; again → 409 `not_withdrawable`; Given a `shortlisted` one on a listing since paused, Then 200; Given a `declined` one, Then 409 `not_withdrawable` and it stays `declined`; Given another seeker's application or a random uuid, Then 404 `not_found` with identical bodies and nothing changes; no cookie → 401; an owner → 403; `not-a-uuid` → 422 — `test_applications.py::test_ac7_withdraw_own_application`
- [ ] AC8 Given A with applications in each status (submitted, shortlisted, declined, withdrawn: 4 seekers via `make_seeker` + `make_application`), When `GET /listings/{A}` with no cookie, Then 200, `applicant_count` `3`, key set exactly `PUBLIC_KEYS | {"applicant_count"}` (no `view_count`), and `listings.view_count` of A went 0 → 1; a second GET → 2; When `GET /listings/{paused id}` and a random uuid, Then 404 and no `view_count` changes; When `GET /listings`, Then items have exactly `PUBLIC_KEYS` (no count) and no `view_count` changes; after one warm-up `GET /listings/{A}`, `statements.clear()`, then one measured `GET /listings/{A}` executes exactly 3 `before_cursor_execute` statements (the public select, the `UPDATE listings`, the count; `COMMIT` is not one) — `test_applications.py::test_ac8_applicant_count_and_view_counter`; and `test_search.py::test_ac2_public_shape_hides_owner_and_lifecycle` passes with the by-id key set widened by `applicant_count` only
- [ ] AC9 Given 11 live apartments and a seeker, When the seeker applies to 10 of them, Then 201 each; the 11th → 429 `{"detail":"rate_limited"}` with an integer `Retry-After` between 1 and 3600, and no row; another seeker can still apply (201); Given `rl:apply:user:day:{id}` set to 30 (Redis, with a TTL) and the hourly key absent, When that seeker applies, Then 429; a 404 / 409 attempt counts, a 401 / 403 / 422 one does not (the hourly counter value after each, read from Redis) — `test_applications.py::test_ac9_apply_rate_limits`
- [ ] AC10 Given a fresh `_mig` database upgraded to `0004` with one area, one owner, one seeker and one listing inserted by SQL, When upgraded to `0005`, Then that listing has `view_count = 0`; `applications` has `ck_applications_status`, `ck_applications_message_length`, `uq_applications_listing_seeker`, `ix_applications_seeker_id` and both FKs `ON DELETE CASCADE` (from `pg_constraint` / `pg_indexes`); a second insert of the same (listing, seeker) fails with the unique violation, `status='open'` and an empty message fail their CHECKs; When downgraded to `0004`, Then `applications` and `listings.view_count` are gone and the listing row is still there; When upgraded to head again, Then it succeeds — `api/tests/test_migrations.py::test_ac10_applications_migration_roundtrip`
- [ ] NF1 `make lint` clean (ruff, mypy --strict); `make client` regenerates `web/src/api/schema.d.ts` with the three new operations and `ListingDetail` (the CI `web` job runs it; `0004b` uses the types) — CI `api` and `web` jobs
- [ ] NF2 The OTP limits are untouched by the move to `services/rate_limit.py`: `api/tests/test_auth.py` passes with no edits, and `rate_limit.py` is the only file containing the Lua counting script — CI `api` job, code reviewer
- [ ] NF3 Privacy: no response of this spec contains another user's email, `owner_id`, `seeker_id` or display name; `ApplicationListingOut` and `MyApplicationOut` list their fields explicitly (never a schema that dumps every ORM column); the message is stored and returned as plain text (no HTML processing anywhere in the API) — AC1 / AC6 key sets + security reviewer

## Tests to write
Integration (Postgres via `TEST_DATABASE_URL`, Redis via `REDIS_URL`; `redis_clean` deletes `rl:*`, which
covers the new keys): AC1–AC9 in `test_applications.py`, AC10 in `test_migrations.py`, the AC8 key-set edit in
`test_search.py`. Rows via `make_owner` / `make_seeker` / `make_listing` / `make_application`; cookies via
`signup`. Unit: none beyond the above (text rules are proven through the endpoint, as `0002d`). E2E: none (API
only; `0004b` covers the browser flow).

## Risks / open questions
**Decisions for Gilad (the build follows the recommendation until he answers; the orchestrator writes the
answers into PRODUCT.md):**
- **Q1 — Notifications on a new application or a status change?**
  (a) None in Slice 4: owners see counts on "my listings" (`0004c`/`0004d`), seekers see the status on "my
  applications" (`0004b`) — **recommended**: no new cost, no email-quota risk; then (c) as its own small spec
  before launch.
  (b) Email the owner on every new application (arq worker + the existing email sender): immediate, but a
  popular listing sends dozens of emails a day and eats the free SMTP quota.
  (c) One daily digest email per owner with new applications (worker cron).
- **Q2 — Can a seeker apply again to the same listing?**
  (a) After **withdrawing**, yes (the same application reopens as new); after a **decline**, never —
  **recommended**: undoes a mis-click, and a decline stays a decision.
  (b) Never, after either (one row, one chance).
  (c) After both (a decline then means little).
- **Q3 — Does an applicant learn who the owner is?**
  (a) Not in Slice 4: the seeker sees the listing only; identity comes with chat on shortlist (Slice 5) —
  **recommended**, consistent with PRODUCT.md "the public listing shows no owner name".
  (b) Show the owner's display name on the seeker's application once it is shortlisted.
  (c) Show it on the public listing to everyone (reverses the 0003a decision).
- **Q4 — Message length.**
  (a) Required, 1–500 characters — **recommended**: the artboard's example is ~150; 500 fits a real
  introduction and keeps the inbox scannable.
  (b) Required, 20–1000 (forces some effort, longer cards).
  (c) Optional, up to 500.
  The bound is a CHECK; changing it later is a one-line migration.
- **Q5 — What does a seeker see when the owner declines?**
  (a) The true status, worded softly ("לא נבחרה" + "בעלי הדירה בחרו להתקדם עם מועמדים אחרים") —
  **recommended**: honest, lets them move on; the API returns `declined`.
  (b) Masked: stays "נשלחה" forever (the seeker endpoints would map `declined` → `submitted`).
  (c) The application disappears from the seeker's list.

**Assumptions (orchestrator, not Gilad calls):** the applicant count includes declined applicants and excludes
withdrawn ones (the inbox artboard's 12 = 5 + 3 + 4), and is visible to every visitor (the listing page is
public); applications-per-view is a `view_count` column, not log lines (logs are short-lived on free hosting and
the owner inbox artboard shows "214 צפיות", which `0004c` serves from the same column); rate limits 10 per hour
and 30 per 24 h per seeker, counted per attempt; the owner sees an applicant's display name only, never the
email (`0004c`).

**Technical risks the verifier should challenge:**
- **A write on a public GET.** `GET /listings/{id}` now updates `listings`. It waits briefly on a concurrent
  owner `PATCH` (row lock, milliseconds). Views are approximate: bots, the owner and TanStack refetches count
  (`0004b` turns off refetch-on-focus for that query). Accepted for "to revisit" data.
- **Perf reviewer brief:** confirm AC8's 3 statements; that the applicant `count(*)` uses
  `uq_applications_listing_seeker`'s index (leading `listing_id`, `EXPLAIN`); and that the view `UPDATE` waits on
  at most one row lock (`update_listing`'s `SELECT … FOR UPDATE`, `0003c`'s per-row geocode write), never a scan.
  The endpoint is unthrottled (any client can loop it): note in the digest whether that is acceptable at
  launch traffic.
- **`get_public_listing` then upsert** is not one statement: a listing paused between them still gets the
  application. Harmless (the owner can decline; the seeker can withdraw).
- **Unique pair forever** (`uq_applications_listing_seeker`): re-apply is an `ON CONFLICT … WHERE status =
  'withdrawn'` update, which also makes two concurrent applies safe (AC4). If Gilad picks Q2 (c), the `WHERE`
  widens; (b) drops the `DO UPDATE`.
- **Rate limit move** touches auth code; NF2 pins it with the unchanged `test_auth.py`.
- **Merge order:** this branch starts from `0003c`'s branch (migration `0004`, `ListingPublic.lat/lng`,
  `test_search.py` `PUBLIC_KEYS`) per Speed rule 3 and rebases after it merges; files shared with `0003c`:
  `models/listing.py`, `routers/search.py`, `test_search.py`, `test_migrations.py`, `conftest.py`.

## Verifier findings — one round, 5 findings, all applied
1. Rate-limit move: `routers/auth.py` imports `RateLimitedError` from `services/rate_limit.py`; `services/auth.py` no longer imports it (no F401, no implicit re-export) (Scope).
2. `_eval` and the OTP scripts stay in `services/auth.py`; `count_or_raise` makes its own `r.eval` call, so `test_auth.py` needs no edit (Scope, NF2).
3. AC6 and AC8 count `before_cursor_execute` statements after one warm-up request and `statements.clear()`; `COMMIT` is not one (AC6, AC8).
4. `perf` added to `reviewers:`, with a brief in Risks (3 statements, the count's index, at most one row lock, unthrottled endpoint).
5. `ListingDetail` built as `ListingDetail(**ListingPublic.model_validate(listing).model_dump(), applicant_count=count)`; `MyApplicationOut` built in the router from the `(Application, Listing)` tuple with `ApplicationListingOut.model_validate(listing)` (Scope).

## Digest (filled by orchestrator after verification)

    Spec 0004a - Apply API: apply, my applications, withdraw, applicant count   (verified, part 1 of 4 of Slice 4, branches from 0003c)
    What a user can do after this: a logged-in seeker applies to a live apartment with a short message (one per listing),
             lists their applications with status, and withdraws one; anyone's listing page carries the exact applicant
             count, and every view is counted so applications per view can be computed.
    Decisions I need from you (built on the recommendation meanwhile):
      Q1. Notifications: (a) none in Slice 4, counts and statuses in the app [rec; then (c) as its own spec before launch]
          (b) email the owner on every application (c) one daily digest email per owner.
      Q2. Re-apply: (a) after withdrawing yes, after a decline never [rec] (b) never (c) after both.
      Q3. Owner identity to applicants: (a) not in Slice 4, comes with chat on shortlist [rec] (b) owner's name once
          shortlisted (c) on the public listing (reverses the 0003a decision).
      Q4. Message length: (a) required, 1-500 characters [rec] (b) required, 20-1000 (c) optional, up to 500.
      Q5. Seeker's view of a decline: (a) true status, soft wording "not selected" [rec] (b) masked as "sent" forever
          (c) the application disappears from their list.
    KPIs this slice moves: applications per listing, applications per view (first two-sided numbers).
    Acceptance targets: NF1 ruff + mypy --strict clean, client regenerated · NF2 OTP limits unchanged after the
             rate-limit move · NF3 no other user's email / id / name in any response.
    Risks: a write (view counter) on every public listing-page hit — mitigation: one atomic UPDATE, 3 statements pinned
             by AC8, perf reviewer checks the index and lock waits.
    Reviewers: code, qa, security, perf   Estimated: 1 coder run, 1 review round
    Links: specs/0004a-apply-api.md · PRODUCT.md "Applicant count", "Chat", "Trust (MVP)", "Search" · design/screens-v1/Listing.dc.html, Inbox.dc.html
