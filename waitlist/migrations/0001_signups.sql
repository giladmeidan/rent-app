-- The waitlist (spec 0017). D1 has no down-migration: before launch, roll back with DROP TABLE signups.
CREATE TABLE signups (
  id            INTEGER PRIMARY KEY,
  side          TEXT NOT NULL CHECK (side IN ('seeker', 'lister')),
  email         TEXT NOT NULL CHECK (length(email) BETWEEN 3 AND 254),   -- trimmed, lower-cased
  kind          TEXT NOT NULL CHECK (kind IN ('apartment', 'room')),
  city          TEXT NOT NULL,                                          -- a key from cities.js
  neighbourhood TEXT CHECK (neighbourhood IS NULL OR length(neighbourhood) <= 60),  -- lister only
  units         TEXT CHECK (units IN ('1', '2', '3+')),                 -- lister only, required for listers
  available     TEXT CHECK (available IN ('now', '1-3m', 'later')),     -- lister only, required for listers
  phone         TEXT CHECK (phone IS NULL OR phone GLOB '05[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]'),  -- lister only, optional
  consent       INTEGER NOT NULL CHECK (consent = 1),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (side, email),
  CHECK (side = 'lister' OR (neighbourhood IS NULL AND units IS NULL AND available IS NULL AND phone IS NULL)),
  CHECK (side = 'seeker' OR (units IS NOT NULL AND available IS NOT NULL))
);
