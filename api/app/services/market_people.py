"""People browse in שוק השותפים (spec 0010h; PRODUCT.md "שוק השותפים", MARKET-PLAN.md decisions
4-7, Q13-Q15): a signed-in person pages through other people's cards and likes them; a mutual like
opens a **direct chat** (0010g), and either side can remove the match.

This module is the only writer of `person_pairs` and the only caller of `chat.open_direct` /
`chat.close_direct`; it never writes `conversations` itself. Its terms, each stated once here:

- The **viewer** (`_viewer`, one SELECT): the caller's `gender`, `flatmate_gender`,
  `people_visible` and `area_ids` (an outer join from `users` to `seeker_profiles`: NULL, `'any'`,
  false and `[]` without a row) and `has_live_room`, an EXISTS over `search._public_listings()` (the
  one visibility rule) of the caller's own rooms.
  - The **ticket** to browse and to list one's likes: one's own visible card (`people_visible`,
    which since 0010c implies both profile parts, so `gender` is set) or a live room
    (`CardRequiredError` without either).
  - Liking needs the **card** itself: a live room alone lets you browse but not like, since the
    other person could never see your card to like back (Q-B, Gilad 2026-11-13).
- A **candidate** of the viewer (`_candidate`, written once): a `seeker_profiles` row `P` joined to
  its `users` row that is visible (`people_visible`), not the viewer, fits the viewer both ways
  (`matching.fit.person_fit`), and has no **mutual** pair with the viewer (a match lives in
  `matches` and the chat). Hiding one's card hides one from browse, from other people's lists and
  from new likes at once; stored likes stay.
- A **pair** is one `person_pairs` row, ordered in SQL (`least` / `greatest`, as `open_direct`).
  Mutual = both likes set; the likes stay set while matched. Removing a match clears both, so the
  two reappear in each other's browse, and a new mutual like reopens the same chat with its history
  (Q-A, Gilad 2026-11-13). A one-sided like never reopens it.

Privacy (NF2): the card is read by column name (`_CARD_COLUMNS`), never the profile entity, so
`budget_max_ils` is never loaded; a person is their `card_id`, never their user id.

Concurrency: a like is one INSERT ... SELECT ... ON CONFLICT DO UPDATE that checks the target in
its own snapshot and takes the pair's row lock (an INSERT race resolves on the primary key), so of
two crossing likes the later one sees both timestamps and exactly one opens the chat. Every writer
locks the pair before the conversation (a like: the upsert, then `open_direct`; a removal: the pair
UPDATE, then `close_direct`), so a like and a removal never deadlock."""

import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import (
    ColumnElement,
    Row,
    Select,
    and_,
    case,
    exists,
    func,
    literal,
    null,
    or_,
    select,
    update,
)
from sqlalchemy.dialects.postgresql import ARRAY, UUID, insert
from sqlalchemy.orm import Session, aliased
from sqlalchemy.orm.util import AliasedClass

from app.matching.fit import person_fit
from app.models import Conversation, Listing, PersonPair, SeekerProfile, User
from app.redis_client import RedisClient
from app.schemas.people import PEOPLE_LIMIT
from app.services import chat as chat_service
from app.services import chat_events
from app.services import search as search_service
from app.services.people import count_like
from app.services.rate_limit import count_or_raise

# Per user, `GET /people` and the room side's `GET /listings/{id}/people` together, counted in
# pages: an infinite query refetches every loaded page, and the room side refetches after each like.
BROWSE_RATE_LIMIT_HOUR = 300
BROWSE_RATE_WINDOW_S = 3600
BROWSE_RATE_LIMIT_DAY = 1500
BROWSE_RATE_DAY_S = 86_400

# shortcut: each list capped at 100 rows (the like limit is 100 a day); page it with /me/likes
# (FOLLOWUPS:160)
LIKES_LIST_CAP = 100


class CardRequiredError(Exception):
    """The caller has no ticket (no visible card and no live room) to browse, or no visible card
    to like (`card_required`)."""


