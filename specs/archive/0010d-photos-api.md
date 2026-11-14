---
id: 0010d
title: A lister uploads up to 10 photos to a listing, removes and reorders them; every listing response carries the photo addresses (cards the cover), which are random and never contain a user or listing id
status: done
depends_on: []   # migration 0013, down 0012 (MARKET-PLAN §7). Builds in parallel with 0010a. 0010g's migration 0014 chains on this one; 0010j (person photo API) builds on it
reviewers: [code, qa, security]   # security: uploads (decoder input, size, decompression bombs, EXIF/GPS), public object addresses (Q16), ownership on every write, R2 secrets; qa: the 10-photo cap under concurrency, cleanup of stored objects, every read surface
estimate: 1 coder run   # coder Opus/high (uploads, migration; Speed rule 6)
---

## Goal
After this ships, the owner of a listing (apartment or room, any status) uploads photos to it one at a time
(at most 10, JPEG, PNG or WebP, 8 MB each), deletes them and sets their order; the first is the cover. The
API re-encodes every upload (no EXIF, no GPS) into two WebP sizes and stores them under a random key: on disk
in dev and CI, on Cloudflare R2 in production. Listing responses carry the photos (cards: the cover only).
This spec also lays the groundwork the person photo needs (`users.photo_key` in migration 0013, the store,
`encode`, the upload plumbing); the person photo itself (`/me/photo` and every `photo_url`) is
`0010j-person-photo-api` (split by the orchestrator, 2026-11-13).

This serves PRODUCT.md "שוק השותפים" (photos for rooms, apartments and people; R2 approved; random,
unguessable addresses, Gilad: important) and MARKET-PLAN §1 decisions 8, 9, 15 and §6 Q11/Q16. The shared
names are MARKET-PLAN §7 "Photos (0010d)". The web halves are `0010e` (wizard) and `0010k` (display); the person photo API is `0010j`.

## Scope
**In:**
- Migration `api/alembic/versions/0013_photos.py` (revision `"0013"`, down `"0012"`), see Data. Model
  `ListingPhoto` in `api/app/models/photo.py` (new, exported from `models/__init__.py`), and
  `User.photo_key: Mapped[str | None]` (column and model only; nothing reads or writes it until `0010j`).
