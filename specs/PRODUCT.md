# Standing product decisions (read before writing any spec)

Updated: 2026-11-11. Full reasoning in the Product Plan doc.

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
| Chat | Opens only on owner shortlist or mutual interest; never one-sided. Decided 2026-11-11 (Slice 5 batch): new messages are **pushed** to open pages (server-sent events over Redis pub/sub, one stream per tab, `0005c`; Gilad asked for the option that holds at a very large user count, the orchestrator chose SSE over polling and WebSockets); after an un-shortlist, decline or withdraw the thread stays readable by both and sending closes, a re-shortlist reopens it; no chat notifications in Slice 5 (header count only; unread messages join the pre-launch daily digest email); one conversation per application, with the application's id (Slice 8 generalises it before launch); "הצעת סיור" is a composer chip that inserts editable template text |
| Trust (MVP) | Phone/email-verified accounts, report button everywhere, rate limits, listing auto-expiry **3 months (90 days from creation)** (changed from 30 days, Gilad 2026-11-10), deposit-before-viewing warning in chat |
| Listings | Decided 2026-11-10 (0002a batch): a listing has the CreateListing/Listing artboards' facts, no photos until `0002c`; **no drafts** (live on publish, the wizard's preview is the review step); a room listing uses the apartment fields until Slice 7 and is hidden from search until then; arnona is entered as the bi-monthly bill, vaad monthly; the 3-listing cap counts **live** listings only (paused or expired free a slot; a total-rows cap per owner is a later follow-up) |
| Listing edit | Decided 2026-11-10 (0002e batch): owners edit a listing's fields from "my listings"; **an expired listing is not editable** (no edit link, the edit page refuses it) until Slice 10's renewal; unsaved edits are guarded on reload/close and the page's own back link; an edit may switch apartment/room |
| Applications | Decided 2026-11-10 (Slice 4 batch, all six accepted): no notifications in Slice 4 (owner sees a new-applicant badge, seeker sees the status; a daily digest email to owners is its own small spec before launch); re-apply allowed after withdrawing, never after a decline; the owner's identity is not shown to applicants until chat opens on shortlist (Slice 5); the application message is required, 1–500 characters; a declined seeker sees the true status in soft wording ("לא נבחרה"); a decline is final, behind a confirm dialog; `0004c` Q-A/Q-B (2026-11-10): a re-apply counts as new and lands on top of the owner's newest-first inbox; owners see applicant counts only, never a view count (views stay recorded for the applications-per-view log) |
| Search | Decided 2026-11-10 (0003a batch, all 7 accepted): search and the listing page are **public** (no login to browse; applying needs login in Slice 4); list first, the map is `0003c`; map tiles: **public OSM tiles while traffic is tiny, self-hosted Protomaps on R2 once R2 is approved**; default sort newest, plus price up/down, until Slice 6's match score; entry-date filter = "available by my move-in date", a flexible (±2 weeks) listing counts 14 days earlier; the public listing shows **no owner name** and the street **without a house number**; room listings stay hidden from search until Slice 7 while the wizard keeps offering "room" |
| Stack | React+TS+Vite+Tailwind, FastAPI, PostgreSQL+PostGIS, Redis, arq worker, MapLibre+OSM tiles, Nominatim, Cloudflare R2/Pages, Fly.io or Railway |

## Slice order (Dev Plan)
0 Foundations · 1 Auth+roles · 2 Owner posts listing · 3 Seeker search · 4 Apply+inbox · 5 Chat ·
6 Match score · 7 Rooms+questionnaire · 8 People browse+mutual interest · 9 Landing+polish ·
10 Trust basics · 11 Admin minimal · 12 Launch readiness