class MutualMatchError(Exception):
    """An unlike of a mutual pair: a match is removed with `DELETE /me/matches/{id}`
    (`mutual_match`)."""


class NotFoundError(Exception):
    """An unknown card, the caller's own, one that is not a candidate of the caller (hidden, a
    gender misfit, already a match); or an unknown direct chat, an application chat, or one the
    caller is not in (deliberately one case each)."""


@dataclass(frozen=True)
class Viewer:
    """The caller as the rules see them (`_viewer`)."""

    id: uuid.UUID
    gender: str | None
    flatmate_gender: str
    people_visible: bool
    area_ids: list[uuid.UUID]
    has_live_room: bool

    @property
    def ticket(self) -> bool:
        return self.people_visible or self.has_live_room


# The card's profile columns, by name (NF2): never the entity, so `budget_max_ils`, `household`,
# pets, smoker, contract, parking and `flatmate_gender` are never loaded.
_CARD_COLUMNS = (
    SeekerProfile.gender,
    SeekerProfile.birth_year,
    SeekerProfile.area_ids,
    SeekerProfile.move_in_date,
    SeekerProfile.move_in_flexible,
    SeekerProfile.lifestyle,
    SeekerProfile.about_me,
)

# The pair `_candidate` reads to exclude a match (its own alias, apart from any pair the statement
# joins).
_MATCHED = aliased(PersonPair, name="matched_pair")

_Pair = type[PersonPair] | AliasedClass[PersonPair]


def count_browse(r: RedisClient, user: User) -> None:
    """Count one browse page of `user` (`rl:browse:user:{id}`, `rl:browse:user:day:{id}`). Raises
    `RateLimitedError`."""
    count_or_raise(
        r,
        (
            (f"rl:browse:user:{user.id}", BROWSE_RATE_LIMIT_HOUR, BROWSE_RATE_WINDOW_S),
            (f"rl:browse:user:day:{user.id}", BROWSE_RATE_LIMIT_DAY, BROWSE_RATE_DAY_S),
        ),
    )


def _uuid(value: uuid.UUID) -> ColumnElement[uuid.UUID]:
    return literal(value, UUID(as_uuid=True))


def _ordered(pair: _Pair, a: uuid.UUID, b: Any) -> ColumnElement[bool]:
    """`pair` is the pair of person `a` (a value) and `b` (a column or subquery), ordered in SQL.
    The last clause is implied by the first two; it lets the planner narrow `person_pairs` to
    `a`'s own pairs by index (the primary key, `ix_person_pairs_user_high`) before it joins."""
    return and_(
        pair.user_low == func.least(_uuid(a), b),
        pair.user_high == func.greatest(_uuid(a), b),
        or_(pair.user_low == _uuid(a), pair.user_high == _uuid(a)),
    )


def _mutual(pair: _Pair) -> ColumnElement[bool]:
    return and_(pair.low_liked_at.is_not(None), pair.high_liked_at.is_not(None))


def _sides(me: uuid.UUID) -> tuple[ColumnElement[Any], ColumnElement[Any]]:
    """`me`'s and the other person's like on the statement's `PersonPair` (NULL without a row)."""
    i_am_low = PersonPair.user_low == _uuid(me)
    mine = case((i_am_low, PersonPair.low_liked_at), else_=PersonPair.high_liked_at)
    theirs = case((i_am_low, PersonPair.high_liked_at), else_=PersonPair.low_liked_at)
    return mine, theirs


