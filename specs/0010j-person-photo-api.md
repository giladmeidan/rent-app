---
id: 0010j
title: Any signed-in account sets, replaces or removes one photo of themselves, and that photo's address appears only in responses that already show the person to the caller
status: in-progress
depends_on: [0010d]   # 0010d: users.photo_key (migration 0013), the store, encode, read_capped and the upload router. No migration here
reviewers: [code, qa, security]   # security: personal data (a face), Q16 exposure rule on every person surface, upload of untrusted bytes (0010d's encode); qa: every response that shows a person
estimate: 1 coder run   # coder Opus/high (personal data; Speed rule 6)
---

## Goal
After this ships, any signed-in account (any role) uploads one photo of themselves, replaces it or removes it.
The photo goes through 0010d's pipeline (raw body, 8 MB, JPEG/PNG/WebP re-encoded to two WebP sizes, no
metadata, random key). Its small address (`photo_url`) is added **only** to responses that already show that
person to the caller: the caller's own account, a room lister's people page, an owner's applicant inbox, chat
members, and a lister's flatmates list (MARKET-PLAN §6 Q16: "whoever may see the card or shares a chat with
them").

This serves PRODUCT.md "שוק השותפים" (one photo per person) and MARKET-PLAN §7 "Photos (0010d)". It was split
out of `0010d` by the orchestrator (2026-11-13, verifier finding 7 of 0010d's round 1) so that `0010k` and
`0010f`, which both need the person surfaces, cannot be blocked by an overflow of 0010d. The web half is
`0010k-photos-display-web` (the profile photo and the shared `Avatar`).

## Scope
**In:**
- `api/app/services/photos.py` (0010d's module) gains:
  - `set_user_photo(db, store, user, data) -> str | None` (returns the old key): `encode`, `new_key`, then
    inside one `try`: `put` both names, read the old key as a scalar with `select(User.photo_key).where(User.id
    == user.id).with_for_update(key_share=False, no_key=True)` (a scalar, not the identity-mapped `User`, so
    two concurrent PUTs never read the same stale key), `UPDATE users SET photo_key = :new`, commit; any
    exception inside the `try` deletes both new names (`try/except PhotoStoreUnavailable: log`) and
    re-raises; after the commit, delete the old names (log and swallow a failure). `user.photo_key` is set to
    the new key for the response.
  - `clear_user_photo(db, store, user) -> None`: the same locked scalar read, `SET photo_key = NULL`, commit,
    delete the old names (log and swallow). Idempotent (no photo: nothing to delete, still 204).
  - `person_photo_url(key: str | None) -> str | None`: `small_url(key)` or None.
- `api/app/routers/photos.py` (0010d's router) gains `PUT /me/photo` (`async def`, exactly as 0010d's
  listing upload: one `run_in_threadpool` call runs `count_or_raise` on the **same** two counters
  `rl:photo:user:{id}` 60/h and `rl:photo:user:{id}:day` 300/day, and `db.commit()` before the body is read;
  then `read_capped(request, MAX_PHOTO_BYTES)`; then the service in the threadpool; the same `openapi_extra`
  request body) and `DELETE /me/photo` (plain `def`, not rate limited). Errors map as 0010d's (413
  `photo_too_large`, 415 `unsupported_image`, 429 `rate_limited` + `Retry-After`, 503
  `photo_storage_unavailable`).
- `photo_url: str | None` (the small address) where the person is already shown, each from a `users.photo_key`
  column added next to the `display_name` the statement already selects (**no new statement**):
  - `schemas/auth.py` `UserOut` (`GET /auth/me`, OTP verify, and `PUT /me/photo`'s response): the caller's
    own photo. `UserOut` is built in `routers/auth.py:75` and `:95`; both, and the new route, use a new
    `user_out(user) -> UserOut` helper in `routers/auth.py`.
  - `schemas/people.py` `PersonOut` (`services/people.py:271`, `routers/people.py:82`): a room lister browsing
    people.
  - `schemas/application.py` `ApplicantOut` (`services/applications.py:361`, `routers/applications.py:187`):
    the owner's inbox, and `PATCH /listings/{id}/applications/{id}`, which also returns it.
  - `schemas/chat.py`: `ConversationOut.other_photo_url` and `ThreadOut.other_photo_url` next to `other_name`
    (`services/chat.py:302`, `:341-345`, with the same `case`), and `MemberOut.photo_url`
    (`services/chat.py:392-402` and the owner/seeker members). Only members reach these rows (0008d).
  - `schemas/flatmates.py` `FlatmateOut` (`services/flatmates.py:203`, `routers/flatmates.py:180`): the
    lister's flatmates list.
  Nothing else gains a person photo: not `MyFlatOut.owner_name`, not `InvitePreviewOut`, not
  `MyApplicationOut` (the owner stays unknown to an applicant until chat, PRODUCT.md "Applications"), not any
  listing response.
- Tests: `api/tests/test_person_photo.py` (new, reusing 0010d's `photo_store` fixture and `jpeg()` builder),
  amendments wherever a whole body or key set is compared: `test_chat.py` (`CONVERSATION_KEYS`, `THREAD_KEYS`
  + `other_photo_url`; `APPLICANT_KEYS` `:51`; the `members` dicts at `:470-472`, `:505-507` + `photo_url`),
  `test_inbox.py` (`APPLICANT_KEYS` + `photo_url`), `test_flatmates.py` (the `_members` helper `:173`),
  `test_people.py` and `test_auth.py`. Statement counts that must pass **unchanged**:
  `test_chat.py:265,278,291,433`, `test_inbox.py:305,369,377,797,815,848`, `test_flatmates.py:1134,1154`,
  `test_people.py:464,484`.
- **Web types:** CI's web job runs `make client` then `tsc` over `src` and `e2e` (`web/tsconfig.json:20`), and
  the new fields are required in the generated types. This spec runs `make client` and adds `photo_url: null`
  / `other_photo_url: null` to every typed fixture `tsc` names: `web/src/features/{people,applicants,chat,flatmates}/__tests__/fixtures.ts`,
  `web/src/features/auth/__tests__/harness.tsx` (`UserOut`), `web/e2e/screens/fixtures-{auth,chat,flatmates,seeker,profile}.ts`
  as named. No component changes (`0010k`); `make lint-web test-web` green.

**Out:**
- Web (`0010k`).
- More than one person photo; a large person photo address (only `-s` is exposed; `-l` is stored by 0010d's
  pipeline and unused).
- New surfaces that show a person: `0010f` (flatmates on the room page) and `0010h` (people browse people)
  add `photo_url` under their own visibility rule with `person_photo_url`.
- Deleting the objects when an account is deleted (no route deletes accounts; 0010d's orphan follow-up).

**New dependencies:** none (0010d adds Pillow and boto3).

## Data
None. `users.photo_key` (with `uq_users_photo_key` and `ck_users_photo_key`) is created by 0010d's migration
`0013`.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| PUT | `/me/photo` | `current_user` (any role) | raw image body, ≤ 8 MB | 200 `UserOut` (with the new `photo_url`); the old photo's objects are deleted | 401; 413 `photo_too_large`; 415 `unsupported_image`; 429 `rate_limited` + `Retry-After`; 503 `photo_storage_unavailable` |
| DELETE | `/me/photo` | `current_user` | — | 204 (also with no photo) | 401 |
| GET | `/auth/me`, `/listings/{id}/people`, `/listings/{id}/applicants`, `/me/conversations`, `/conversations/{id}`, `/listings/{id}/flatmates`; PATCH `/listings/{id}/applications/{id}`; POST OTP verify (changed) | as today | as today | `+photo_url` (`UserOut`, `PersonOut`, `ApplicantOut`, `MemberOut`, `FlatmateOut`), `+other_photo_url` (conversation, thread) | as today |

## UI
None (`0010k`); only the typed web fixtures change (Scope).

## Acceptance criteria
- [ ] AC1 `PUT /me/photo` with a JPEG returns `UserOut` with `photo_url` = `{PHOTO_PUBLIC_BASE_URL}/{key}-s.webp`
  (no user id in it); a second PUT replaces it and the first photo's two objects are deleted; `GET /auth/me`
  shows the new one; `DELETE /me/photo` returns 204, `photo_url` becomes null and the objects are gone; a
  second DELETE is 204. A seeker-role and an owner-role account both can; anonymous gets 401. —
  `api/tests/test_person_photo.py::test_ac1_set_replace_clear`
- [ ] AC2 (input and cleanup) An oversized body gets 413, a GIF 415, and neither changes `photo_key` or leaves
  an object; when the DB write fails after the `put`, both new objects are deleted and the old photo stays;
  two concurrent PUTs leave exactly one key in the row and only that key's objects in the store. —
  `test_person_photo.py::test_ac2_failures_and_concurrency`
- [ ] AC3 (rate limit) Listing uploads (0010d) and person uploads count against the same counters: after 60
  attempts in an hour mixing both, the next `PUT /me/photo` gets 429 with `Retry-After` before the body is
  read (a `read_capped` spy is not called); DELETE is not limited. — `test_person_photo.py::test_ac3_shared_rate_limit`
- [ ] AC4 (security: who sees a person photo, Q16) Given seeker `S` with a photo who applied to `O`'s room and
  was shortlisted, and flatmate `F` with a photo: `O`'s applicants list (and the status PATCH response), `O`'s
  people page (`S` opted in, on another room of `O`'s), `O`'s, `S`'s and `F`'s chat list and thread
  (`other_photo_url`, `members[].photo_url`) and `O`'s flatmates list carry the right addresses; `S`'s `GET
  /me/applications`, `GET /me/flats`, the public listing, search, `/me/likes` and the flatmate invite preview
  carry no person address anywhere in the body (a test scans each body for every stored **person** key). —
  `test_person_photo.py::test_ac4_photo_only_where_person_is_shown`
- [ ] AC5 (perf) The statement counts pinned at `test_chat.py:265,278,291,433`,
  `test_inbox.py:305,369,377,797,815,848`, `test_flatmates.py:1134,1154` and `test_people.py:464,484` pass
  unchanged. — those tests

## Tests to write
Integration: `test_person_photo.py` AC1–AC4; the key-set amendments listed in Scope (AC5 is the unchanged
count tests). Unit: none new (0010d's `encode` is reused). E2E: none (`0010k`).

## Risks / open questions
- **Exposure follows existing rules exactly.** A person's photo reaches only callers who already see their
  name in the same row; the scan in AC4 guards against a surface leaking it. A face is more identifying than a
  display name: the security reviewer checks each added column against its statement's existing WHERE.
- **Public address (Q16).** As 0010d: anyone holding the address sees it until deleted (and CDN expiry). The
  hint on the profile (`0010k`) tells people where it is shown.
- **0010g** reshapes the chat statements (`conversations.id`, nullable listing). It chains after this spec's
  dependency 0010d; whichever of 0010g/0010j merges second keeps the `photo_key` column next to `display_name`.
- **Body cap follow-up** (FOLLOWUPS `0005a`, `0007a`): the 64 KB middleware must exempt `PUT /me/photo` too
  (0010d writes that sentence for both upload routes).
- **Beyond §7** (named as §7 asks): `UserOut.photo_url`, `ConversationOut`/`ThreadOut.other_photo_url`,
  `MemberOut.photo_url`.

This spec's text was verified as part of `0010d`'s spec-verifier round 1 (Opus/high), whose findings 9
(scalar locked read), 10 (cleanup of both puts) and 13 (test line numbers, missing amendments) are applied
here; **round 1: 3 findings applied**. Marked verified by the orchestrator's split decision (2026-11-13), no
separate round (one verifier round).

## Digest (filled by orchestrator after verification)
See `/digest`.
