"""SMS adapter (spec 0001a). Stub only, with no caller yet: switching SMS on at launch readiness
(PRODUCT.md "OTP") is then a config change, not a new interface."""

import logging
from typing import Protocol

log = logging.getLogger(__name__)


class SmsSender(Protocol):
    def send(self, to_e164: str, body: str) -> None: ...


class NoopSmsSender:
    def send(self, to_e164: str, body: str) -> None:
        # Length only: the body carries a code and the number is PII.
        log.info("sms not sent (noop sender), body length %d", len(body))
