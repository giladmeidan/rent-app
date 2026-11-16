"""Chat (spec 0005a; members from 0008d; direct chats from 0010g): the conversation an owner opens
by shortlisting an applicant (`services/applications.set_applicant_status`) or a mutual like opens
(`services/people.py`), and the **direct chat** a mutual person-to-person like opens (`open_direct`,
called by 0010h), listed, read and written by its members.

Rules (PRODUCT.md "Chat", "Flatmates", "שוק השותפים"):
- A conversation has its own `id`. One conversation per application, ever; an application chat's
  id is the application's id (`ck_conversations_application_id`). A **direct chat** has no
  application (and no listing): its two people sit in `owner_id` / `seeker_id` (the lower and the
  higher id), both with the role `person`, one chat per pair, ever (`open_direct`), and it never
  gains flatmates. `Application` and `Listing` are outer-joined for it. Its **members** are its
  `owner_id`, its `seeker_id` and, on a **room** application (`listing_type_at_apply = 'room'`,
  the 0007b snapshot), the listing's flatmates (`listing_flatmates`, spec 0008d). An apartment
  application never gains flatmates, even after its listing is switched to a room. Membership is
  one LEFT JOIN onto the caller's own `listing_flatmates` row (unique on (listing, user), so rows
  never multiply) and the condition `owner_id = me OR seeker_id = me OR F.id IS NOT NULL`, in the
  WHERE of **every** statement, so an unknown id, an application never shortlisted and a
  conversation the caller is not in are one case (`ConversationNotFoundError`, a 404), on a read
  and on a send alike. The list also ANDs in the same rule restated on `conversations`' own
  indexed columns (`_indexed_member`), so it never scans the whole table.
- The caller's role (`my_role`) resolves in order: `person` in a direct chat, then owner, then
  seeker, then flatmate, so a withdrawn seeker who later joined the flat (or a join racing an
  apply) is never both. Read markers and `is_me` go by id, never by role.
- A flatmate sees the messages sent from their `joined_at` on (`visible_from`; `-infinity` for the
  owner and the seeker), in the thread, the list's newest message and the unread count. A removed
  or departed flatmate loses access at once; a re-join restarts from the new `joined_at`.
- Sending is open to every member exactly while the application is `shortlisted` (a direct chat:
  while it is not closed, `close_direct`, Q14); after an un-shortlist, decline or withdraw (or a
  removed match) the thread stays readable and sending is `ChatClosedError` (Q2). The status is
  checked in the `INSERT ... SELECT`'s own snapshot, without a lock: a decline
  committing at the same instant can let one message land after it (harmless, by design).
- Each member has their own read marker: the owner's and the seeker's are `owner_read_at` /
  `seeker_read_at`, a flatmate's is their `conversation_reads` row. Unread = the other members'
  visible messages newer than my marker; `is_new` = I have no marker. Reading a thread moves my
  marker to `now()` only when something is new, so a poll with nothing new writes nothing (NF3).
- Sending is rate limited per user (`CHAT_RATE_LIMIT_MINUTE`, `CHAT_RATE_LIMIT_DAY`); every
  authenticated, body-valid attempt counts, a refused one does not (as `apply`).
- Members are known by `users.display_name` only (NF2): no query loads the `User`. A deleted
  account's name is NULL (spec 0013c): its messages stay, and sending closes when it is the owner or
  the seeker (`_can_send`); a deleted flatmate already left the flat.
- Events (spec 0005c) go to every member: a send returns the member ids from its own UPDATE (no
  extra statement); a status change of a room application reads them with `member_ids` (one
  SELECT), of an apartment application they are the owner and the seeker the router already holds
  (`event_members`)."""

import datetime as dt
import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any, Literal

from sqlalchemy import (
    DateTime,
    Row,
    Select,
    Text,
    and_,
    any_,
    case,
    exists,
    func,
    literal,
    literal_column,
    or_,
    select,
    true,
    update,
)
from sqlalchemy.dialects.postgresql import UUID, insert
from sqlalchemy.orm import Session, aliased

from app.models import (
    Application,
    Conversation,
    ConversationRead,
    Listing,
    ListingFlatmate,
    Message,
    User,
)
from app.redis_client import RedisClient
from app.services import tours
from app.services.rate_limit import count_or_raise

