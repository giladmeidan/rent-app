"""Fixed-window rate limits in Redis (moved out of `services/auth.py` by spec 0004a).

`count_or_raise` counts one request against every counter at once, atomically, and raises
`RateLimitedError` (counting nothing) if any of them is already at its limit, so refused requests
never use up the budget. Used by the OTP request (`services/auth.py`) and by applying
(`services/applications.py`)."""

from collections.abc import Sequence

from app.redis_client import RedisClient

# KEYS = the counters, ARGV = limit, window per counter. If any counter is at its limit, return
# the largest remaining TTL and count nothing, so refused requests never use up the budget.
# Otherwise create each counter with its TTL (SET NX EX) and INCR it, atomically: a counter can
# never exist without a TTL.
_COUNT_REQUEST = """
local retry = 0
for i, key in ipairs(KEYS) do
  if tonumber(redis.call('GET', key) or '0') >= tonumber(ARGV[2 * i - 1]) then
    retry = math.max(retry, redis.call('TTL', key), 1)
  end
end
if retry > 0 then return retry end
for i, key in ipairs(KEYS) do
  redis.call('SET', key, 0, 'EX', ARGV[2 * i], 'NX')
  redis.call('INCR', key)
end
return 0
"""


class RateLimitedError(Exception):
    def __init__(self, retry_after: int) -> None:
        super().__init__("rate_limited")
        self.retry_after = retry_after


def count_or_raise(r: RedisClient, counters: Sequence[tuple[str, int, int]]) -> None:
    """Count this request against every `(key, limit, window_s)` counter; raise
    `RateLimitedError` with the largest remaining window (counting nothing) if any is already at
    its limit."""
    keys = [key for key, _limit, _window in counters]
    args = [value for _key, limit, window in counters for value in (limit, window)]
    retry_after = int(
        r.eval(_COUNT_REQUEST, len(keys), *keys, *args)  # type: ignore[no-untyped-call]  # untyped stub
    )
    if retry_after:
        raise RateLimitedError(retry_after=retry_after)
