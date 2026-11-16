SELECT 'by_side' AS summary, side, NULL AS kind, NULL AS city, NULL AS available, COUNT(*) AS signups, NULL AS units
FROM signups GROUP BY side
UNION ALL
SELECT 'seeker_kind_city', NULL, kind, city, NULL, COUNT(*), NULL
FROM signups WHERE side = 'seeker' GROUP BY kind, city
UNION ALL
SELECT 'lister_kind_city', NULL, kind, city, NULL, COUNT(*), SUM(CASE units WHEN '3+' THEN 3 ELSE CAST(units AS INTEGER) END)
FROM signups WHERE side = 'lister' GROUP BY kind, city
UNION ALL
SELECT 'lister_available', NULL, NULL, NULL, available, COUNT(*), NULL
FROM signups WHERE side = 'lister' GROUP BY available
UNION ALL
SELECT 'lister_phone', NULL, NULL, NULL, NULL, COUNT(*), NULL
FROM signups WHERE side = 'lister' AND phone IS NOT NULL
ORDER BY 1, 2, 3, 4, 5
