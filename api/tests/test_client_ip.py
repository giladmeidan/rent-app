"""The visitor's network (spec 0013b): AC1."""

from collections.abc import Callable

from starlette.requests import Request

from app.client_ip import client_network, network48


def _request(peer: str | None, headers: dict[str, str] | None = None) -> Request:
    return Request(
        {
            "type": "http",
            "headers": [(k.lower().encode(), v.encode()) for k, v in (headers or {}).items()],
            "client": (peer, 50000) if peer is not None else None,
        }
    )


def test_ac1_client_network(set_env: Callable[..., None]) -> None:
    set_env(TRUST_PROXY="none")
    assert client_network(_request("203.0.113.7")) == "203.0.113.7"
    assert client_network(_request("2001:db8:1:2::a")) == "2001:db8:1:2::/64"
    assert client_network(_request("2001:db8:1:2:ffff::1")) == "2001:db8:1:2::/64"
    assert client_network(_request("2001:db8:1:3::a")) == "2001:db8:1:3::/64"
    assert client_network(_request("::ffff:203.0.113.7")) == "203.0.113.7"
    # `none`: Fly-Client-IP and X-Forwarded-For are ignored.
    spoofed = {"Fly-Client-IP": "198.51.100.9", "X-Forwarded-For": "198.51.100.10"}
    assert client_network(_request("203.0.113.7", spoofed)) == "203.0.113.7"
    assert client_network(_request(None)) == "unknown"
    assert client_network(_request("testclient")) == "testclient"

    set_env(TRUST_PROXY="fly")
    assert client_network(_request("203.0.113.7", {"Fly-Client-IP": " 198.51.100.9 "})) == (
        "198.51.100.9"
    )
    assert client_network(_request("10.0.0.1", {"Fly-Client-IP": "2001:db8:1:2::a"})) == (
        "2001:db8:1:2::/64"
    )
    for bad in ("evil", ""):
        assert client_network(_request("203.0.113.7", {"Fly-Client-IP": bad})) == "203.0.113.7"
    xff = {"X-Forwarded-For": "198.51.100.10"}
    assert client_network(_request("203.0.113.7", xff)) == "203.0.113.7"
    assert client_network(_request(None)) == "unknown"
    assert client_network(_request("testclient")) == "testclient"

    assert network48("2001:db8:1:2::/64") == "2001:db8:1::/48"
    for other in ("203.0.113.7", "testclient", "unknown"):
        assert network48(other) is None