def _viewer(db: Session, me: User) -> Viewer:
    """The caller's profile facts and whether they have a live room. One SELECT."""
    live_room = (
        search_service._public_listings()
        .where(Listing.owner_id == me.id, Listing.listing_type == "room")
        .exists()
    )
    row = db.execute(
        select(
            SeekerProfile.gender,
            SeekerProfile.flatmate_gender,
            SeekerProfile.people_visible,
            SeekerProfile.area_ids,
            live_room.label("has_live_room"),
        )
        .select_from(User)
        .outerjoin(SeekerProfile, SeekerProfile.user_id == User.id)
        .where(User.id == me.id)
    ).one()
    return Viewer(
        id=me.id,
        gender=row.gender,
        flatmate_gender=row.flatmate_gender or "any",
        people_visible=bool(row.people_visible),
        area_ids=list(row.area_ids or []),
        has_live_room=bool(row.has_live_room),
    )


def _candidate(viewer: Viewer) -> tuple[ColumnElement[bool], ...]:
    """The candidate's conditions on the statement's `SeekerProfile` (see the module docstring)."""
    return (
        SeekerProfile.people_visible.is_(True),
        SeekerProfile.user_id != viewer.id,
        person_fit(viewer.gender, viewer.flatmate_gender, SeekerProfile),
        ~exists().where(_ordered(_MATCHED, viewer.id, SeekerProfile.user_id), _mutual(_MATCHED)),
    )


def browse_statement(viewer: Viewer, offset: int) -> Select[Any]:
    """`browse`'s page statement (also EXPLAINed by the tests): one page of the viewer's
    candidates with `count(*) OVER ()` as `total`. Rows of `card_id`, `display_name`, `photo_key`,
    the card columns, `liked_by_me`, `liked_me` and `total`. Order: those who liked the viewer,
    then those sharing an area with the viewer, then the profile's `updated_at` desc, then
    `card_id`."""
    mine, theirs = _sides(viewer.id)
    areas = literal(viewer.area_ids, ARRAY(UUID(as_uuid=True)))
    return (
        select(
            User.card_id,
            User.display_name,
            User.photo_key,
            *_CARD_COLUMNS,
            mine.is_not(None).label("liked_by_me"),
            theirs.is_not(None).label("liked_me"),
            func.count().over().label("total"),
        )
        .select_from(SeekerProfile)
        .join(User, User.id == SeekerProfile.user_id)
        .outerjoin(PersonPair, _ordered(PersonPair, viewer.id, SeekerProfile.user_id))
        .where(*_candidate(viewer))
        .order_by(
            theirs.is_(None),
            SeekerProfile.area_ids.overlap(areas).is_(False),
            SeekerProfile.updated_at.desc(),
            User.card_id,
        )
        .limit(PEOPLE_LIMIT)
        .offset(offset)
    )


def browse(db: Session, r: RedisClient, me: User, offset: int) -> tuple[Sequence[Row[Any]], int]:
    """One page (`PEOPLE_LIMIT`) of `me`'s candidates and their total (`browse_statement`). The
    limiter counts first, so every authenticated attempt counts, a refused one included
    (`RateLimitedError`); then the viewer (`CardRequiredError` without a ticket), then the page:
    two statements after the session lookup. An empty page past the start (`offset > 0`) needs one
    more, the count. A read: no commit."""
    count_browse(r, me)
    viewer = _viewer(db, me)
    if not viewer.ticket:
        raise CardRequiredError
    statement = browse_statement(viewer, offset)
    rows = db.execute(statement).all()
    if rows:
        total = int(rows[0].total)
    elif offset == 0:
        total = 0
    else:
        unpaged = statement.limit(None).offset(None).order_by(None).subquery()
        total = int(db.execute(select(func.count()).select_from(unpaged)).scalar_one())
    return rows, total