- `api/app/services/photo_store.py` (new), modelled on `services/email.py:20-91`:
  - `class PhotoStoreUnavailable(Exception)`.
  - `class PhotoStore(Protocol)`: `put(name: str, data: bytes) -> None`; `delete(names: Sequence[str]) -> None`.
  - `FilePhotoStore(photo_dir: Path)`: `put` runs `photo_dir.mkdir(parents=True, exist_ok=True)` (as
    `email.py:37`) and writes `photo_dir / name` through a temp file `.{name}.tmp` in the same directory and
    `os.replace` (a reader never sees half a file); `delete` unlinks with
    `missing_ok=True`. `OSError` → log the type only, raise `PhotoStoreUnavailable`.
  - `R2PhotoStore(account_id, access_key_id, secret_access_key, bucket)`: one boto3 S3 client, built once
    per process (`functools.lru_cache` on a module function keyed by the settings values), endpoint
    `https://{account_id}.r2.cloudflarestorage.com`, `region_name="auto"`, a `botocore.config.Config` with
    connect/read timeouts 5 s / 10 s, `retries={"max_attempts": 2}` and
    `request_checksum_calculation="when_required"`, `response_checksum_validation="when_required"` (boto3 ≥
    1.36 sends checksums by default; Cloudflare's boto3 example turns them off). `put` = `put_object(Bucket, Key=name, Body=data,
    ContentType="image/webp", CacheControl="public, max-age=31536000, immutable")` (a key is never reused, so
    a year is safe). `delete` = one `delete_objects` with `Quiet=True`. `botocore.exceptions.BotoCoreError`
    and `ClientError` → log the type and the S3 error code only (never the key or the credentials), raise
    `PhotoStoreUnavailable`.
  - `get_photo_store() -> PhotoStore`: the FastAPI dependency chosen by `settings.photo_backend`, as
    `get_email_sender` (`email.py:83-91`).
- `api/app/services/photos.py` (new), the logic:
  - Constants: `MAX_PHOTO_BYTES = 8 * 1024 * 1024`, `MAX_LISTING_PHOTOS = 10`, `MAX_PIXELS = 40_000_000`,
    `SMALL_EDGE = 480`, `LARGE_EDGE = 1600`, `ALLOWED_FORMATS = {"JPEG", "PNG", "WEBP"}`.
  - `new_key() -> str` = `secrets.token_urlsafe(32)` (43 characters). Object names are `f"{key}-s.webp"` and
    `f"{key}-l.webp"`; nothing else is ever part of a name (Q16).
  - `encode(data: bytes) -> Encoded(small: bytes, large: bytes, width: int, height: int)`. Pure, so it is
    unit-tested without a database. `PIL.Image.MAX_IMAGE_PIXELS = MAX_PIXELS` is set at import as a
    backstop (no `warnings.catch_warnings`: it is process-global and not thread-safe in the threadpool;
    verifier finding 2). Steps: `Image.open(BytesIO(data), formats=["JPEG", "PNG", "WEBP"])` (lazy: reads the
    header only, and no other Pillow plugin ever parses input); `img.format not in ALLOWED_FORMATS` →
    `UnsupportedImageError` (`ALLOWED_FORMATS = {"JPEG", "MPO", "PNG", "WEBP"}`: Pillow reports a JPEG with an
    MPF block, as many iPhone and Samsung photos are, as `MPO`; frame 0 is the primary image);
    `img.width * img.height > MAX_PIXELS` → `PhotoTooLargeError` **before** decoding; `img.draft("RGB",
    (LARGE_EDGE, LARGE_EDGE))` (JPEG/MPO only: DCT-scaled decode, so a 40 MP photo never sits in memory at
    full size); then `ImageOps.exif_transpose(img)` (orientation applied, so the EXIF can go), first frame only
    (an animated WebP or APNG keeps frame 0), mode `RGBA` if the image has alpha (`img.has_transparency_data`)
    else `RGB`, `img.info.clear()`, and for each edge a copy with `thumbnail((edge, edge),
    Image.Resampling.LANCZOS)` (never upscales) saved as `WEBP` with `quality=80` (`method=4`). No `exif=`,
    `icc_profile=` or `xmp=` argument is passed, so the output has no metadata. `width` / `height` are the
    large copy's. `Image.DecompressionBombError` → `PhotoTooLargeError` (413); `PIL.UnidentifiedImageError`
    and **any other exception** inside `encode` (`OSError`, `ValueError`, `SyntaxError`, `struct.error`,
    `EOFError`, `KeyError`, `TypeError` from corrupt headers or EXIF) → `UnsupportedImageError`, logged by
    type only. A module-level `threading.BoundedSemaphore(2)` wraps `encode`, so at most two images are
    decoded at once per process (memory bound).
  - `add_listing_photo(db, store, owner, listing_id, data) -> ListingPhoto`: `encode` first (no DB work
    for a bad image), then `key = new_key()`, and inside one `try`: `store.put` both names, then in one
    transaction: `SELECT listings ... WHERE id = :id AND owner_id = :me FOR NO KEY UPDATE`
    (`with_for_update(key_share=False, no_key=True)`: it does not block the `FOR KEY SHARE` that apply and
    like take, `services/search.py:191`, and still serialises uploads; → `ListingNotFoundError`, the existing
    exception from `services/listings.py`), `count(*)` of its photos, `>= MAX_LISTING_PHOTOS` →
    `PhotoLimitError`, insert at `position = count`, commit. Any exception inside the `try` (the second
    `put`, not found, the limit, a DB error) runs `store.delete([both names])` in a `try/except
    PhotoStoreUnavailable: log` and re-raises, so a refused or failed upload leaves no object behind. The listing lock makes two concurrent
    uploads at 9 photos end with exactly 10.
  - `delete_listing_photo(db, store, owner, listing_id, photo_id) -> None`: lock the listing as above
    (`FOR NO KEY UPDATE`), delete
    the row (`WHERE id = :photo AND listing_id = :listing` → else `PhotoNotFoundError`), `UPDATE
    listing_photos SET position = position - 1 WHERE listing_id = :listing AND position > :deleted`, commit,
    then `store.delete` both names. A store failure after the commit is logged and swallowed: the row is
    gone, so the address is no longer listed anywhere; the orphan object is accepted (see Risks).
  - `reorder_listing_photos(db, owner, listing_id, photo_ids) -> list[ListingPhoto]`: lock the listing; the
    ids must be exactly the listing's photo ids, each once (else `PhotoOrderMismatchError`); one `UPDATE ...
    FROM (VALUES ...)` sets `position` to the index; commit; returns them in the new order.
  - Readers (no lock): `photos_by_listing(db, listing_ids) -> dict[UUID, list[ListingPhoto]]`, one
    statement, ordered by `(listing_id, position)`, skipped (no statement) for an empty id list.
  - URL builders: `small_url(key) = f"{base}/{key}-s.webp"`, `large_url(key) = f"{base}/{key}-l.webp"` with
    `base = get_settings().photo_public_base_url`; `photo_out(id, key) -> PhotoOut`.
  - Rate limit: `count_or_raise(r, [(f"rl:photo:user:{user.id}", 60, 3600), (f"rl:photo:user:{user.id}:day",
    300, 86400)])` (`services/rate_limit.py:38`), called by the routers on every authenticated upload attempt
    (`0010j`'s person upload counts against the same two counters) **before** the body is read, so a refused upload costs no bandwidth. Delete and
    reorder are not counted.
- `api/app/routers/photos.py` (new), registered in `create_app`. The upload route is `async def` (`0010j` adds its own upload route to this router the same way):
  they take `request: Request`, read the body with `read_capped(request, MAX_PHOTO_BYTES)` (below), then run
  the service in `starlette.concurrency.run_in_threadpool` (Pillow and the sync session never block the
  event loop). The other two routes are plain `def`, as every router today.
  - **Before the body is read**, one `run_in_threadpool` call runs `count_or_raise` (the sync Redis call stays
    off the event loop) and `db.commit()`: `current_user` (`services/auth.py:212`) has auto-begun a
    transaction, and committing returns its connection to the pool, so a slow 8 MB stream, the encode and an
    R2 put never hold a pooled connection idle-in-transaction (pool 5+10). `expire_on_commit=False`
    (`db.py:60`) keeps `user` loaded (verifier finding 4).
  - `read_capped(request, cap) -> bytes`: a `Content-Length` above the cap → 413 at once, without reading;
    otherwise iterate `request.stream()` and raise 413 as soon as the running total passes the cap (this also
    covers a chunked body with no `Content-Length`). An empty body → 415 `unsupported_image`.
  - **Raw body, not multipart**: the request body is the image file itself (`Content-Type: image/jpeg`,
    `image/png` or `image/webp`; the header is not trusted, Pillow decides the format). This keeps the
    8 MB cap a streaming check and avoids `python-multipart`, which would spool the whole body to disk
    before the route runs. The routes declare the body for the client with `openapi_extra={"requestBody":
    {"required": True, "content": {t: {"schema": {"type": "string", "format": "binary"}} for t in the three
    types}}}`.
- `api/app/schemas/photo.py` (new): `PhotoOut {id: UUID, small_url: str, large_url: str}` and
  `PhotoOrderIn {photo_ids: list[UUID]}` (`Field(min_length=1, max_length=10)`, `extra="forbid"`).
- Read surfaces (MARKET-PLAN §7):
  - `schemas/search.py`: `ListingPublic` gains `cover: PhotoOut | None`; `ListingDetail` gains `photos:
    list[PhotoOut]` (position order; `cover` is `photos[0]` or null). `from_listing` reads every other model
    field from the row (`search.py:163-174`), so every caller passes `cover=` (and `photos=` for the detail)
    in `**fields`: `routers/search.py` (search, map, detail) and `routers/people.py:240` (`/me/likes`).
  - Search, map and liked rooms get the cover **in their existing page statement**: `services/search.py`
    `search_listings` (`:137-164`) and `liked_rooms` (`:199-228`) add `LEFT JOIN listing_photos cover ON
    cover.listing_id = listings.id AND cover.position = 0` and select `cover.id` / `cover.key` labelled
    `cover_id` / `cover_key` (`explain_row` reads `row._mapping`); their return
    tuples gain the two values. The count query (`:153`) is untouched. So search and the map stay two
    statements (`test_search.py:354`, `test_map_search.py:175` unchanged).
  - The listing page (`routers/search.py::get_listing`) runs `photos_by_listing(db, [listing.id])` **after**
    `record_view` (one statement more, the last), so `test_applications.py:529-532`'s `sent[0..2]` order
    holds and only the count (3 → 4) and one `sent[3]` "FROM listing_photos" assertion are added.
  - `schemas/listing.py`: `ListingOut` gains `photos: list[PhotoOut]` with `Field(default_factory=list)` and
    `json_schema_serialization_defaults_required=True` added to its `model_config` (so the generated type
    marks it required). `POST /listings` returns `[]`; `PATCH /listings/{id}` and `GET /me/listings` fill it
    from `photos_by_listing` (one statement for the whole list, none when it is empty) with
    `.model_copy(update={"photos": ...})` (`routers/listings.py:56-57` builds `MyListingOut(**dict(...))`,
    so passing `photos=` there too would be a duplicate keyword). `MyListingOut` inherits it. **No
    `Listing.photos` ORM relationship**: `model_validate(listing)` with `from_attributes` would lazy-load it.
- `api/app/config.py` `Settings` gains: `photo_backend: Literal["file", "r2"] = "file"`; `photo_dir: Path =
  Path("./.media")`; `photo_public_base_url: str = "http://localhost:8000/media"` (validator: trimmed, an
  `http`/`https` URL with a host and no query or fragment, trailing `/` removed); `r2_account_id: str |
  None = None`; `r2_access_key_id: SecretStr | None = None`; `r2_secret_access_key: SecretStr | None = None`;
  `r2_bucket: str | None = None`. Rules in `_email_and_production_rules` (`config.py:93-116`), messages
  naming the rule only, never a value: `photo_backend == "r2"` needs all four `r2_*` set and non-empty
  (`test_openapi_export.py:16` turns a commented `# R2_BUCKET=` into `""`); under an https
  `web_origin`: `PHOTO_BACKEND` must be set explicitly, must be `r2` (local disk is not durable on the deploy
  target), and `PHOTO_PUBLIC_BASE_URL` must be https and not `localhost`/`127.0.0.1`.
