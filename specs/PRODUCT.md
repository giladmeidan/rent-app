# Standing product decisions (read before writing any spec)

Updated: 2026-11-10. Full reasoning in the Product Plan doc.

| Topic | Decision |
| --- | --- |
| Scope | Whole-apartment rentals AND both roommate flows (room available / looking to join) from MVP |
| Language | Hebrew only at launch; i18n foundations for other languages from the first commit; RTL base layout |
| Brokers | Not allowed at launch. Owner cap: 3 active listings per account (admin may raise). Broker account type reserved in the data model for a later paid tier |
| Platform | Web first, responsive, PWA-installable |
| Pricing | Free; free-tier infrastructure. Paid services need an explicit decision from Gilad |
| Launch area | Gush Dan only; areas are a config table, listings outside are hidden |
| Gender preference | Hard filter on ROOM listings and room-seeker profiles only; never on whole-apartment listings |
| Applicant count | Shown to seekers as the exact number; Slice 4 logs applications-per-view to revisit |
| Account roles | Every account picks **owner** or **seeker** at signup (switchable later via a profile edit, slice TBD). Broker is an `account_type`, not a role (decided 2026-11-09) |
| Signup data | Email + display name (2–40 chars) only. No phone number is collected until SMS verification is switched on (decided 2026-11-09) |
| OTP | Email OTP in Slice 1; SMS adapter stubbed behind an interface; switched on at launch readiness |
| Matching | Hard filters (budget overlap, move-in window ±4 weeks, shared area, deal-breakers) then weighted distance score, 0–100, with top-3 agreeing / top-1 differing explanation |
| Chat | Opens only on owner shortlist or mutual interest; never one-sided |
| Trust (MVP) | Phone/email-verified accounts, report button everywhere, rate limits, listing auto-expiry **3 months (90 days from creation)** (changed from 30 days, Gilad 2026-11-10), deposit-before-viewing warning in chat |
| Listings | Decided 2026-11-10 (0002a batch): a listing has the CreateListing/Listing artboards' facts, no photos until `0002c`; **no drafts** (live on publish, the wizard's preview is the review step); a room listing uses the apartment fields until Slice 7 and is hidden from search until then; arnona is entered as the bi-monthly bill, vaad monthly; the 3-listing cap counts **live** listings only (paused or expired free a slot; a total-rows cap per owner is a later follow-up) |
| Search | Decided 2026-11-10 (0003a batch, all 7 accepted): search and the listing page are **public** (no login to browse; applying needs login in Slice 4); list first, the map is `0003c`; map tiles: **public OSM tiles while traffic is tiny, self-hosted Protomaps on R2 once R2 is approved**; default sort newest, plus price up/down, until Slice 6's match score; entry-date filter = "available by my move-in date", a flexible (±2 weeks) listing counts 14 days earlier; the public listing shows **no owner name** and the street **without a house number**; room listings stay hidden from search until Slice 7 while the wizard keeps offering "room" |
| Stack | React+TS+Vite+Tailwind, FastAPI, PostgreSQL+PostGIS, Redis, arq worker, MapLibre+OSM tiles, Nominatim, Cloudflare R2/Pages, Fly.io or Railway |

## Slice order (Dev Plan)
0 Foundations · 1 Auth+roles · 2 Owner posts listing · 3 Seeker search · 4 Apply+inbox · 5 Chat ·
6 Match score · 7 Rooms+questionnaire · 8 People browse+mutual interest · 9 Landing+polish ·
10 Trust basics · 11 Admin minimal · 12 Launch readiness
