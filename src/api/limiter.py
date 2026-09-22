"""Shared slowapi limiter and proxy-aware client identification.

Every browser request reaches the API through the Next.js proxy, so the TCP peer is
the proxy; keying on it would put all users into ONE bucket. ``client_ip_key`` walks
``X-Forwarded-For`` instead — but only when the direct peer is a trusted proxy
(``TRUSTED_PROXIES``), and from RIGHT to LEFT, skipping trusted hops. The leftmost
entries are client-controlled and are never trusted blindly.

Uvicorn's own proxy-header handling (``--forwarded-allow-ips``, default 127.0.0.1) may
already have replaced ``request.client`` with an address taken from the header; the
walk below gives the same answer in that case, because an untrusted resolved client
is used as-is and a trusted one leads to the same right-to-left walk.
"""

import ipaddress
import time
from functools import lru_cache
from typing import TypeAlias

from fastapi import HTTPException, status
from limits import RateLimitItem, parse
from slowapi import Limiter
from starlette.requests import Request

from src.core.config import settings, split_csv

IPNetwork: TypeAlias = ipaddress.IPv4Network | ipaddress.IPv6Network
IPAddress: TypeAlias = ipaddress.IPv4Address | ipaddress.IPv6Address

_MAX_KEY_LENGTH = 64
_UNKNOWN_CLIENT = "unknown"


@lru_cache(maxsize=8)
def parse_trusted_networks(value: str) -> tuple[IPNetwork, ...]:
    return tuple(ipaddress.ip_network(item, strict=False) for item in split_csv(value))


def _parse_ip(value: str) -> IPAddress | None:
    """Parse an address as found in X-Forwarded-For (tolerates ports and brackets)."""
    host = value.strip().strip('"')
    if host.startswith("["):  # [v6]:port
        host = host[1 : host.find("]")] if "]" in host else host[1:]
    elif host.count(":") == 1:  # v4:port
        host = host.split(":", 1)[0]
    try:
        address = ipaddress.ip_address(host.split("%", 1)[0])  # drop IPv6 zone id
    except ValueError:
        return None
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        return address.ipv4_mapped
    return address


def _is_trusted(address: IPAddress | None, networks: tuple[IPNetwork, ...]) -> bool:
    return address is not None and any(address in net for net in networks)


def resolve_client_ip(peer: str | None, forwarded_for: list[str], networks: tuple[IPNetwork, ...]) -> str:
    """Pure implementation of :func:`client_ip_key` (unit-tested)."""
    peer_ip = _parse_ip(peer) if peer else None
    if not _is_trusted(peer_ip, networks):
        # Direct client (or uvicorn already resolved an untrusted client address).
        return str(peer_ip) if peer_ip else (peer or _UNKNOWN_CLIENT)[:_MAX_KEY_LENGTH]

    hops = [hop.strip() for header in forwarded_for for hop in header.split(",") if hop.strip()]
    for hop in reversed(hops):
        hop_ip = _parse_ip(hop)
        if not _is_trusted(hop_ip, networks):
            # First untrusted hop from the right = the real client. An unparsable value
            # is still a distinct (attacker-visible) key, never a shared bucket.
            return str(hop_ip) if hop_ip else hop[:_MAX_KEY_LENGTH]
    if hops:
        # Every hop is trusted (client inside a trusted network): originating address.
        first = _parse_ip(hops[0])
        return str(first) if first else hops[0][:_MAX_KEY_LENGTH]
    return str(peer_ip)


def client_ip_key(request: Request) -> str:
    """slowapi key function: the real client IP behind trusted reverse proxies."""
    peer = request.client.host if request.client else None
    forwarded_for = request.headers.getlist("x-forwarded-for")
    return resolve_client_ip(peer, forwarded_for, parse_trusted_networks(settings.trusted_proxies))


# Site-wide default limit. slowapi's middleware cannot locate route handlers inside
# FastAPI's included routers (it only inspects top-level routes, so every request would
# be treated as exempt); the default is therefore enforced by a global dependency
# (``enforce_default_rate_limit``, registered on the FastAPI app). A dashboard page view
# fans out ~20 requests, so RATE_LIMIT_DEFAULT must stay well above that (300/minute).
# Expensive routes add stricter limits with @limiter.limit(...).
limiter = Limiter(key_func=client_ip_key)

RATE_LIMIT_DETAIL = "Çok fazla istek gönderildi. Lütfen biraz sonra tekrar deneyin."
_DEFAULT_LIMIT_EXEMPT_PATHS = frozenset({"/health", "/health/ready"})


@lru_cache(maxsize=4)
def _parse_limit(value: str) -> RateLimitItem:
    return parse(value)


async def enforce_default_rate_limit(request: Request) -> None:
    """Global dependency: per-client RATE_LIMIT_DEFAULT on every API route (health exempt)."""
    if not limiter.enabled or request.url.path in _DEFAULT_LIMIT_EXEMPT_PATHS:
        return
    item = _parse_limit(settings.rate_limit_default)
    client = client_ip_key(request)
    if limiter.limiter.hit(item, "default", client):
        return
    reset_at, _remaining = limiter.limiter.get_window_stats(item, "default", client)
    retry_after = max(1, int(reset_at - time.time()) + 1)
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail=RATE_LIMIT_DETAIL,
        headers={"Retry-After": str(retry_after)},
    )
