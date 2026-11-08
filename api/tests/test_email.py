"""Email and SMS adapters (spec 0001a): SMTP URL parsing, failures as `EmailUnavailable`."""

import logging
import smtplib
from unittest.mock import MagicMock

import pytest

from app.services.email import EmailUnavailable, SmtpEmailSender
from app.services.sms import NoopSmsSender


@pytest.fixture
def smtp_mocks(monkeypatch: pytest.MonkeyPatch) -> tuple[MagicMock, MagicMock]:
    plain, implicit_tls = MagicMock(name="SMTP"), MagicMock(name="SMTP_SSL")
    monkeypatch.setattr(smtplib, "SMTP", plain)
    monkeypatch.setattr(smtplib, "SMTP_SSL", implicit_tls)
    return plain, implicit_tls


@pytest.mark.parametrize(
    ("url", "ssl", "port"),
    [
        ("smtp://mail.example.com", False, 587),
        ("smtps://mail.example.com", True, 465),
        ("smtp://mail.example.com:2525", False, 2525),
        ("smtps://mail.example.com:2465", True, 2465),
    ],
)
def test_smtp_sender_parses_url(
    smtp_mocks: tuple[MagicMock, MagicMock], url: str, ssl: bool, port: int
) -> None:
    plain, implicit_tls = smtp_mocks

    SmtpEmailSender(url, "noreply@example.com").send("a@example.com", "subject", "body")

    used, unused = (implicit_tls, plain) if ssl else (plain, implicit_tls)
    unused.assert_not_called()
    used.assert_called_once()
    args, kwargs = used.call_args
    assert args == ("mail.example.com", port)
    assert kwargs["timeout"] == 10
    smtp = used.return_value
    assert smtp.starttls.called is not ssl
    smtp.login.assert_not_called()
    message = smtp.send_message.call_args.args[0]
    assert (message["To"], message["From"], message["Subject"]) == (
        "a@example.com",
        "noreply@example.com",
        "subject",
    )


def test_smtp_sender_logs_in_with_url_credentials(
    smtp_mocks: tuple[MagicMock, MagicMock],
) -> None:
    plain, _ = smtp_mocks

    SmtpEmailSender("smtp://user%40x:p%40ss@mail.example.com", "n@example.com").send(
        "a@example.com", "s", "b"
    )

    plain.return_value.login.assert_called_once_with("user@x", "p@ss")


@pytest.mark.parametrize("stage", ["connect", "send"])
def test_smtp_sender_raises_email_unavailable(
    smtp_mocks: tuple[MagicMock, MagicMock], caplog: pytest.LogCaptureFixture, stage: str
) -> None:
    plain, _ = smtp_mocks
    if stage == "connect":
        plain.side_effect = OSError("connection refused")
    else:
        plain.return_value.send_message.side_effect = smtplib.SMTPServerDisconnected("gone")

    with caplog.at_level(logging.DEBUG), pytest.raises(EmailUnavailable):
        SmtpEmailSender("smtp://mail.example.com", "n@example.com").send(
            "a@example.com", "s", "body-canary 123456"
        )

    assert "body-canary" not in caplog.text
    assert "123456" not in caplog.text


def test_smtp_url_scheme_validated() -> None:
    with pytest.raises(ValueError, match="SMTP_URL"):
        SmtpEmailSender("http://mail.example.com", "n@example.com")


def test_noop_sms_sender_logs_length_only(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level(logging.DEBUG):
        NoopSmsSender().send("+972500000000", "code 123456")

    assert "123456" not in caplog.text
    assert "+972500000000" not in caplog.text
    assert "length 11" in caplog.text
