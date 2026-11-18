"""Security emails (spec 0022a): the owner's mailbox hears when the account's password is set or
changed and when the account is deleted. Sent by FastAPI `BackgroundTasks` after the response, so
a dead mail server never delays or fails the action. Logs exception types only, never an address.

shortcut: one attempt, no outbox; add a durable queue if logs show lost security mail"""

import logging

from app.config import get_settings
from app.i18n import he
from app.redis_client import RedisClient, soft
from app.services import accounts
from app.services.email import EmailSender
from app.services.rate_limit import RateLimitedError, count_or_raise

log = logging.getLogger(__name__)

# Per mailbox, not per account: deleting and signing up again makes a new user id, and must not
# reset these (Gilad 2026-11-18). Counters are keyed by `accounts.email_hmac`, never the address.
# `limits.WRITE` alone allows 200 password changes an hour. More than one, so the owner's own change
# cannot silence the warning about an intruder's right after it.
PASSWORD_MAIL_LIMIT = 3
PASSWORD_MAIL_WINDOW_S = 3600
DELETED_MAIL_LIMIT = 3
DELETED_MAIL_WINDOW_S = 86_400


def _send(sender: EmailSender, to: str, subject: str, template: str) -> None:
    try:
        settings = get_settings()
        body = template.format(
            login_url=f"{settings.web_origin}/login", contact=settings.contact_email
        )
        sender.send(to, subject, body)
    except Exception as exc:  # after the response: nobody is left to tell
        log.error("security mail failed: %s", type(exc).__name__)


def send_password_changed(sender: EmailSender, to: str) -> None:
    _send(sender, to, he.SECURITY_PASSWORD_SUBJECT, he.SECURITY_PASSWORD_BODY)


def send_account_deleted(sender: EmailSender, to: str) -> None:
    _send(sender, to, he.SECURITY_DELETED_SUBJECT, he.SECURITY_DELETED_BODY)


def _due(r: RedisClient, kind: str, email: str, limit: int, window_s: int) -> bool:
    """Whether this mail may go. Redis being down means yes: a security notice outranks the cap."""
    key = f"rl:security_mail:{kind}:{accounts.email_hmac(email)}"
    try:
        soft(lambda: count_or_raise(r, [(key, limit, window_s)]))
    except RateLimitedError:
        return False
    return True


def password_mail_due(r: RedisClient, email: str) -> bool:
    return _due(r, "password", email, PASSWORD_MAIL_LIMIT, PASSWORD_MAIL_WINDOW_S)


def deleted_mail_due(r: RedisClient, email: str) -> bool:
    return _due(r, "deleted", email, DELETED_MAIL_LIMIT, DELETED_MAIL_WINDOW_S)
