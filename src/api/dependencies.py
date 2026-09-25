"""Shared API dependencies — admin authentication and ticker validation.

(Upstream error mapping lives in ``src.adapters.utils.upstream_failure``.)
"""

import hmac

import structlog
from fastapi import HTTPException, Request, Security, status
from fastapi.security import APIKeyHeader
from limits import parse

from src.adapters.utils import InvalidInputError, normalize_symbol
from src.api.limiter import client_ip_key, limiter
from src.core.config import settings

logger = structlog.get_logger(__name__)

_api_key_header = APIKeyHeader(name="X-Admin-Key", auto_error=False)

# Failed admin authentications per client IP (brute-force throttle).
_ADMIN_AUTH_FAILURE_LIMIT = parse("10/minute")


def validate_ticker(ticker: str) -> str:
    """Normalize a ticker with the shared market-data rule (see ``normalize_symbol``).

    Uppercases, strips ``.IS`` / ``.E`` suffixes and accepts ``^[A-Z0-9]{2,10}$``;
    anything else is a 400 with a Turkish message.
    """
    try:
        return normalize_symbol(ticker)
    except InvalidInputError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=exc.message) from exc


def _keys_match(provided: str, expected: str) -> bool:
    """Constant-time comparison (no early exit on the first differing byte)."""
    return hmac.compare_digest(provided.encode("utf-8"), expected.encode("utf-8"))


async def require_admin(request: Request, api_key: str | None = Security(_api_key_header)) -> str:
    """Protect admin endpoints with the X-Admin-Key header.

    Without a configured ADMIN_API_KEY the endpoints are open only when APP_ENV is
    development or test; in any other environment they are closed (and production /
    staging refuse to start without a key, see Settings.production_config_errors).
    """
    if settings.admin_auth_disabled:
        return "dev-bypass"

    client = client_ip_key(request)
    if not limiter.limiter.test(_ADMIN_AUTH_FAILURE_LIMIT, "admin-auth", client):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Çok fazla başarısız yönetici girişi denemesi. Lütfen biraz sonra tekrar deneyin.",
            headers={"Retry-After": "60"},
        )

    if not settings.admin_api_key:
        # Non-development environment without a key: fail closed.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Yönetici erişimi yapılandırılmamış.",
        )

    if not api_key:
        limiter.limiter.hit(_ADMIN_AUTH_FAILURE_LIMIT, "admin-auth", client)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="X-Admin-Key başlığı gerekli.",
        )

    if not _keys_match(api_key, settings.admin_api_key):
        limiter.limiter.hit(_ADMIN_AUTH_FAILURE_LIMIT, "admin-auth", client)
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Geçersiz yönetici anahtarı.",
        )

    return api_key
