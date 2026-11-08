# Standing product decisions (read before writing any spec)

Updated: 2026-11-08. Full reasoning in the Product Plan doc.

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
| OTP | Email OTP in Slice 1; SMS adapter stubbed behind an interface; switched on at launch readiness |
| Matching | Hard filters (budget overlap, move-in window ±4 weeks, shared area, deal-breakers) then weighted distance score, 0–100, with top-3 agreeing / top-1 differing explanation |
| Chat | Opens only on owner shortlist or mutual interest; never one-sided |
| Trust (MVP) | Phone/email-verified accounts, report button everywhere, rate limits, listing auto-expiry 30 days, deposit-before-viewing warning in chat |
| Stack | React+TS+Vite+Tailwind, FastAPI, PostgreSQL+PostGIS, Redis, arq worker, MapLibre+OSM tiles, Nominatim, Cloudflare R2/Pages, Fly.io or Railway |

## Slice order (Dev Plan)
0 Foundations · 1 Auth+roles · 2 Owner posts listing · 3 Seeker search · 4 Apply+inbox · 5 Chat ·
6 Match score · 7 Rooms+questionnaire · 8 People browse+mutual interest · 9 Landing+polish ·
10 Trust basics · 11 Admin minimal · 12 Launch readiness