- `api/app/main.py`: `if settings.photo_backend == "file":` create `settings.photo_dir` (`mkdir(parents=True,
  exist_ok=True)`; with a missing folder `StaticFiles` raises on the first request), then `app.mount("/media",
  StaticFiles(directory=settings.photo_dir), name="media")`. Nothing is mounted with `r2`.
  `mimetypes.add_type("image/webp", ".webp")` at import (the slim image's `mimetypes` may not know it).
- Infra:
  - `Makefile` `dev` and `dev-api` (`:51-58`, `:62-68`): `mkdir -p .outbox .media && chmod 0777 .outbox .media` (the api
    runs as uid 10001, as for `.outbox`); the comment above `dev` names both. `down` (`:71-73`) adds
    `rm -f .media/*.webp .media/.*.tmp`.
  - `infra/docker-compose.yml` api service: env `PHOTO_BACKEND: file`, `PHOTO_DIR: /media`,
    `PHOTO_PUBLIC_BASE_URL: http://localhost:${API_PORT:-8000}/media`; volume `../.media:/media` with a
    comment like the outbox's. The worker gets nothing (it never touches photos).
  - `.gitignore`: `.media/`.
  - `.env.example`: a "Photos (spec 0010d)" block: `PHOTO_BACKEND=file`, `PHOTO_DIR=./.media`,
    `PHOTO_PUBLIC_BASE_URL=http://localhost:8000/media`, and commented `# R2_ACCOUNT_ID=`,
    `# R2_ACCESS_KEY_ID=`, `# R2_SECRET_ACCESS_KEY=`, `# R2_BUCKET=` with a line saying production sets them
    in the host's secret env. `test_openapi_export.py` reads this file and must stay green.
- Tests: `api/tests/test_photos.py` (new), `api/tests/test_photo_encode.py` (new, unit), amendments to
  `test_migrations.py`, `test_config.py`, `test_search.py` (`PUBLIC_KEYS` + `cover`), `test_applications.py`
  (`:507` keys + `photos`, `:529` count 3 → 4), `test_listings.py` (`:372` count 2 → 3), `test_people.py`
  (`/me/likes` bodies + `cover`); `test_inbox.py:58` (`LISTING_OUT_KEYS`) derives from the model and needs no
  edit. The person-photo amendments are `0010j`'s.
- **Web types (verifier finding 1, blocker):** CI's web job runs `make client` then `tsc` over `src` and `e2e`
  (`web/tsconfig.json:20`), and the new fields are required in the generated types. This spec therefore runs
  `make client` and adds `cover: null` / `photos: []` where each listing type needs them in every typed
  fixture: `web/src/features/{search,listings}/__tests__/fixtures.ts`, `web/e2e/screens/fixtures-listings.ts`,
  `fixtures-my-listings.ts`, and any other file `tsc` names (`0010j` adds the person fields the same way). No component changes (`0010e`); `make lint-web test-web`
  green. `conftest.py` gains: a `photo_store` fixture (a `FilePhotoStore(tmp_path / "media")`, installed
  with `app.dependency_overrides[get_photo_store]`, removed after; AC11 builds its own app instead), `make_photo(engine, listing_id, *,
  position, key=None) -> uuid.UUID`, and a `jpeg(width=800, height=600, *, exif_gps=False, orientation=1)
  -> bytes` builder (Pillow, in memory).

**Out:**
- Web (`0010e`, `0010k`).
- Presigned direct-to-R2 uploads: R2 presigned links cannot cap the size (MARKET-PLAN §3 Step 3).
- Signed or expiring photo addresses (Q16: random public addresses; a leaked address stays viewable).
- A sweep for orphan objects (a crash between `put` and the DB write, or a failed delete): logged only; a
  follow-up if R2 usage ever shows drift.
- Deleting objects when a listing or account row is deleted: no route deletes either today; the FK
  cascade removes the rows, and the follow-up sweep covers the objects.
- Moving the re-encode to the arq worker (only if upload bursts hurt the API, MARKET-PLAN §3).
- The person photo (`/me/photo`, every `photo_url`): `0010j`.
- Captions, HEIC input (iOS converts to JPEG when the input accepts only
  JPEG/PNG/WebP), a CDN custom domain setup (deploy slice), the 64 KB body cap (FOLLOWUPS `0005a`/`0007a`,
  see Risks).

**New dependencies:**
- `Pillow` (runtime): decode, orient, resize and re-encode to WebP; the only safe way to strip EXIF/GPS.
  Pinned exactly (house style `==`), the newest release at build time; its wheels bundle libwebp, so
  `infra/Dockerfile.api` needs no system package (the coder confirms `features.check("webp")` in the image).
- `boto3` (runtime): the S3 API that R2 speaks.
- `boto3-stubs[s3]` (dev group): types for mypy strict (`from mypy_boto3_s3.client import S3Client`); no
  `type: ignore` on boto3 calls.
- `uv.lock` updated with all three. `python-multipart` is **not** added (raw body, see Scope).

## Data
Migration `0013_photos` (down `0012`):
- `listing_photos`:
  - `id uuid PK DEFAULT gen_random_uuid()`;
  - `listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE`;
  - `key text NOT NULL`, `uq_listing_photos_key UNIQUE (key)`, `ck_listing_photos_key CHECK (key ~
    '^[A-Za-z0-9_-]{43}$')` (the token's alphabet and length: nothing else can become an object name);
  - `position smallint NOT NULL`, `ck_listing_photos_position CHECK (position BETWEEN 0 AND 9)`;
  - `uq_listing_photos_listing_position UNIQUE (listing_id, position) DEFERRABLE INITIALLY DEFERRED` (a
    reorder or a delete's shift passes through duplicates inside one statement/transaction). It also serves
    the cover join and `photos_by_listing`;
  - `width smallint NOT NULL`, `height smallint NOT NULL` (the large copy's, at most 1600; `CHECK > 0`);
  - `created_at timestamptz NOT NULL DEFAULT now()`.
- `users.photo_key text NULL`, `uq_users_photo_key UNIQUE`, and the same `CHECK` pattern (`ck_users_photo_key`).
  Added here so the chain needs one photo migration; `0010j` has none.

Downgrade drops the column, then the table. Stored objects are not touched by the migration (dev: `make
down` empties `.media`). No backfill: every existing listing and user has no photo, so every read surface
returns `[]`, `null` or `cover: null` for them, and no fixture or e2e helper breaks.

## API
| Method | Path | Auth rule | Request | Response | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/listings/{listing_id}/photos` | `current_user`, own listing (`owner_id = me`), any type and status | raw image body, ≤ 8 MB | 201 `PhotoOut` | 401; 404 `not_found` (unknown or another's); 409 `photo_limit` (10 already); 413 `photo_too_large` (bytes or > 40 MP); 415 `unsupported_image` (empty, not JPEG/PNG/WebP, corrupt); 429 `rate_limited` + `Retry-After`; 503 `photo_storage_unavailable` |
| DELETE | `/listings/{listing_id}/photos/{photo_id}` | `current_user`, own listing | — | 204; the photos after it move up one position | 401; 404 (unknown listing, another's, or a photo of another listing) |
| PUT | `/listings/{listing_id}/photos/order` | `current_user`, own listing | `PhotoOrderIn` | 200 `list[PhotoOut]` in the new order | 401; 404; 422 `photo_order_mismatch` (not exactly the listing's photos, or a repeat); 422 list (malformed) |
| GET | `/media/{name}` | public; mounted only with `PHOTO_BACKEND=file` (dev, CI, e2e) | — | the file, `Content-Type: image/webp` | 404 |
| GET | `/listings`, `/listings/{id}`, `/me/likes`, `/me/listings`; POST `/listings`; PATCH `/listings/{id}` (changed) | as today | as today | `+cover` (search, map, likes), `+photos` (detail, own listings, POST/PATCH) | as today |

No role gate on photos: ownership is the rule, so 0010b's role-free market needs no change here. A
`PhotoStoreUnavailable` maps to 503 `photo_storage_unavailable` (a JSON `ErrorOut`, like the DB's 503).
Upload routes never echo the body or log its bytes; a 413/415 logs the route and the error code only.

## UI
None (`0010e`, `0010k`); only the typed web fixtures change (Scope, verifier finding 1).

## Acceptance criteria
- [ ] AC1 Given owner `O` with listing `L`, When `O` POSTs a 3000×2000 JPEG, Then 201 with a `PhotoOut`
  whose `small_url` / `large_url` are `{PHOTO_PUBLIC_BASE_URL}/{key}-s.webp` / `-l.webp`, the key matches
  `^[A-Za-z0-9_-]{43}$`, and neither address contains `L`'s id, `O`'s id or the photo id. Both files exist in
  the store, decode as WebP with long edges 480 and 1600, and the row has `position 0`, `width 1600`, `height
  1066` or `1067` (aspect kept within a pixel). A PNG, a WebP and an MPO (a JPEG with an MPF block, saved by
  Pillow with `save_all=True`) upload also succeed (positions 1, 2, 3). — `api/tests/test_photos.py::test_ac1_upload_listing_photo`
- [ ] AC2 (security: metadata) Given a JPEG with an EXIF GPS block and `Orientation = 6`, When it is uploaded,
  Then neither stored file has EXIF, XMP or ICC data (`Image.open(...).getexif()` is empty and `info` has no
  `exif`/`xmp`/`icc_profile`), and the stored image is rotated (portrait: height > width). —
  `test_photo_encode.py::test_ac2_strips_metadata_and_applies_orientation`
- [ ] AC3 (security: input) A 8 MB + 1 byte body gets 413 `photo_too_large`, both with a `Content-Length`
  and as a chunked stream with none, and the stream test asserts the route stopped reading after the cap. A
  10000×5000 PNG (50 MP, small file) gets 413 without being decoded (a `load` spy is not called). A GIF, a
  PDF, random bytes, a truncated JPEG and an empty body get 415 `unsupported_image`. None of them leaves a
  file in the store or a row. The stopped-reading check calls `read_capped` directly with a hand-built
  `Request(scope, receive)` whose `receive` counts chunks (TestClient drains a streamed body before the app
  runs). — `test_photos.py::test_ac3_rejects_bad_input`, `test_photos.py::test_ac3_read_capped_stops_at_cap`,
  `test_photo_encode.py::test_ac3_pixel_cap_before_decode`
- [ ] AC4 (concurrency) Given `L` with 9 photos, When two uploads run at once on two connections, Then
  exactly one gets 201 and the other 409 `photo_limit`, the table holds 10 rows with positions 0–9, and the
  refused upload's two objects are gone from the store. An 11th upload gets 409. —
  `test_photos.py::test_ac4_limit_of_ten_under_concurrency`
- [ ] AC5 (security: ownership) `O2`'s upload, delete and reorder on `O`'s listing get 404 and change
  nothing; an anonymous call gets 401; deleting a photo id of another listing through `L`'s path gets 404.
  Any role may upload to their own listing (a seeker-role account owning a listing, made with
  `make_listing`, gets 201). — `test_photos.py::test_ac5_owner_only`
- [ ] AC6 Given photos p0, p1, p2, When `O` deletes p0, Then 204, p1 and p2 are at positions 0 and 1, p0's
  objects are gone, and `GET /listings/{L}` lists `[p1, p2]` with `cover` = p1. When the store's `delete`
  raises after the commit, the DELETE still returns 204 and the error is logged. — `test_photos.py::test_ac6_delete_shifts_and_cleans_up`
- [ ] AC7 `PUT .../photos/order` with `[p2, p0, p1]` returns them in that order and the next search shows
  p2 as the cover; a list missing one id, with an extra id, with a repeat or with another listing's id gets
  422 `photo_order_mismatch` and changes nothing. — `test_photos.py::test_ac7_reorder`
- [ ] AC8 (cleanup) When the DB write fails after the `put` (the insert is made to fail through a
  monkeypatched `count` that raises `OperationalError`), Then the response is 503 and both new objects are
  deleted. When `store.put` raises `PhotoStoreUnavailable`, Then 503 `photo_storage_unavailable` and no row
  exists. When the **second** `put` fails, the first object is deleted too. —
  `test_photos.py::test_ac8_store_and_db_failures_leave_nothing`
- [ ] AC9 (rate limit) The 61st upload attempt in an hour (refused ones included) gets 429 with `Retry-After`, before the body is read (a monkeypatched `read_capped` spy is
  not called); delete and reorder are not limited. —
  `test_photos.py::test_ac9_upload_rate_limit`
- [ ] AC10 Read surfaces: with `L` holding 2 photos, Then `GET /listings` and the map
  query return `cover` = the position-0 photo for `L` and `null` for a listing without photos, still in **two
  statements** (`test_search.py:354` and `test_map_search.py:175` pass unchanged); `GET /listings/{L}` has
  `photos` in order (amended count 4, one `FROM listing_photos`); `GET /me/listings` and `PATCH` return
  `photos` (amended count 3); `POST /listings` returns `photos: []`; `/me/likes` carries `cover`. —
  `test_photos.py::test_ac10_listing_read_surfaces`
- [ ] AC11 Dev serving (the test sets `PHOTO_BACKEND` / `PHOTO_DIR` to a missing `tmp_path` folder, calls
  `get_settings.cache_clear()` and builds its own `create_app()`): with `PHOTO_BACKEND=file` the folder is
  created and an uploaded `small_url` path is served by `GET
  /media/{key}-s.webp` with `Content-Type: image/webp`; with `PHOTO_BACKEND=r2` (an app built with r2 settings
  and a stub store) `/media/...` is 404 (not mounted). — `test_photos.py::test_ac11_media_mount_file_backend_only`
- [ ] AC12 R2 store: with botocore's `Stubber`, `put` sends `put_object` with `ContentType image/webp` and the
  one-year immutable `CacheControl`, `delete` sends one `delete_objects`; a stubbed `ClientError` becomes
  `PhotoStoreUnavailable` and the log line holds neither the key nor the secret. —
  `test_photos.py::test_ac12_r2_store`
- [ ] AC13 Config: `PHOTO_BACKEND=r2` without any one `R2_*` is refused; under `WEB_ORIGIN=https://...`
  an unset `PHOTO_BACKEND`, `PHOTO_BACKEND=file`, or an http or localhost `PHOTO_PUBLIC_BASE_URL` are refused;
  no error message contains a value. A trailing `/` on the base URL is removed. —
  `test_config.py::test_ac13_photo_settings`
- [ ] AC14 Migration: upgrade `"0012"` → `"0013"` → downgrade → upgrade on a database with a listing and a
  user; the table, column, unique/check constraints (by name) and the deferrable unique appear and disappear;
  a key with a `/` or of 42 characters is refused by the CHECK. — `test_migrations.py::test_ac14_photos_upgrade_downgrade`
- [ ] NF1 An upload of a 12 MP JPEG completes in under 1.5 s p95 on the dev machine (encode + file store),
  measured once by the coder and stated in the PR; the event loop is never blocked (encode and DB in the
  threadpool). — measurement in the PR

## Tests to write
Unit: `test_photo_encode.py` (AC2, AC3's pixel cap, format detection ignores the `Content-Type`, an RGBA
PNG keeps alpha, an animated WebP keeps frame 0, small images are not upscaled).
Integration: `test_photos.py` AC1, AC3–AC12; `test_config.py` AC13; `test_migrations.py` AC14; the key-set
and count amendments listed in Scope.
E2E: none here (`0010e`). Existing e2e keeps passing: the wizard and every page ignore the new fields until
`0010e`. `make dev` in CI's e2e job creates `.media`.

## Risks / open questions
- **Public addresses (Q16).** Anyone holding an address sees the photo, forever, also after it is deleted
  from a listing if a CDN cached it (one-year `Cache-Control`). Deleting removes the object from R2 at once;
  caches may hold it until expiry. Accepted by Gilad (Q16). The key is 256 bits of randomness and the CHECK
  makes any id in a name impossible.
- **Decoder attack surface.** Pillow parses untrusted bytes; the format allow-list is checked on the header
  before any decode, the pixel cap before `load`, and Pillow is pinned and updated with the lock file. The
  security reviewer should check that no plugin other than JPEG/PNG/WebP decodes pixel data.
- **Orphans.** A crash between `put` and commit, or a failed delete after a commit, leaves an unreferenced
  object (at most two files of ~350 KB). Logged; no sweep in this spec (Out).
- **Body cap follow-up** (FOLLOWUPS `0005a` main.py, `0007a`): when the 64 KB `Content-Length` middleware is
  built, it must exempt `POST /listings/{id}/photos` and `0010j`'s `PUT /me/photo` (their own 8 MB streaming cap
  applies). The coder adds this sentence to both FOLLOWUPS lines.
- **R2 account.** MARKET-PLAN §1 decision 9: not confirmed whether enabling R2 needs a payment card. Nothing
  in this spec needs a live bucket (CI and dev use the file backend; R2 is tested with a stub), so the build
  is not blocked; the deploy slice creates the bucket, its public access (r2.dev or a custom domain) and the
  API token scoped to the one bucket.
- **Statement counts.** Search, map and likes stay as they are; only the listing page
  (+1) and `/me/listings` / PATCH (+1) grow, and their pinned counts are amended in this spec.
- **CORS / CSP.** Images load with `<img>`, which needs no CORS. There is no CSP today; when one is added
  (trust slice) it must allow `img-src` for `PHOTO_PUBLIC_BASE_URL`'s origin.
- **Colour.** Dropping the ICC profile shifts Display-P3 phone photos slightly towards sRGB. Accepted:
  stripping all metadata is the rule; converting with `ImageCms` is a follow-up if listers notice.
- **Split (verifier finding 7; orchestrator 2026-11-13, option b).** The person photo (`/me/photo` and
  every `photo_url` surface, the former AC9 and AC12) moved to `0010j-person-photo-api` (depends_on 0010d, no
  migration), so an overflow here cannot block `0010e` / `0010f`.
- **Beyond §7** (named here as §7 asks): the four `r2_*` settings fields.
- **Raw body instead of multipart** deviates from the brief's dependency list (`python-multipart`). The web
  half (`0010e`) sends the `File` as the body with `bodySerializer` set to identity.
- If the run still overflows, the cut line is after AC1–AC8 and AC14 (upload, delete, reorder, migration);
  the read surfaces (AC10) and R2/config (AC12, AC13) follow in a small follow-up before `0010e`.

Spec-verifier round 1 (Opus/high): 1 blocker, 6 majors, 9 minors and the nits; **round 1: 16 findings
applied**; finding 7 (the split) was decided by the orchestrator (option b, `0010j`). No second round
(Gilad: one verifier round).

## Digest (filled by orchestrator after verification)
See `/digest`.