def like(db: Session, r: RedisClient, me: User, card_id: uuid.UUID) -> uuid.UUID | None:
    """`me` likes the person with `card_id`. Returns the direct chat's id when the pair is mutual
    after this like (opened or reopened by `chat.open_direct`), else None. In order: the limiter
    (`RateLimitedError`; every later refusal has counted), the viewer (`CardRequiredError` without
    a visible card), then one INSERT ... SELECT ... ON CONFLICT DO UPDATE that checks the target is
    a candidate in its own snapshot and sets my side's like, keeping an earlier one
    (`NotFoundError` when it returns no row: unknown, own, hidden, a misfit, already a match).
    Mutual: `open_direct` in the same transaction. One commit, then a `status` event to both. Two
    statements, three when mutual."""
    conversation_id: uuid.UUID | None = None
    try:
        count_like(r, me)
        viewer = _viewer(db, me)
        if not viewer.people_visible:
            raise CardRequiredError
        me_ = _uuid(me.id)
        i_am_low = me_ < User.id
        target = (
            select(
                func.least(me_, User.id),
                func.greatest(me_, User.id),
                case((i_am_low, func.now()), else_=null()),
                case((i_am_low, null()), else_=func.now()),
            )
            .select_from(User)
            .join(SeekerProfile, SeekerProfile.user_id == User.id)
            .where(User.card_id == card_id, *_candidate(viewer))
        )
        stmt = insert(PersonPair).from_select(
            ["user_low", "user_high", "low_liked_at", "high_liked_at"], target
        )
        # My side: the earlier like, else now(); the other side: unchanged (its excluded is NULL).
        stmt = stmt.on_conflict_do_update(
            constraint="person_pairs_pkey",
            set_={
                "low_liked_at": func.coalesce(PersonPair.low_liked_at, stmt.excluded.low_liked_at),
                "high_liked_at": func.coalesce(
                    PersonPair.high_liked_at, stmt.excluded.high_liked_at
                ),
            },
        )
        other_id = case(
            (PersonPair.user_low == me_, PersonPair.user_high), else_=PersonPair.user_low
        )
        row = db.execute(
            stmt.returning(
                other_id.label("other_id"), PersonPair.low_liked_at, PersonPair.high_liked_at
            )
        ).one_or_none()
        if row is None:
            raise NotFoundError
        other: uuid.UUID = row.other_id
        if row.low_liked_at is not None and row.high_liked_at is not None:
            conversation_id = chat_service.open_direct(db, me.id, other)
        db.commit()
    except Exception:
        db.rollback()
        raise
    if conversation_id is not None:
        chat_events.publish(r, [me.id, other], conversation_id, "status")
    return conversation_id


def unlike(db: Session, me: User, card_id: uuid.UUID) -> None:
    """`me` withdraws their like of the person with `card_id`: one UPDATE clears my side where the
    pair exists and is not mutual. When it hit nothing, one EXISTS tells a mutual pair
    (`MutualMatchError`: remove the match instead) from no pair (a no-op, revealing nothing).
    Commits."""
    other = select(User.id).where(User.card_id == card_id).scalar_subquery()
    me_ = _uuid(me.id)
    try:
        hit = db.execute(
            update(PersonPair)
            .where(_ordered(PersonPair, me.id, other), ~_mutual(PersonPair))
            .values(
                low_liked_at=case(
                    (PersonPair.user_low == me_, null()), else_=PersonPair.low_liked_at
                ),
                high_liked_at=case(
                    (PersonPair.user_high == me_, null()), else_=PersonPair.high_liked_at
                ),
            )
            .returning(PersonPair.user_low)
            .execution_options(synchronize_session=False)
        ).first()
        if hit is None and db.scalar(
            select(exists().where(_ordered(PersonPair, me.id, other), _mutual(PersonPair)))
        ):
            raise MutualMatchError
        db.commit()
    except Exception:
        db.rollback()
        raise


