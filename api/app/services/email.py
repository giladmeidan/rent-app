"""Outbound email (spec 0001a): `FileEmailSender` in dev and e2e, `SmtpEmailSender` to deliver."""

import datetime as dt
import json
import logging
import smtplib
import ssl
import uuid
from email.message import EmailMessage
from pathlib import Path
from typing import Protocol

from app.config import get_settings, parse_smtp_url

log = logging.getLogger(__name__)

SMTP_TIMEOUT_S = 10


class EmailUnavailable(Exception):  # noqa: N818  (name fixed by spec 0001a)
    """The message could not be handed to the mail system."""


class EmailSender(Protocol):
    def send(self, to: str, subject: str, body: str) -> None: ...


class FileEmailSender:
    """Writes each message as one JSON file `{to, subject, body, sent_at}` into `outbox_dir`."""

    def __init__(self, outbox_dir: Path) -> None:
        self.outbox_dir = outbox_dir

    def send(self, to: str, subject: str, body: str) -> None:
        now = dt.datetime.now(dt.UTC)
        try:
            self.outbox_dir.mkdir(parents=True, exist_ok=True)
            # The uuid suffix keeps two messages in the same microsecond apart.
            path = self.outbox_dir / f"{now:%Y%m%dT%H%M%S%f}-{uuid.uuid4().hex}.json"
            message = {"to": to, "subject": subject, "body": body, "sent_at": now.isoformat()}
            path.write_text(json.dumps(message, ensure_ascii=False), encoding="utf-8")
        except OSError as exc:
            log.error("outbox write failed: %s", type(exc).__name__)
            raise EmailUnavailable from exc


class SmtpEmailSender:
    """stdlib SMTP over `SMTP_URL`: `smtp://` = STARTTLS (default port 587), `smtps://` = implicit
    TLS (default port 465); `user:pass@` in the URL logs in. Never logs the message body."""

    def __init__(self, smtp_url: str, sender: str) -> None:
        target = parse_smtp_url(smtp_url)
        self.implicit_tls = target.implicit_tls
        self.host = target.host
        self.port = target.port
        self.username = target.username
        self.password = target.password
        self.sender = sender

    def send(self, to: str, subject: str, body: str) -> None:
        message = EmailMessage()
        message["From"] = self.sender
        message["To"] = to
        message["Subject"] = subject
        message.set_content(body)
        context = ssl.create_default_context()
        try:
            if self.implicit_tls:
                smtp: smtplib.SMTP = smtplib.SMTP_SSL(
                    self.host, self.port, timeout=SMTP_TIMEOUT_S, context=context
                )
            else:
                smtp = smtplib.SMTP(self.host, self.port, timeout=SMTP_TIMEOUT_S)
            with smtp:
                if not self.implicit_tls:
                    smtp.starttls(context=context)
                if self.username is not None:
                    smtp.login(self.username, self.password or "")
                smtp.send_message(message)
        except (smtplib.SMTPException, OSError) as exc:
            log.error("smtp send failed: %s", type(exc).__name__)
            raise EmailUnavailable from exc


def get_email_sender() -> EmailSender:
    """FastAPI dependency: the sender `EMAIL_BACKEND` selects."""
    settings = get_settings()
    if settings.email_backend == "smtp":
        assert settings.smtp_url is not None  # Settings rejects smtp without SMTP_URL
        return SmtpEmailSender(settings.smtp_url.get_secret_value(), settings.email_from)
    return FileEmailSender(settings.email_outbox_dir)
