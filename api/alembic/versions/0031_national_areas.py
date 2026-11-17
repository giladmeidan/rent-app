"""national areas (spec 0021a1)

`areas` becomes the national catalogue: every CBS settlement (`kind = 'settlement'`) and the
neighbourhoods of the big cities (`kind = 'neighbourhood'`, `parent_id` = their settlement), keyed
by `(kind, source_code)`, each with a `centre` and, for a neighbourhood, its `streets`. The rows
come from `make import-areas`; this migration inserts only the 19 settlements of the old launch
box, then moves every listing, application and profile off the old `gush-dan` row and deletes it:

1. a listing's `area_id` is the settlement its `city` text names (own name, then an alias) and its
   `city` that settlement's name; a listing no settlement matches goes to Tel Aviv-Yafo and expires
   now (it leaves search);
2. an application's `area_id_at_apply` follows its listing (the FK is RESTRICT);
3. a profile holding `gush-dan` holds the 19 settlements instead.

Everything below is a frozen copy (the 19 settlements as in `api/data/settlements.csv`, the aliases
and `normalise_place` of `services/rent_estimate.py`, `GUSH_DAN_WKT` of the old `scripts/seed.py`):
later specs change or delete the app's own copies.

Downgrade is **lossy** (dev data only, nothing is deployed): it re-inserts `gush-dan`, points every
listing, application and non-null profile at it, deletes every other `areas` row and drops the new
columns. Rewritten `city` texts and the listings expired by the upgrade stay as they are.

Revision ID: 0031
Revises: 0030
Create Date: 2026-11-17
"""

import unicodedata
from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from geoalchemy2 import Geometry
from sqlalchemy.dialects.postgresql import ARRAY, UUID

revision: str = "0031"
down_revision: str | None = "0030"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# (CBS code, name_he, ITM x, ITM y), as in settlements.csv on 2026-11-17.
_LAUNCH_SETTLEMENTS: tuple[tuple[int, str, int, int], ...] = (
    (5000, "תל אביב-יפו", 180263, 664864),
    (8600, "רמת גן", 183556, 664014),
    (6300, "גבעתיים", 182209, 664303),
    (6100, "בני ברק", 184558, 665992),
    (6600, "חולון", 179253, 658225),
    (6200, "בת ים", 176515, 658597),
    (7900, "פתח תקווה", 189423, 665794),
    (6400, "הרצלייה", 184417, 675211),
    (2650, "רמת השרון", 185199, 671833),
    (8300, "ראשון לציון", 181206, 652951),
    (2620, "קריית אונו", 186662, 663065),
    (2400, "אור יהודה", 186342, 659652),
    (681, "גבעת שמואל", 186020, 664898),
    (565, "אזור", 181947, 658994),
    (9400, "יהוד-מונוסון", 189413, 660044),
    (229, "גני תקווה", 188349, 663033),
    (587, "סביון", 188688, 661558),
    (9700, "הוד השרון", 190183, 673237),
    (466, "בית דגן", 184072, 656438),
)
_TEL_AVIV = 5000
_CITY_ALIASES: dict[str, int] = {
    "תל אביב": 5000,
    "תא": 5000,
    "יפו": 5000,
    "הרצליה": 6400,
    "פתח תקוה": 7900,
    "פת": 7900,
    "ראשלצ": 8300,
    "ראשון": 8300,
    "קרית אונו": 2620,
    "יהוד": 9400,
    "מונוסון": 9400,
    "גני תקוה": 229,
    "רג": 8600,
}
_PLACE_CHARS = str.maketrans({c: None for c in "\"'`׳״"} | {c: " " for c in "-–־"})
GUSH_DAN_WKT = "MULTIPOLYGON(((34.74 31.95, 34.95 31.95, 34.95 32.17, 34.74 32.17, 34.74 31.95)))"


def _normalise_place(text: str) -> str:
    return " ".join(unicodedata.normalize("NFC", text).translate(_PLACE_CHARS).split())


def _settlement_code(city: str) -> int | None:
    wanted = _normalise_place(city)
    for code, name, _x, _y in _LAUNCH_SETTLEMENTS:
        if _normalise_place(name) == wanted:
            return code
    return _CITY_ALIASES.get(wanted)