def remove_match(db: Session, r: RedisClient, me: User, conversation_id: uuid.UUID) -> None:
    """`me` removes the match whose direct chat is `conversation_id` (Q14): both likes are
    cleared (only where both are set, so a repeated removal never wipes a newer one-sided like),
    and the chat closes (readable, sending closed). Idempotent. In order: one SELECT of the direct
    chat with `me` in it (`NotFoundError`), the pair UPDATE, then `chat.close_direct` (the pair is
    locked before the conversation, as in `like`); one commit, then a `status` event to both."""
    try:
        chat = db.execute(
            select(Conversation.owner_id, Conversation.seeker_id).where(
                Conversation.id == conversation_id,
                Conversation.application_id.is_(None),
                or_(Conversation.owner_id == me.id, Conversation.seeker_id == me.id),
            )
        ).one_or_none()
        if chat is None:
            raise NotFoundError
        # A direct chat stores its two people ordered, as the pair does.
        db.execute(
            update(PersonPair)
            .where(
                PersonPair.user_low == chat.owner_id,
                PersonPair.user_high == chat.seeker_id,
                _mutual(PersonPair),
            )
            .values(low_liked_at=None, high_liked_at=None)
            .execution_options(synchronize_session=False)
        )
        chat_service.close_direct(db, chat.owner_id, chat.seeker_id)
        db.commit()
    except Exception:
        db.rollback()
        raise
    chat_events.publish(r, [chat.owner_id, chat.seeker_id], conversation_id, "status")


def likes_statement(viewer: Viewer) -> Select[Any]:
    """`my_people_likes`' list statement (also EXPLAINed by the tests): the viewer's pairs from
    both sides (the primary key and `ix_person_pairs_user_high`), each as a `kind`:

    - `match`: both liked; the other's name and photo whatever their card's visibility now (the
      chat-member rule, decision 15), the direct chat's id (`uq_conversations_direct_pair`) and
      `at` = the later like;
    - `liked_me`: the other liked me and I did not, and they are a candidate now;
    - `mine`: I liked and they did not, and they are a candidate now.

    `at` is the like that put the row in its list. Rows of `kind`, `at`, `card_id`,
    `display_name`, `photo_key`, the card columns, `liked_by_me`, `liked_me` and
    `conversation_id`; at most `LIKES_LIST_CAP` per kind, newest first in each."""
    me_ = _uuid(viewer.id)
    mine, theirs = _sides(viewer.id)
    mutual = _mutual(PersonPair)
    kind = case((mutual, "match"), (theirs.is_not(None), "liked_me"), else_="mine")
    at = case(
        (mutual, func.greatest(PersonPair.low_liked_at, PersonPair.high_liked_at)),
        (theirs.is_not(None), theirs),
        else_=mine,
    )
    other_id = case((PersonPair.user_low == me_, PersonPair.user_high), else_=PersonPair.user_low)
    ranked = (
        select(
            kind.label("kind"),
            at.label("at"),
            User.card_id,
            User.display_name,
            User.photo_key,
            *_CARD_COLUMNS,
            mine.is_not(None).label("liked_by_me"),
            theirs.is_not(None).label("liked_me"),
            Conversation.id.label("conversation_id"),
            func.row_number()
            .over(partition_by=kind, order_by=(at.desc(), User.card_id))
            .label("rank"),
        )
        .select_from(PersonPair)
        .join(User, User.id == other_id)
        .outerjoin(SeekerProfile, SeekerProfile.user_id == User.id)
        .outerjoin(
            Conversation,
            and_(
                Conversation.owner_id == PersonPair.user_low,
                Conversation.seeker_id == PersonPair.user_high,
                Conversation.application_id.is_(None),
            ),
        )
        .where(
            or_(PersonPair.user_low == me_, PersonPair.user_high == me_),
            or_(
                mutual,
                and_(or_(mine.is_not(None), theirs.is_not(None)), *_candidate(viewer)),
            ),
        )
        .subquery("ranked")
    )
    return (
        select(ranked)
        .where(ranked.c.rank <= LIKES_LIST_CAP)
        .order_by(ranked.c.kind, ranked.c.at.desc(), ranked.c.card_id)
    )


def my_people_likes(db: Session, me: User) -> Sequence[Row[Any]]:
    """`me`'s people likes (`likes_statement`'s rows). The viewer (`CardRequiredError` without a
    ticket), then the list: two statements after the session lookup."""
    viewer = _viewer(db, me)
    if not viewer.ticket:
        raise CardRequiredError
    return db.execute(likes_statement(viewer)).all()
