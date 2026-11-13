# שוק השותפים — planning findings (not a spec)

Written 2026-11-13 by the orchestrator with Gilad. This file is the resource the market specs are written from.
Nothing here is built. Code facts were collected by five read-only explorers on `main` at `498030b`; line numbers
are theirs and must be spot-checked when a spec is written. **(rec)** marks an engineering recommendation for
the spec author. Every product question is answered in section 6 (Gilad, 2026-11-13).

## 1. Decisions (Gilad, 2026-11-13)

1. Slice 10 (trust) and later slices are pushed back; the market comes first.
2. The app gets two top-level tabs: **דירות** (whole apartments) and **שוק השותפים** (rooms and people).
   Rooms leave the main search. Existing room logic stays: questionnaire, gender rule, people browse + likes,
   flatmates invite, group chat.
3. Inside the market there are **no owner/seeker roles**: any account posts a room or is a person looking.
4. **People browse people**: people looking see each other, not only room listers. Base for a later
   person-to-person match rating.
5. A mutual like between two people **opens a direct chat** (no room, no application).
6. **Entry ticket**: you browse people only if your own card is visible.
7. **Gender rule both ways**: a person is hidden from anyone whose gender contradicts their flatmates preference.
8. **Photos** are built with the market: rooms, one per person, and apartments at the same time.
9. **Cloudflare R2** is approved for photo storage (free tier: 10 GB, 1M writes, 10M reads a month, free egress;
   checked on Cloudflare's pricing page 2026-11-13). Not confirmed: whether enabling R2 needs a payment card.
10. The **report button** is not in the market slice; it comes in the later trust slices.
11. Later, in order: people match rating, sublet, bigger questionnaire, team-up groups, report.
12. (Q4) An edit **can no longer switch** a listing between apartment and room. Replaces PRODUCT.md "Listing edit".
13. (Q8) Flatmate ages and answers on a room stay visible **only to seekers**, not to every signed-in user.
    Orchestrator's reading, since the market has no roles: "seeker" = a signed-in person who is looking (a seeker
    account, or a market user who filled the "what I am looking for" part of the profile). Confirm when speccing.
14. (Q12) **One visibility switch**, re-worded "show my card in שוק השותפים"; it covers flats and other people.
15. (Q16) Photos are served from **random, unguessable public addresses**; Gilad marked this as important. Object
    keys never contain a user or listing id, and a person's photo address appears only in responses that already
    pass the card or chat-member rule.
16. (Q19) The profile **splits in two**: a personal part (gender, age, about me, answers, photo) anyone can fill
    alone, and a "what I am looking for" part needed only to apply or to appear as a person looking.
17. (Q20) A flatmate is shown on the room's page **only by their own choice** at join, default off; otherwise they
    count in the number only.

Engineering stance (rec, not yet challenged): the `listings` table stays shared; apply, inbox, chat and matching
stay one engine. Only the product surface, the routes and the search split.

## 2. Build order

| Step | What | Schema change | Depends on |
| --- | --- | --- | --- |
| 1 | The move: two tabs, market home + rooms search + post flow, main search apartments only | none | — |
| 2 | Role-free market | none (rec) | 1 |
| 3 | Photos: storage, upload, listing gallery, person photo | new table(s) | 1 (parallel with 2) |
| 4 | Flat profile + room facts + who is posting | new listing columns | 2 |
| 5 | People browse people: direct chat, person likes, browse | chat tables + new pair table | 2 |