CHAT_RATE_LIMIT_MINUTE = 20
CHAT_RATE_MINUTE_S = 60
CHAT_RATE_LIMIT_DAY = 300
CHAT_RATE_DAY_S = 86_400

THREAD_LIMIT = 200
PREVIEW_LENGTH = 120

Role = Literal["owner", "seeker", "flatmate", "person"]

# The listing summary (`ApplicationListingOut`) as `listing_*` columns.
_LISTING_COLUMNS = (
    Listing.id.label("listing_id"),
    Listing.listing_type.label("listing_type"),
    Listing.city.label("listing_city"),
    Listing.street.label("listing_street"),
    Listing.rooms.label("listing_rooms"),
    Listing.price_ils.label("listing_price_ils"),
)

_NEG_INFINITY = literal_column("'-infinity'::timestamptz", DateTime(timezone=True))

# The caller's own membership row of the conversation's listing (`_flatmate_join`), and their own
# flatmate read marker (`_read_join`).
_F = aliased(ListingFlatmate, name="my_flatmate")
_R = aliased(ConversationRead, name="my_read")


class ConversationNotFoundError(Exception):
    """Unknown id, an application never shortlisted, or a conversation (an application chat or a
    direct chat) the caller is not in (deliberately one case)."""


class ChatClosedError(Exception):
    """The caller is a member, but the application is not `shortlisted` (a direct chat: it is
    closed, the match was removed)."""


@dataclass(frozen=True)
class Member:
    """One member of a thread, as `ThreadOut.members` lists them."""

    name: str | None  # None = a deleted account (spec 0013c)
    photo_key: str | None  # their person photo's key (spec 0010j)
    role: Role
    is_me: bool


@dataclass(frozen=True)
class Thread:
    """`get_thread`'s result: the header row (`listing_*`, null for a direct chat; `other_name`,
    `can_send`, `my_role`, `visible_from`), the members (owner, flatmates by `joined_at`, seeker;
    a direct chat's are its two people, `owner_id` then `seeker_id`, both role `person`) and the
    newest `THREAD_LIMIT` visible messages oldest first (rows of `id`, `body`, `tour_change`,
    `tour_starts_at`, `mine`, `sender_name`, `created_at`) and, for the owner and the seeker of an
    application chat, its current tour (`tours.current_tour`, spec 0018a)."""

    header: Row[Any]
    members: list[Member]
    messages: Sequence[Row[Any]]
    truncated: bool
    tour: Row[Any] | None  # the application's current tour for its owner and seeker (0018a)


def _is_room() -> Any:
    return Application.listing_type_at_apply == "room"


def _flatmate_join(me: User) -> Any:
    """The LEFT JOIN condition onto `me`'s own `listing_flatmates` row (`_F`) of the conversation's
    listing, only on a room application (never on a direct chat). The statement must join
    `Application`."""
    return and_(
        Conversation.application_id.is_not(None),
        _F.listing_id == Application.listing_id,
        _F.user_id == me.id,
        _is_room(),
    )


def _read_join(me: User) -> Any:
    """The LEFT JOIN condition onto `me`'s own flatmate read marker (`_R`)."""
    return and_(_R.conversation_id == Conversation.id, _R.user_id == me.id)


def _is_member(me: User) -> Any:
    """The membership condition, exact: the owner, the seeker, or a flatmate through `_F` (the
    statement outer-joins `_F`, which also gives the role and `joined_at`). An OR over an
    outer-joined row cannot drive an index, so a statement over many conversations also ANDs in
    `_indexed_member` (`list_conversations`); a statement pinned to one id by its primary key
    needs only this."""
    return or_(
        Conversation.owner_id == me.id,
        Conversation.seeker_id == me.id,
        _F.id.is_not(None),
    )


