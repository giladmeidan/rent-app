SELECT 'by_side' AS summary, side, NULL AS kind, NULL AS city, NULL AS available, COUNT(*) AS signups, NULL AS units, NULL AS source, NULL AS campaign, NULL AS code
FROM signups GROUP BY side
UNION ALL
SELECT 'seeker_kind_city', NULL, kind, city, NULL, COUNT(*), NULL, NULL, NULL, NULL
FROM signups WHERE side = 'seeker' GROUP BY kind, city
UNION ALL
SELECT 'lister_kind_city', NULL, kind, city, NULL, COUNT(*), SUM(CASE units WHEN '3+' THEN 3 ELSE CAST(units AS INTEGER) END), NULL, NULL, NULL
FROM signups WHERE side = 'lister' GROUP BY kind, city
UNION ALL
SELECT 'lister_available', NULL, NULL, NULL, available, COUNT(*), NULL, NULL, NULL, NULL
FROM signups WHERE side = 'lister' GROUP BY available
UNION ALL
SELECT 'lister_phone', NULL, NULL, NULL, NULL, COUNT(*), NULL, NULL, NULL, NULL
FROM signups WHERE side = 'lister' AND phone IS NOT NULL
UNION ALL
SELECT 'by_source', side, NULL, NULL, NULL, COUNT(*), NULL, COALESCE(source, 'direct'), COALESCE(campaign, '-'), NULL
FROM signups GROUP BY side, COALESCE(source, 'direct'), COALESCE(campaign, '-')
UNION ALL
SELECT 'referrals', NULL, NULL, NULL, NULL, COUNT(*), NULL, NULL, NULL, NULL
FROM signups WHERE referred_by IS NOT NULL
UNION ALL
SELECT 'top_referrers', NULL, NULL, NULL, NULL, n, NULL, NULL, NULL, code
FROM (SELECT referred_by AS code, COUNT(*) AS n FROM signups WHERE referred_by IS NOT NULL GROUP BY referred_by HAVING COUNT(*) >= 3 ORDER BY n DESC, code LIMIT 20)
ORDER BY 1, 2, 3, 4, 5, 6 DESC, 8, 9, 10