Expected spec count (Gilad's "fewer specs per slice" rule): about 7. Steps 1, 2 and 4 are one full-stack spec
each; step 3 splits into storage + API and web; step 5 splits into "chat without an application" and "people
browse people".

## 3. Findings per step

### Step 1 — The move

What exists
- One search endpoint for everything: `GET /listings` (`api/app/routers/search.py:65-79`). The map is the same
  endpoint with bbox params, not a second router. `listing_type` is optional; omitted means both types
  (`api/app/schemas/search.py:66-67`, `api/app/services/search.py:60-63`). **Nothing on the server forces
  apartments-only.**
- `_public_listings()` (`services/search.py:45-57`) is the one visibility rule and is type-blind.
- The misfit-room rule lives in `search_listings` (`services/search.py:145-149`): a seeker with a profile never
  sees a room where `room_fit` is false; `total` therefore differs per caller. It must follow rooms to the market.
- One listing page for both types: `/listings/:id` (`web/src/app/routes.tsx:58`). Its back link and not-found
  button are hard-coded to `/search` (`features/listings/ListingPage.tsx:78`, `:206`).
- One wizard with a type step (`features/listings/TypeStep.tsx`, `ListingWizard.tsx:489-494`), one "my listings"
  for both types (`MyListingsPage.tsx`), one `ListingCard` and `cardTitle.ts` (used in 14 places).
- **Type switching is live end to end**: `PATCH /listings/{id}` accepts `listing_type`
  (`services/listings.py:188-194`), and in edit mode the wizard's back button reaches the type step
  (`ListingWizard.tsx:535-545`). A room switched to an apartment keeps its `room_pairs` and flatmates.
- All navigation is built in `features/auth/AuthMenu.tsx:44-155`. Signed in, it is one `<nav data-bottom-nav>`:
  a fixed bottom bar below `lg`, text tabs in the header from `lg`. Owner has 3 tabs, **seeker already has 5**.
  `FOCUSED_ROUTES` (`AuthMenu.tsx:18-23`) hides the bar on focused pages. There is no menu component.
- Home after login: owner → `/me/listings`, seeker → `/search` (`features/landing/home.ts:5`).

What changes
- Server: `listing_type` omitted must stop meaning "both" **(rec: default to `apartment`)**, so no client gets a
  mixed list by leaving the param out.
- Web: delete the type filter from the main search (`FiltersForm.tsx:215-257`, `filters.ts`,
  `ActiveFilterTags.tsx:53-54`); add the market search with its own query keys, and add those keys to the two
  cache-reset lists (`auth/useLogout.ts:41`, `profile/useSaveProfile.ts:21`).
- Listing page back link by type; `FOCUSED_ROUTES` gains the market's focused routes.
- Other hard-coded `/search` links that would send a room user to the wrong tab: `MyApplicationsPage.tsx:210`,
  `flatmates/JoinFlatPage.tsx:47-49`, `AuthMenu.tsx:67/108/112`.
- Copy in `web/src/locales/he.json` that speaks of both: `header.search` (:39), `search.title` (:284),
  `search.availableByHint` (:299), `listing.toSearch` (:372), `applications.mine.search` (:411),
  `flatmates.join.toSearch` (:976), `listings.type.*` (:116-120), `search.type.*` (:287-291),
  `listings.mine.*` (:235-247), `auth.role.owner` (:57), `landing.*` (:1090-1116), `app.tagline` (:4).

Tests that assert today's mixed search
- e2e: `web/e2e/search.spec.ts` ac12 (:125-160, room card in `/search`, then `?listing_type=room`),
  `applications.spec.ts:263` (`/search?listing_type=room`), `likes.spec.ts:126`.
- API: `api/tests/test_room_search.py` (ac1–ac3), `test_search.py:117`, `:129` (a room next to apartments).
- Web unit: `features/search/__tests__/SearchPage.test.tsx`, `SearchMap.test.tsx`, `filters.test.ts`.

Risks
- Two more top-level tabs do not fit a 5-tab bottom bar at 390 px. The nav must be regrouped (question Q1).
- `/listings/:id` links exist in chats, likes, applications and `?next=` return paths. Changing a room's URL
  breaks them; keeping the shared route costs nothing **(rec: keep)**.

### Step 2 — Role-free market

What exists
- Two gates only: `current_owner` and `current_seeker` (`api/app/auth.py:30`, `:38`), pure role equality. No gate
  is tied to a listing type. `users.role` is written once, at first OTP verify (`services/auth.py:167`). There is
  **no role switch** anywhere (PRODUCT.md promised one "slice TBD").
- The two halves of the market sit behind opposite gates, so one account cannot do both today:
  - owner gate: `POST /listings`, `GET /me/listings`, `PATCH /listings/{id}` (`routers/listings.py:43/54/85`),
    applicants + status (`routers/applications.py:216/242`), flatmates management
    (`routers/flatmates.py:86/104/174/198`), people browse + like person (`routers/people.py:108/141/177`);
  - seeker gate: apply / my applications / withdraw (`routers/applications.py:106/133/151`), like room + my likes
    (`routers/people.py:205/228/234`), profile (`routers/profiles.py:40/55`).
- `seeker_profiles` is role-free below the router: `services/profiles.py:50` checks no role, and the row is keyed
  by `user_id`. Only the router gate stops an owner from having a profile.
- `routers/search.py:46` `_is_seeker` decides who gets match data, like state and the room-privacy fields.
- The own-listing guards a mixed account needs **already exist in service code**: apply to own listing
  (`services/applications.py:210`), like own room (`services/people.py:464`), people browse never shows the
  lister (`services/people.py:143`), join own flat (`services/flatmates.py:138/162`), `liked_rooms` excludes own
  (`services/search.py:215`). None is a DB constraint except `conversations.owner_id <> seeker_id`.
- Chat `my_role` is per conversation, not `users.role` (`services/chat.py:190`), so a mixed account is already
  correct there.
- Web: `RequireOwner` wraps `routes.tsx:61-68`, `RequireSeeker` wraps `:69-73`. Role branches: `AuthMenu.tsx:95`
  (tabs), `landing/home.ts:5`, `ApplyBar.tsx:26-32`, `ListingPage.tsx:46/187`, `ApplySection.tsx:328-330`,
  `SearchPage.tsx:39`, `MatchCard.tsx:38`, `ProfileNudge.tsx:14`, `ConversationsPane.tsx:182` (empty copy from
  `users.role`), signup radio in `OtpForm.tsx:214-283` and `?role=` in `SignupPage.tsx:20`.

What changes (rec)
- The role is checked only for apartment actions: creating an apartment (owner) and applying to an apartment
  (seeker). Every room action becomes `current_user` plus the ownership checks that already exist.
- Any account may have the profile. The room privacy rule stays seekers-only (decision 13): `_is_seeker`
  (`routers/search.py:46`) must stop reading `users.role` alone and also accept a market user who is looking.
- Listing responses need an `is_mine` flag: today the API never says whose listing it is, so a mixed account would
  see the apply form on its own room (the API then answers 404).
- Public search returns the caller's own room; the market should label it, not hide it (rec).

Tests: 15 API assertions on `owner_only` / `seeker_only` (test_applications 3, test_inbox 3, test_people 4,
test_flatmates 2, test_profiles 2, test_listings 1), about 10 web unit tests, 0 e2e.

Risks
- The 3-live-listing cap counts apartments and rooms together (`services/listings.py:68`); the web hard-codes
  `LISTING_CAP=3` (FOLLOWUPS:32).
- Signup still forces an owner/seeker choice on someone who came only for the market (question Q10).

### Step 3 — Photos

What exists: nothing. No column, endpoint, dependency, env var or component; `0002c` was only ever a name.
- Placeholders today: `ListingCard.tsx:154-175` (16:10 box), `ListingPage.tsx:92-100` (band), initial-letter
  circles in `PersonCard.tsx:113-115`, `ConversationsPane.tsx:68-70`, `ApplicantCard.tsx:190-196`,
  `FlatmatesPage.tsx:264-266`. There is no shared Avatar or Image component.
- Design: `design/brand/README.md:50` — photos shown as uploaded, cropped 16:10, only a corner badge on top.
  `Listing.dc.html:21-43` implies about 12 photos, a "1 / 12" counter and a thumbnail strip.
  `CreateListing.dc.html` has a "תמונות" stepper label but **no artboard body**. No artboard for a person photo.
  PRODUCT.md says no new artboards, so the design goes into the spec.
- API has no `python-multipart`, `Pillow` or `boto3` (`api/pyproject.toml:6-18`); each is a new dependency the
  spec must name (hard rule 9). No body-size limit, no StaticFiles, no CSP anywhere.
- Patterns to copy: the email adapter (`services/email.py:20-91`: Protocol, file backend, real backend, FastAPI
  dependency chosen by `settings.email_backend`) and its production guard in `config.py:93-115`.
- Worker: the only job is a cron sweep over a "pending" DB status (`worker.py:36-47`); nothing enqueues jobs and
  the API has no arq pool.
- `services/rate_limit.py:38` `count_or_raise` is reusable as is for an upload limit.
- Infra: `.outbox` is mounted on the api container only, created with `chmod 0777` because the api runs as uid
  10001 (`Makefile:49-52`); `make down` only removes `.outbox/*.json`. A photo folder needs its own mount,
  mkdir/chmod and cleanup line.
- PWA: no runtime caching, and `make build-check` fails if any is added (`web/pwa.config.ts`,
  `web/scripts/build-check.mjs`). Photos stay network-only.

External facts (Cloudflare docs, 2026-11-13)
- R2 presigned links support PUT but **cannot limit the upload size**, do not support HTML form POST, and work
  only on the S3 endpoint, not a custom domain.
- So **(rec)** uploads go through our API: it checks size and type, re-encodes with Pillow (which also strips
  EXIF, including GPS), writes two sizes, then stores. Resize runs in the request (`asyncio.to_thread`); move it to
  the worker sweep only if upload bursts hurt the API.
- 10 GB at about 350 KB per photo (both sizes) is roughly 28,000 photos.

Risks
- A person's photo URL must not reveal a user id: `PersonOut.id` is deliberately the pair id
  (`schemas/people.py`). Object keys must be random.
- FOLLOWUPS:92/136 propose a 64 KB body cap middleware; it must exempt the upload route.
- Uploads make the `security` reviewer mandatory (`specs/_template.md:6`).
- The deploy target (Fly vs Railway) is undecided; only R2 gives durable storage either way.

### Step 4 — Flat profile and room facts

What exists
- Room columns (`api/app/models/listing.py:163-175`): `gender_preference`, `flatmates_count`, `flatmate_ages`,
  `lifestyle`. `ck_listings_room_fields` (:108-112) forces an apartment to hold their defaults.
- **Two of the planned "new" facts already exist on every listing**: `size_sqm` (:140, required) and `furnished`
  (:150, none/partial/full, required), and the copy already has room wording (`listings.furnishedRoom`,
  he.json:259). `furnished` also feeds a search filter (`services/search.py:83`). So the really new facts are:
  room size (if separate from the flat's size), private bathroom, balcony, bills, who is posting.
- The apartment-holds-defaults rule is written in four places, and a new room-only column must be added to all of
  them: the model CHECK (`listing.py:108`), `ROOM_FIELD_DEFAULTS` (`schemas/listing.py:100-105`), `ListingIn`
  `_room_fields` (`schemas/listing.py:160-177`) and the type-switch write (`services/listings.py:188-194`); plus
  the migration and the pinned CHECK list in `api/tests/test_migrations.py:152-175`.
- Helpful: `services/listings.py:147-161` `_merged` iterates `ListingIn.model_fields`, and the test factory
  `make_listing` (`api/tests/conftest.py:361`) accepts any table column, so both pick new fields up by themselves.
- **Public by default**: `ListingPublic.from_listing` (`schemas/search.py:163-174`) builds from every model field
  and empties only `SEEKER_ONLY_FIELDS` (:111-114: `flatmate_ages`, `lifestyle`). Each new field needs a
  deliberate public-or-signed-in choice. Test: `test_room_search.py:585`.
- Flatmates: `listing_flatmates` stores only listing, user and `joined_at` (`models/flatmate.py:22-43`).
  `FlatmateOut` is id, display name and join date, **to the lister only** (`schemas/flatmates.py:46-51`,
  `services/flatmates.py:198`). No endpoint returns a flatmate's age, about-me or answers to anyone, and no web
  page shows a flatmate as a person (`FlatmatesPage.tsx`, `MyFlatsPage.tsx`, `JoinFlatPage.tsx`).
- A flatmate's personal data would come from `seeker_profiles` (`models/seeker_profile.py:101-113`), but:
  a flatmate need not have one (join needs only a signed-in user, `routers/flatmates.py:150`); a profile
  **requires the whole housing block** (budget, areas, household, move-in: `schemas/profile.py:149-173`); and
  `about_me` / `birth_year` can exist only when `gender` is set (`ck_seeker_profiles_room_section`, :76-80).
  Someone who already lives in the flat has no budget or move-in date to give.
- Nothing links the typed `flatmates_count` / `flatmate_ages` to joined flatmates. Typed ages are sorted and
  anonymous (`web/src/features/listings/validate.ts:268-310`), so they cannot be matched to a person. Both are
  capped at 7 (`services/flatmates.py:48`). It is not stated whether the lister is counted.
- Web touch-points for a new room field: `listings/RoomFields.tsx:51-194` (rendered from
  `PreferencesStep.tsx:140`), `validate.ts:47-54`, `:104-105`, `:136`, `:270-310`, `:349-352`, `:382-386`,
  `:410-432`, `ListingWizard.tsx:50-56`, `RoomPreview.tsx`, `rooms/RoomFacts.tsx:16-75` (the room section of the
  listing page), `rooms/flatmates.ts:18-45` (the "2 שותפים (27, 30)" line).
- Matching reads none of `size_sqm`, `furnished`, `flatmates_count`, `flatmate_ages` (`matching/score.py:135-185`).
- Alembic head is `0012`; the next migration is `0013`.

What changes (rec)
- Every new room fact is **optional** (nullable): no backfill for existing rooms, and no fixture or e2e helper
  breaks. Migration 0009's "legacy room" precedent already allows a NULL room field.
- New facts do not enter the match score or the search filters in the first version.
- The flat's questionnaire stays typed by the lister, so the score input and its privacy rule do not move; each
  joined flatmate's own answers show on their own card.

Risks
- Showing a flatmate's age, about-me or answers on a room page is a new use of personal data: joining a flat was
  never consent to be shown (question Q20), and `people_visible` means something else.
- The profile's required housing block blocks the "person who lives here" case (question Q19).
- `ListingOut` / `ListingPublic` list fields explicitly and `web/src/api/schema.d.ts` is generated and
  git-ignored, so web type breaks appear only after `make client`.

### Step 5 — People browse people

What exists
- Browse: `GET /listings/{id}/people` (`routers/people.py:96-120`), owner of a live room only. Fixed page of 20,
  offset only, **no filters, no rate limit**. Candidates (`services/people.py:136-151`): has a room section,
  `room_fit` true, not the owner, not a flatmate, opted in **or** already liked this room, no open application.
- The card selects columns by name and never loads the budget (`services/people.py:201-211`).
- **Browse is a write path**: every page inserts one `room_pairs` row per candidate to freeze the price
  (`services/people.py:229-249`; FOLLOWUPS:158-159 already notes it grows forever).
- Likes: `room_pairs` is listing × seeker (`models/room_pair.py:36-55`). Like limit 30/h and 100/day per user
  (`services/people.py:86-90`). A mutual like inserts a `shortlisted` application and its conversation
  (`services/people.py:312-364`).
- Chat is keyed by the application in the schema itself: `conversations.application_id` is the primary key
  (`models/conversation.py:26-30`), and `messages.conversation_id` and `conversation_reads.conversation_id`
  both point at it (`models/conversation.py:61-65`, `models/flatmate.py:49-53`; migrations `0006`, `0012`).
- `services/chat.py` assumes an application in about 14 statements: INNER JOINs to Application and Listing
  (:313-314, :356-357, :469, :485), `can_send = Application.status == 'shortlisted'` (:305, :474), flatmate
  membership through `Application.listing_id` (:138-145, :224-241, :547-568), and `_indexed_member` (:186), which
  matches conversation ids against application ids.
- API schemas require a listing on every conversation and thread (`schemas/chat.py:79-98`).
- Web links into chat by application id: `ApplicantCard.tsx:350`, `ApplicantPane.tsx:147`,
  `MyApplicationsPage.tsx:139`, `PeoplePage.tsx:178`, `likes/MutualBanner.tsx:22`. The chat pages only validate
  that the id is a UUID. e2e asserts `/chat/${applicationId}` in `inbox.spec.ts:84/106` and
  `flatmates.spec.ts:220/268/278`.
- SSE channels are per user (`services/chat_events.py:60-61`), so a direct chat needs no change there beyond its
  member list.
- Matching: `room_fit(listing, profile)` (`matching/fit.py:17-34`) cannot compare two people; the two-way gender
  rule is a new expression. `_lifestyle` (`matching/score.py:106-127`) reads only the `lifestyle` JSON on both
  sides and is the reusable piece for the later rating.

What changes (rec)
- Conversations get their own id; `application_id` becomes optional. **Existing rows keep id = application id**,
  so every existing link, test and `_indexed_member` keep working, and only direct chats get a fresh id.
- The INNER JOINs in `services/chat.py` become LEFT JOINs. Left as they are, a chat with no application would
  silently vanish from the list, the thread and send instead of failing.
- `listing` becomes optional on `ConversationOut` / `ThreadOut`; the web chat header needs a no-listing form
  (`ConversationsPane.tsx:34/63/98`, `ChatThreadPage.tsx:123/178/193-201`).
- Person likes get their own table (two users, one row per pair) instead of a nullable listing in `room_pairs`.
- People browse for people does not copy the snapshot-on-browse write: there is no price to freeze, so a pair
  row is written only on a like.
- A browse rate limit settles FOLLOWUPS:167 for the room side as well.

Risks
- A direct chat has no application status, so "open" and "closed" need a rule of their own (question Q14).
- `people_visible` was consented to as "show me to flats looking for a flatmate" (question Q12).
- FOLLOWUPS:166 (an owner infers hidden fields from the card score) stays open; person cards show no score in the
  first version, so it is not made worse.
- FOLLOWUPS:162: `about_me` lets contact details through; wider browse makes it matter more.

## 4. Follow-ups this work touches

- Settled by the market: FOLLOWUPS:167 (people-browse rate limit), :246 (role label "דירה / חדר"), :250 (two CTAs
  in the empty "my listings"), PRODUCT.md "Chat" ("generalised before launch").
- Made more urgent: :158-159 (snapshot growth), :162 (contact details in about me), :32 (`LISTING_CAP` constant),
  :92/:136 (body-size cap), :93 (`/me/conversations` unpaginated), :160 (`/me/likes` unpaginated).
- Search performance notes (:114, :140, :143) assumed one scan over both types; a type predicate changes them.

## 5. Before any build

- Main's CI e2e is red: `applications.spec.ts::ac9_fill_profile_apply_withdraw` hits its 30 s timeout.
  One-line fix **(rec)**: `test.slow()` on that test. Needs Gilad's OK and one small e2e-only PR first.
- PRODUCT.md rows "Rooms" (:16), "People & likes" (:17), "Listing edit" (:28) and "Search" (:30) contradict the
  market decisions and must be rewritten when the specs are locked.

## 6. Product questions — all answered (Gilad, 2026-11-13)

Gilad answered Q4, Q8, Q12, Q16, Q19 and Q20 one by one (Q8 against the recommendation: seekers only) and then
accepted every other recommendation below as written. Each row is a decision. One point is still the
orchestrator's reading and is confirmed when its spec is written: who counts as a "seeker" in Q8 (decision 13).

| # | Question | Answer |
| --- | --- | --- |
| Q1 | Where do the two tabs sit? | A two-way switch at the top (דירות / שוק השותפים); the bottom bar shows the chosen side's own tabs. Chat stays in both. |
| Q2 | Does a room keep the address `/listings/:id`? | Yes. Old links in chats and likes keep working; only the back link changes. |
| Q3 | Old `/search?listing_type=room` links | Redirect to the market search. |
| Q4 | May an edit still switch a listing between apartment and room? | **Decided (12).** No. It reverses PRODUCT.md "Listing edit", and a switched room would drag its likes and flatmates into the apartment side. |
| Q5 | Is the cap of 3 live listings shared between apartments and rooms? | Shared for now; raise it when someone hits it. |
| Q6 | Where does a signed-in person land? | Unchanged: owner on "my listings", everyone else on apartment search. |
| Q7 | Landing page | Add one entry point to the market; a full rework waits. |
| Q8 | Who sees flatmate ages and answers on a room? | **Decided (13): seekers only**, not every signed-in user. Rooms stay public; the people tab needs login. |
| Q9 | Is "a person looking" the existing profile, open to every account? | Yes, reuse it. |
| Q10 | Signup from the market still asks owner or seeker? | Skip the question there and store "seeker"; the choice stays on the apartment signup. |
| Q11 | Photo limits | Up to 10 per listing, 8 MB per upload, none required to publish, the first is the cover. One photo per person. |
| Q12 | The "show my card" switch today means "to flats". Reuse it for people? | **Decided (14).** One switch, re-worded "show my card in שוק השותפים". This assumes there are no real users yet. |
| Q13 | Does the entry ticket apply to room listers? | A live room or a visible card both count. |
| Q14 | Can a direct chat be closed? | Either side can remove the match; the chat stays readable and sending closes, as after a withdraw. |
| Q15 | What does a person card show before the rating exists? | No score; the questionnaire comparison against your own answers. |
| Q16 | Who sees a person's photo, and how are photos served? | **Decided (15), marked important.** Whoever may see the card or shares a chat with them. Files get random, unguessable public addresses; a leaked address stays viewable. Signed addresses are possible but cost more and rule out our own domain. |
| Q17 | Typed flatmate ages vs real joined flatmates | Joined flatmates are shown as people; the typed count stays, typed ages remain only for flatmates who have not joined. |
| Q18 | Spec numbering | The market takes `0010*`; trust, admin and launch move to 11, 12, 13. |
| Q19 | A profile today demands budget, areas and move-in date. A flatmate who already lives in the flat has none. | **Decided (16).** Split the profile: a personal part (gender, age, about me, answers, photo) anyone can fill alone, and a "what I am looking for" part needed only to apply or to appear as a person looking. |
| Q20 | Does joining a flat mean being shown on the room's page? | **Decided (17).** No. Each flatmate chooses at join ("show me on the flat's page"), default off; without it they count in the number only. |
| Q21 | Who answers the flat's questionnaire? | The lister, as today; each shown flatmate's own answers appear on their card. |
| Q22 | Room size and furnished | Size and furnished already exist on every listing. Keep them as the flat's; add one optional "room size". New facts: private bathroom, balcony, bills, who is posting, all optional. |
| Q23 | Is the lister counted in "flatmates living there"? | No: the count is the other people in the flat; the lister appears as a person only if they say they live there (who is posting = current flatmate). |
