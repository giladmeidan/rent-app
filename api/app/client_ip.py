"""The visitor's network, the key of every per-IP limit (spec 0013b).

`client_network` reads the client address from `Fly-Client-IP` when `TRUST_PROXY=fly` (Fly's proxy
overwrites any client-sent value) and from the socket peer otherwise; no other header is ever read,
`X-Forwarded-For` included. An IPv6 address is reduced to its /64 (a client controls the low 64
bits), an IPv4-mapped one to its IPv4. `network48` gives a /64's /48, counted beside it at
`PREFIX48_FACTOR` times its limits (read it at call time so a test can monkeypatch it)."""

import ipaddress

from fastapi import Request

from app.config import get_settings

PREFIX48_FACTOR = 16


def client_network(request: Request) -> str:
    """The client's network: an IPv4 address, an IPv6 /64, a non-IP peer unchanged, or
    `"unknown"` without a client."""
    addr: ipaddress.IPv4Address | ipaddress.IPv6Address | None = None
    if get_settings().trust_proxy == "fly":
        try:
            addr = ipaddress.ip_address(request.headers.get("Fly-Client-IP", "").strip())
        except ValueError:
            addr = None
    if addr is None:
        if request.client is None:
            return "unknown"
        try:
            addr = ipaddress.ip_address(request.client.host)
        except ValueError:
            return request.client.host
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped is not None:
            return str(addr.ipv4_mapped)
        return str(ipaddress.ip_network(f"{addr}/64", strict=False))
    return str(addr)


def network48(network: str) -> str | None:
    """The /48 holding an IPv6 /64 network; None for anything else."""
    try:
        net = ipaddress.ip_network(network)
    except ValueError:
        return None
    if not isinstance(net, ipaddress.IPv6Network) or net.prefixlen < 48:
        return None
    return str(net.supernet(new_prefix=48))