def _indexed_member(me: User) -> Any:
    """`_is_member` restated on `conversations`' own indexed columns, so the planner can BitmapOr
    `ix_conversations_owner_id`, `ix_conversations_seeker_id` and
    `uq_conversations_application_id`: the owner, the seeker, or a conversation whose application
    is among the room applications of `me`'s flats (an uncorrelated `array(SELECT ...)`,
    `ix_listing_flatmates_user_id` -> `applications(listing_id)`, run once). A direct chat never
    matches the third arm (no application); its two people match through `owner_id` /
    `seeker_id`. It may only narrow: `_is_member` stays the exact rule."""
    # shortcut: a flatmate of many busy rooms gets one long id array (the room applications of
    # every flat, chat or not); fine at MVP volume (perf review: 13.6 ms for a flatmate of 40
    # rooms at 21k conversations). If it grows, restrict the array to applications that have a
    # conversation.
    flat_applications = (
        select(Application.id)
        .join(ListingFlatmate, ListingFlatmate.listing_id == Application.listing_id)
        .where(ListingFlatmate.user_id == me.id, Application.listing_type_at_apply == "room")
        .correlate(None)  # its own `applications`, not the outer statement's
        .scalar_subquery()
    )
    return or_(
        Conversation.owner_id == me.id,
        Conversation.seeker_id == me.id,
        Conversation.application_id == any_(func.array(flat_applications)),
    )


def _my_role(me: User) -> Any:
    return case(
        (Conversation.application_id.is_(None), literal("person")),
        (Conversation.owner_id == me.id, literal("owner")),
        (Conversation.seeker_id == me.id, literal("seeker")),
        else_=literal("flatmate"),
    )


def _can_send() -> Any:
    """Sending is open: an application chat while its application is `shortlisted`, a direct chat
    while it is not closed, and in both only while neither the owner nor the seeker deleted their
    account (spec 0013c; a `NOT EXISTS` over an anonymous alias reading `ix_users_deleted`, so it
    adds no statement and never correlates with a `users` the statement joins). The statement must
    outer-join `Application`."""
    deleted = aliased(User)
    return and_(
        case(
            (Conversation.application_id.is_(None), Conversation.closed_at.is_(None)),
            else_=Application.status == "shortlisted",
        ),
        ~exists().where(
            deleted.id.in_([Conversation.owner_id, Conversation.seeker_id]),
            deleted.deleted_at.is_not(None),
        ),
    )


def _is_party(me: User) -> Any:
    """`me` is the conversation's owner or seeker (not only a flatmate)."""
    return or_(Conversation.owner_id == me.id, Conversation.seeker_id == me.id)


def _tour_line_visible(me: User) -> Any:
    """A tour line (spec 0018a) is seen by the owner and the seeker only, never a flatmate."""
    return or_(Message.tour_change.is_(None), _is_party(me))


def _visible_from(me: User) -> Any:
    """Where `me`'s view of the conversation begins: a flatmate's `joined_at`, else `-infinity`."""
    return case((_is_party(me), _NEG_INFINITY), else_=_F.joined_at)


def _my_read_at(me: User) -> Any:
    return case(
        (Conversation.owner_id == me.id, Conversation.owner_read_at),
        (Conversation.seeker_id == me.id, Conversation.seeker_read_at),
        else_=_R.read_at,
    )


def _is_other(me: User) -> Any:
    """The join condition onto `users` for the name the caller sees as `other_name` (select
    `display_name` and `photo_key` only): the owner's for the seeker, the seeker's for the owner
    and a flatmate."""
    return User.id == case(
        (Conversation.seeker_id == me.id, Conversation.owner_id), else_=Conversation.seeker_id
    )


def _flatmate_ids() -> Any:
    """The conversation's flatmates' user ids, a correlated `array_agg` (NULL when none): the
    listing's memberships on a room application, without the seeker's own (a withdrawn seeker who
    joined is the seeker there). Correlates on `Conversation`."""
    flatmate = aliased(ListingFlatmate)
    application = aliased(Application)
    return (
        select(func.array_agg(flatmate.user_id))
        .select_from(flatmate)
        .join(application, application.listing_id == flatmate.listing_id)
        .where(
            application.id == Conversation.application_id,
            application.listing_type_at_apply == "room",
            flatmate.user_id != Conversation.seeker_id,
        )
        .correlate(Conversation)
        .scalar_subquery()
    )


def list_conversations(db: Session, me: User) -> Sequence[Row[Any]]:
    """Every conversation `me` is a member of (any role, any application status), latest activity
    first (`coalesce(last_message_at, created_at)` desc, then id). One statement
    (`list_statement`): the listing summary, `other_name`, `my_role`, `member_count`, `can_send`,
    `is_new`, the newest visible message (`last_*`, null when none; its body cut to
    `PREVIEW_LENGTH`) and the unread count."""
    return db.execute(list_statement(me)).all()