def upgrade() -> None:
    op.add_column("areas", sa.Column("kind", sa.Text(), nullable=True))
    op.add_column(
        "areas",
        sa.Column(
            "parent_id",
            UUID(as_uuid=True),
            sa.ForeignKey("areas.id", ondelete="RESTRICT", name="fk_areas_parent_id"),
            nullable=True,
        ),
    )
    op.add_column("areas", sa.Column("source_code", sa.Integer(), nullable=True))
    op.add_column(
        "areas",
        sa.Column(
            "centre",
            Geometry(geometry_type="POINT", srid=4326, spatial_index=False),
            nullable=True,
        ),
    )
    op.add_column(
        "areas",
        sa.Column("streets", ARRAY(sa.Text()), nullable=False, server_default=sa.text("'{}'")),
    )
    conn = op.get_bind()
    ids: dict[int, object] = {}
    for code, name, x, y in _LAUNCH_SETTLEMENTS:
        ids[code] = conn.execute(
            sa.text(
                "WITH c AS (SELECT ST_Transform(ST_SetSRID(ST_MakePoint(:x, :y), 2039), 4326) AS p)"
                " INSERT INTO areas (slug, name_he, kind, source_code, centre, geom)"
                " SELECT :slug, :name, 'settlement', :code, p, ST_Multi(ST_Expand(p, 0.1)) FROM c"
                " RETURNING id"
            ),
            {"x": x, "y": y, "slug": f"s-{code}", "name": name, "code": code},
        ).scalar_one()
    names = {code: name for code, name, _x, _y in _LAUNCH_SETTLEMENTS}
    old = "SELECT id FROM areas WHERE kind IS NULL"  # `gush-dan`

    cities = conn.execute(
        sa.text(f"SELECT DISTINCT city FROM listings WHERE area_id IN ({old})")
    ).scalars()
    for city in list(cities):
        match = _settlement_code(city)
        conn.execute(
            sa.text(
                "UPDATE listings SET area_id = :area, city = :name"
                + ("" if match else ", expires_at = now()")
                + f" WHERE city = :city AND area_id IN ({old})"
            ),
            {"area": ids[match or _TEL_AVIV], "name": names[match or _TEL_AVIV], "city": city},
        )
    conn.execute(
        sa.text(
            "UPDATE applications a SET area_id_at_apply = l.area_id FROM listings l"
            f" WHERE l.id = a.listing_id AND a.area_id_at_apply IN ({old})"
        )
    )
    conn.execute(
        sa.text(f"UPDATE seeker_profiles SET area_ids = :ids WHERE area_ids && ARRAY({old})"),
        {"ids": list(ids.values())},
    )
    conn.execute(sa.text("DELETE FROM areas WHERE kind IS NULL"))

    for column in ("kind", "source_code", "centre"):
        op.alter_column("areas", column, nullable=False)
    op.create_check_constraint("ck_areas_kind", "areas", "kind IN ('settlement', 'neighbourhood')")
    op.create_check_constraint(
        "ck_areas_parent", "areas", "(parent_id IS NULL) = (kind = 'settlement')"
    )
    op.create_unique_constraint("uq_areas_kind_source", "areas", ["kind", "source_code"])
    op.create_index("ix_areas_parent_id", "areas", ["parent_id"])


def downgrade() -> None:
    conn = op.get_bind()
    gush_dan = conn.execute(
        sa.text(
            "INSERT INTO areas (slug, name_he, geom, kind, source_code, centre)"
            " VALUES ('gush-dan', 'גוש דן', ST_GeomFromText(:wkt, 4326), 'settlement', 0,"
            " ST_Centroid(ST_GeomFromText(:wkt, 4326))) RETURNING id"
        ),
        {"wkt": GUSH_DAN_WKT},
    ).scalar_one()
    conn.execute(sa.text("UPDATE listings SET area_id = :gd"), {"gd": gush_dan})
    conn.execute(sa.text("UPDATE applications SET area_id_at_apply = :gd"), {"gd": gush_dan})
    conn.execute(
        sa.text("UPDATE seeker_profiles SET area_ids = ARRAY[:gd] WHERE area_ids IS NOT NULL"),
        {"gd": gush_dan},
    )
    # Neighbourhoods first: `parent_id` is RESTRICT.
    conn.execute(sa.text("DELETE FROM areas WHERE kind = 'neighbourhood'"))
    conn.execute(sa.text("DELETE FROM areas WHERE id <> :gd"), {"gd": gush_dan})

    op.drop_index("ix_areas_parent_id", table_name="areas")
    op.drop_constraint("uq_areas_kind_source", "areas", type_="unique")
    op.drop_constraint("ck_areas_parent", "areas", type_="check")
    op.drop_constraint("ck_areas_kind", "areas", type_="check")
    for column in ("streets", "centre", "source_code", "parent_id", "kind"):
        op.drop_column("areas", column)
