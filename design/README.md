# Design sources

`screens-v1/` holds the source of the Claude Design canvas "Rent App — Core Screens v1"
(https://claude.ai/artifact/Dk6VVCivwnLLwU3P8Ncf6f). Each `*.dc.html` is one artboard:
self-contained HTML/CSS with Heebo, RTL, and the teal accent as a tweakable variable.

| File | Artboard | Screen # in Product Plan |
| --- | --- | --- |
| Main.dc.html | 01 דף נחיתה (mobile) | 1 Landing |
| Search.dc.html | 02 חיפוש (mobile) | 5 Search |
| SearchDesktop.dc.html | 02 חיפוש — דסקטופ | 5 Search |
| Listing.dc.html | 03 עמוד דירה (mobile) | 6 Listing page |
| CreateListing.dc.html | 04 יצירת מודעה שלב 2/5 (mobile) | 8 Create / edit listing |
| Inbox.dc.html | 05 מועמדויות — בעל הדירה (mobile) | 9 Applicant inbox |
| InboxDesktop.dc.html | 05 מועמדויות — דסקטופ | 9 Applicant inbox |

How agents use this: a spec's UI section references the artboard file; the coder reads it for
structure, spacing, copy and component anatomy (not pixel-perfect); the UX reviewer compares
the built screen against it. Tokens to lift into Tailwind config: background #F7F5F2, ink #1C1917,
accent #0E7C6B (tint #E6F4F1, text #0B5F52), amber for "differs"/"new" #FEF3C7 / #92400E,
radii 12–20px, font Heebo 400–800.

When the canvas changes, re-export the artboards here and bump the folder (screens-v2/).