def list_statement(me: User) -> Select[Any]:
    """`list_conversations`' one statement (also EXPLAINed by the tests)."""
    my_read_at = _my_read_at(me)
    visible_from = _visible_from(me)
    newest = (
        select(
            func.left(Message.body, PREVIEW_LENGTH).label("body"),
            Message.tour_change.label("tour_change"),
            Message.tour_starts_at.label("tour_starts_at"),
            (Message.sender_id == me.id).label("mine"),
            Message.created_at.label("created_at"),
        )
        .where(
            Message.conversation_id == Conversation.id,
            Message.created_at >= visible_from,
            _tour_line_visible(me),
        )
        .order_by(Message.created_at.desc(), Message.id.desc())
        .limit(1)
        .lateral("newest")
    )
    # A null marker counts every visible message: `-infinity` keeps the index range scan.
    since = func.greatest(func.coalesce(my_read_at, _NEG_INFINITY), visible_from)
    unread = (
        select(func.count())
        .select_from(Message)
        .where(
            Message.conversation_id == Conversation.id,
            Message.created_at > since,
            Message.created_at >= visible_from,
            Message.sender_id != me.id,
            _tour_line_visible(me),
        )
        .correlate_except(Message)
        .scalar_subquery()
    )
    flatmate = aliased(ListingFlatmate)
    flatmates = (
        select(func.count())
        .select_from(flatmate)
        .where(
            flatmate.listing_id == Application.listing_id,
            flatmate.user_id != Conversation.seeker_id,
        )
        .correlate_except(flatmate)
        .scalar_subquery()
    )
    member_count = literal(2) + case((_is_room(), flatmates), else_=literal(0))
    return (
        select(
            Conversation.id.label("id"),
            Conversation.created_at.label("created_at"),
            *_LISTING_COLUMNS,
            User.display_name.label("other_name"),
            User.photo_key.label("other_photo_key"),
            _my_role(me).label("my_role"),
            member_count.label("member_count"),
            _can_send().label("can_send"),
            my_read_at.is_(None).label("is_new"),
            unread.label("unread_count"),
            newest.c.body.label("last_body"),
            newest.c.tour_change.label("last_tour_change"),
            newest.c.tour_starts_at.label("last_tour_starts_at"),
            newest.c.mine.label("last_mine"),
            newest.c.created_at.label("last_created_at"),
        )
        .select_from(Conversation)
        .outerjoin(Application, Application.id == Conversation.application_id)
        .outerjoin(Listing, Listing.id == Application.listing_id)
        .outerjoin(_F, _flatmate_join(me))
        .outerjoin(_R, _read_join(me))
        .join(User, _is_other(me))
        .outerjoin(newest, true())
        .where(_indexed_member(me), _is_member(me))
        .order_by(
            func.coalesce(Conversation.last_message_at, Conversation.created_at).desc(),
            Conversation.id,
        )
    )


def other_member(db: Session, me: User, conversation_id: uuid.UUID) -> uuid.UUID | None:
    """The user id of `me`'s other side in conversation `conversation_id` (`_is_other`: the owner
    for the seeker, the seeker for the owner and a flatmate, the other person in a direct chat)
    when `me` is a member (`get_thread`'s rule, any application status, a closed direct chat
    too), else None. One SELECT. A report's lookup (spec 0011b)."""
    return db.scalar(
        select(User.id)
        .select_from(Conversation)
        .outerjoin(Application, Application.id == Conversation.application_id)
        .outerjoin(_F, _flatmate_join(me))
        .join(User, _is_other(me))
        .where(Conversation.id == conversation_id, _is_member(me))
    )


