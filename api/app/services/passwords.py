"""Password hashing (spec 0016a): the only module that imports `argon2`.

argon2id with OWASP's setting (19 MiB, t=2, p=1), not the library default (64 MiB, p=4): the API
machine has one shared CPU and 1 GB, and FastAPI's threadpool could run 40 hashes at once. The
semaphore keeps at most `_CONCURRENT` hashes or verifies in flight (≤ ~76 MiB) whatever the
threadpool holds. `PasswordHasher` draws a fresh random 16-byte salt for every hash and stores it
inside the encoded string, so one password never hashes the same way twice. `needs_rehash` lets a
login upgrade a stored hash if these parameters are raised later."""

import secrets
import threading

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

_CONCURRENT = 4
_hasher = PasswordHasher(time_cost=2, memory_cost=19456, parallelism=1)
_slots = threading.BoundedSemaphore(_CONCURRENT)


def hash_password(raw: str) -> str:
    with _slots:
        return _hasher.hash(raw)


def verify_password(stored: str, raw: str) -> bool:
    """False on a wrong password; any other argon2 error (a malformed hash) raises."""
    with _slots:
        try:
            return _hasher.verify(stored, raw)
        except VerifyMismatchError:
            return False


def needs_rehash(stored: str) -> bool:
    return _hasher.check_needs_rehash(stored)


# A failed login with no stored hash verifies against this, so it costs what a real one does.
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))
