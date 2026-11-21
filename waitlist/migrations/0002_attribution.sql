-- Sources and referrals (spec 0017d). Additive: rows from before it keep NULL in the four new columns.
-- source/campaign: the channel from utm_source/utm_campaign, trimmed and lower-cased (first touch wins).
-- ref_code: the row's own random 8-character referral code. referred_by: the code of the row that invited it.
-- D1 has no down-migration. Manual rollback: DROP INDEX signups_referred_by; DROP INDEX signups_ref_code;
-- then recreate signups without the four columns (CREATE TABLE as in 0001 under a new name, INSERT … SELECT
-- the 0001 columns, DROP TABLE signups, rename the new table). Before launch, DROP TABLE signups and running
-- 0001 again is acceptable, as 0001 says.
ALTER TABLE signups ADD COLUMN source TEXT CHECK (source IS NULL OR (length(source) BETWEEN 1 AND 40));
ALTER TABLE signups ADD COLUMN campaign TEXT CHECK (campaign IS NULL OR (length(campaign) BETWEEN 1 AND 60));
ALTER TABLE signups ADD COLUMN ref_code TEXT CHECK (ref_code IS NULL OR length(ref_code) = 8);
ALTER TABLE signups ADD COLUMN referred_by TEXT CHECK (referred_by IS NULL OR length(referred_by) = 8);
CREATE UNIQUE INDEX signups_ref_code ON signups (ref_code) WHERE ref_code IS NOT NULL;
CREATE INDEX signups_referred_by ON signups (referred_by) WHERE referred_by IS NOT NULL;