def get_thread(db: Session, me: User, conversation_id: uuid.UUID) -> Thread:
    """One of `me`'s conversations with its members and its newest `THREAD_LIMIT` visible messages
    (any application status), marking it read for `me`. Raises `ConversationNotFoundError`. Two
    statements (the header with the owner's and the seeker's names, then the messages), plus the
    flatmates SELECT on a room application, plus the current tour's SELECT for the owner and the
    seeker of an application chat (spec 0018a), plus one write (the owner's or seeker's UPDATE, a
    flatmate's upsert) and a commit only when `me`'s read marker is null or older than the newest
    message (a poll with nothing new writes nothing, NF3)."""
    owner = aliased(User, name="owner_user")
    seeker = aliased(User, name="seeker_user")
    try:
        header = db.execute(
            select(
                *_LISTING_COLUMNS,
                case(
                    (Conversation.seeker_id == me.id, owner.display_name),
                    else_=seeker.display_name,
                ).label("other_name"),
                case(
                    (Conversation.seeker_id == me.id, owner.photo_key),
                    else_=seeker.photo_key,
                ).label("other_photo_key"),
                owner.display_name.label("owner_name"),
                owner.photo_key.label("owner_photo_key"),
                seeker.display_name.label("seeker_name"),
                seeker.photo_key.label("seeker_photo_key"),
                _can_send().label("can_send"),
                Application.listing_id.label("application_listing_id"),
                _is_room().label("is_room"),
                Conversation.seeker_id.label("seeker_id"),
                _my_role(me).label("my_role"),
                case((_is_party(me), None), else_=_F.joined_at).label("visible_from"),
                _my_read_at(me).label("my_read_at"),
                Conversation.last_message_at.label("last_message_at"),
            )
            .select_from(Conversation)
            .outerjoin(Application, Application.id == Conversation.application_id)
            .outerjoin(Listing, Listing.id == Application.listing_id)
            .outerjoin(_F, _flatmate_join(me))
            .outerjoin(_R, _read_join(me))
            .join(owner, owner.id == Conversation.owner_id)
            .join(seeker, seeker.id == Conversation.seeker_id)
            .where(Conversation.id == conversation_id, _is_member(me))
        ).one_or_none()
        if header is None:
            raise ConversationNotFoundError
        visible_from: dt.datetime | None = header.visible_from
        # shortcut: no paging, the 200 newest only; add a before-cursor when a thread passes ~200
        # messages
        sender = aliased(User, name="sender")
        messages_query = (
            select(
                Message.id,
                Message.body,
                Message.tour_change,
                Message.tour_starts_at,
                (Message.sender_id == me.id).label("mine"),
                sender.display_name.label("sender_name"),
                Message.created_at,
            )
            .join(sender, sender.id == Message.sender_id)
            .where(Message.conversation_id == conversation_id)
        )
        if visible_from is not None:
            messages_query = messages_query.where(Message.created_at >= visible_from)
        role: Role = header.my_role
        if role == "flatmate":
            # `_tour_line_visible`, resolved by the header's role (no `conversations` join here).
            messages_query = messages_query.where(Message.tour_change.is_(None))
        newest_first = db.execute(
            messages_query.order_by(Message.created_at.desc(), Message.id.desc()).limit(
                THREAD_LIMIT + 1
            )
        ).all()
        # By id, not by role: in a direct chat both people are `person`.
        i_am_seeker = header.seeker_id == me.id
        if role == "person":
            members = [
                Member(
                    name=header.owner_name,
                    photo_key=header.owner_photo_key,
                    role="person",
                    is_me=not i_am_seeker,
                ),
                Member(
                    name=header.seeker_name,
                    photo_key=header.seeker_photo_key,
                    role="person",
                    is_me=i_am_seeker,
                ),
            ]
        else:
            members = [
                Member(
                    name=header.owner_name,
                    photo_key=header.owner_photo_key,
                    role="owner",
                    is_me=role == "owner",
                )
            ]
        if header.is_room:
            flatmates = db.execute(
                select(
                    User.display_name,
                    User.photo_key,
                    (ListingFlatmate.user_id == me.id).label("is_me"),
                )
                .select_from(ListingFlatmate)
                .join(User, User.id == ListingFlatmate.user_id)
                .where(
                    ListingFlatmate.listing_id == header.application_listing_id,
                    ListingFlatmate.user_id != header.seeker_id,
                )
                .order_by(ListingFlatmate.joined_at, ListingFlatmate.id)
            ).all()
            members += [
                Member(
                    name=row.display_name, photo_key=row.photo_key, role="flatmate", is_me=row.is_me
                )
                for row in flatmates
            ]
        if role != "person":
            members.append(
                Member(
                    name=header.seeker_name,
                    photo_key=header.seeker_photo_key,
                    role="seeker",
                    is_me=role == "seeker",
                )
            )
        tour = (
            tours.current_tour(db, conversation_id)
            if role in ("owner", "seeker") and header.application_listing_id is not None
            else None
        )
        my_read_at: dt.datetime | None = header.my_read_at
        last_message_at: dt.datetime | None = header.last_message_at
        if my_read_at is None or (last_message_at is not None and my_read_at < last_message_at):
            if role == "flatmate":
                upsert = insert(ConversationRead).values(
                    conversation_id=conversation_id, user_id=me.id, read_at=func.now()
                )
                db.execute(
                    upsert.on_conflict_do_update(
                        index_elements=["conversation_id", "user_id"],
                        set_={"read_at": func.now()},
                    )
                )
            else:
                column = Conversation.seeker_read_at if i_am_seeker else Conversation.owner_read_at
                db.execute(
                    update(Conversation)
                    .where(
                        Conversation.id == conversation_id,
                        or_(column.is_(None), column < Conversation.last_message_at),
                    )
                    .values({column: func.now()})
                    .execution_options(synchronize_session=False)
                )
            db.commit()
    except Exception:
        db.rollback()
        raise
    messages = list(reversed(newest_first[:THREAD_LIMIT]))
    return Thread(
        header=header,
        members=members,
        messages=messages,
        truncated=len(newest_first) > THREAD_LIMIT,
        tour=tour,
    )


def send_message(
    db: Session, r: RedisClient, me: User, conversation_id: uuid.UUID, body: str
) -> tuple[Message, list[uuid.UUID]]:
    """Send `body` (already validated by `MessageIn`) as `me` to one of `me`'s conversations whose
    application is `shortlisted` (a direct chat: not closed), and return the message with the
    conversation's member ids (owner, seeker, then any flatmates: the router publishes the chat
    event to them, spec 0005c). Raises
    `RateLimitedError`, `ConversationNotFoundError` or `ChatClosedError`. Moves the conversation's
    `last_message_at` and `me`'s read marker forward (never back: `greatest` skips nulls, so two
    sends committing out of order are safe): the owner's or the seeker's column, or a flatmate's
    `conversation_reads` row, upserted in a CTE of the same UPDATE. Two statements, the member ids
    coming back from the UPDATE's RETURNING. Commits."""
    count_or_raise(
        r,
        (
            (f"rl:chat:user:{me.id}", CHAT_RATE_LIMIT_MINUTE, CHAT_RATE_MINUTE_S),
            (f"rl:chat:user:day:{me.id}", CHAT_RATE_LIMIT_DAY, CHAT_RATE_DAY_S),
        ),
    )
    try:
        source = (
            select(
                Conversation.id,
                literal(me.id, UUID(as_uuid=True)),
                literal(body, Text),
            )
            .select_from(Conversation)
            .outerjoin(Application, Application.id == Conversation.application_id)
            .outerjoin(_F, _flatmate_join(me))
            .where(Conversation.id == conversation_id, _is_member(me), _can_send())
        )
        message = db.scalar(
            insert(Message)
            .from_select(["conversation_id", "sender_id", "body"], source)
            .returning(Message)
        )
        if message is None:
            member = db.scalar(
                select(Conversation.id)
                .select_from(Conversation)
                .outerjoin(Application, Application.id == Conversation.application_id)
                .outerjoin(_F, _flatmate_join(me))
                .where(Conversation.id == conversation_id, _is_member(me))
            )
            if member is None:
                raise ConversationNotFoundError
            raise ChatClosedError
        # The message was inserted, so `me` is a member: neither owner nor seeker is a flatmate.
        party = aliased(Conversation)
        flatmate_read = insert(ConversationRead).from_select(
            ["conversation_id", "user_id", "read_at"],
            select(
                party.id,
                literal(me.id, UUID(as_uuid=True)),
                literal(message.created_at, DateTime(timezone=True)),
            ).where(
                party.id == conversation_id,
                party.owner_id != me.id,
                party.seeker_id != me.id,
            ),
        )
        flatmate_read = flatmate_read.on_conflict_do_update(
            index_elements=["conversation_id", "user_id"],
            set_={
                "read_at": func.greatest(ConversationRead.read_at, flatmate_read.excluded.read_at)
            },
        )
        members = db.execute(
            update(Conversation)
            .add_cte(flatmate_read.cte("flatmate_read"))
            .where(Conversation.id == conversation_id)
            .values(
                last_message_at=func.greatest(Conversation.last_message_at, message.created_at),
                owner_read_at=case(
                    (
                        Conversation.owner_id == me.id,
                        func.greatest(Conversation.owner_read_at, message.created_at),
                    ),
                    else_=Conversation.owner_read_at,
                ),
                seeker_read_at=case(
                    (
                        Conversation.seeker_id == me.id,
                        func.greatest(Conversation.seeker_read_at, message.created_at),
                    ),
                    else_=Conversation.seeker_read_at,
                ),
            )
            .returning(
                Conversation.owner_id,
                Conversation.seeker_id,
                _flatmate_ids().label("flatmate_ids"),
            )
            .execution_options(synchronize_session=False)
        ).one()
        db.commit()
    except Exception:
        db.rollback()
        raise
    return message, [members.owner_id, members.seeker_id, *(members.flatmate_ids or ())]


def member_ids(db: Session, application_id: uuid.UUID) -> list[uuid.UUID]:
    """The member ids of a **room** application's chat: the owner, the seeker, then the flatmates
    (only once the conversation exists: an application without a chat has no flatmate audience).
    One SELECT; call it only for a room application (`event_members`)."""
    has_chat = exists().where(Conversation.application_id == Application.id).correlate(Application)
    flatmates = (
        select(func.array_agg(ListingFlatmate.user_id))
        .where(
            ListingFlatmate.listing_id == Application.listing_id,
            ListingFlatmate.user_id != Application.seeker_id,
            _is_room(),
            has_chat,
        )
        .correlate(Application)
        .scalar_subquery()
    )
    row = db.execute(
        select(Listing.owner_id, Application.seeker_id, flatmates.label("flatmate_ids"))
        .join(Listing, Listing.id == Application.listing_id)
        .where(Application.id == application_id)
    ).one()
    return [row.owner_id, row.seeker_id, *(row.flatmate_ids or ())]


def event_members(db: Session, application: Application, owner_id: uuid.UUID) -> list[uuid.UUID]:
    """Who a `status` chat event about `application` goes to (spec 0005c, 0008d): every member
    (`member_ids`, one SELECT) for a room application, else the owner and the seeker, with no
    query. Call after the commit."""
    if application.listing_type_at_apply == "room":
        return member_ids(db, application.id)
    return [owner_id, application.seeker_id]


def _pair(a: uuid.UUID, b: uuid.UUID) -> tuple[Any, Any]:
    """`least(a, b)`, `greatest(a, b)` in SQL: Postgres's uuid order, the one
    `ck_conversations_direct` checks. The pair is never ordered in Python."""
    low = func.least(literal(a, UUID(as_uuid=True)), literal(b, UUID(as_uuid=True)))
    high = func.greatest(literal(a, UUID(as_uuid=True)), literal(b, UUID(as_uuid=True)))
    return low, high


def open_direct(db: Session, a: uuid.UUID, b: uuid.UUID) -> uuid.UUID:
    """Open the direct chat between people `a` and `b` (either order) and return its id: a new one,
    or the pair's existing one, reopened (`closed_at` cleared) with its history and read markers
    (Q14). Both markers of a new chat start null, so it is `is_new` for both until opened. Raises
    `ValueError` when `a == b`. One statement; does not commit (the caller, 0010h's mutual like,
    owns the transaction)."""
    if a == b:
        raise ValueError("a direct chat needs two different people")
    low, high = _pair(a, b)
    stmt = insert(Conversation).values(owner_id=low, seeker_id=high)
    stmt = stmt.on_conflict_do_update(
        index_elements=["owner_id", "seeker_id"],
        index_where=Conversation.application_id.is_(None),
        set_={"closed_at": None},
    )
    conversation_id: uuid.UUID = db.execute(stmt.returning(Conversation.id)).scalar_one()
    return conversation_id


def close_direct(db: Session, a: uuid.UUID, b: uuid.UUID) -> uuid.UUID | None:
    """Close the direct chat between `a` and `b` (either order; the match was removed): it stays
    readable and sending closes. Returns its id, or `None` when the pair has no direct chat.
    Idempotent: a second close keeps the first `closed_at`. One statement; does not commit."""
    low, high = _pair(a, b)
    conversation_id: uuid.UUID | None = db.execute(
        update(Conversation)
        .where(
            Conversation.owner_id == low,
            Conversation.seeker_id == high,
            Conversation.application_id.is_(None),
        )
        .values(closed_at=func.coalesce(Conversation.closed_at, func.now()))
        .returning(Conversation.id)
        .execution_options(synchronize_session=False)
    ).scalar_one_or_none()
    return conversation_id
