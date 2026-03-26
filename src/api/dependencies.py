"""Shared API dependencies — authentication, rate limiting, input validation."""

import re

from fastapi import Depends, HTTPException, Security, status
from fastapi.security import APIKeyHeader

from src.core.config import settings

_api_key_header = APIKeyHeader(name="X-Admin-Key", auto_error=False)

# Ticker validation: 1-10 alphanumeric characters (BIST tickers like THYAO, GARAN, XU100)
_TICKER_RE = re.compile(r"^[A-Z0-9]{1,10}$")


def validate_ticker(ticker: str) -> str:
    """Validate and sanitize a ticker symbol. Returns uppercased ticker."""
    t = ticker.strip().upper()
    if not _TICKER_RE.match(t):
        raise HTTPException(
            status_code=400,
            detail="Invalid ticker format. Use 1-10 alphanumeric characters.",
        )
    return t


async def require_admin(api_key: str | None = Security(_api_key_header)) -> str:
    """Protect admin endpoints with API key authentication.

    In development mode without ADMIN_API_KEY configured, all requests are allowed
    to preserve local development ergonomics.
    """
    # Dev mode without key configured: allow all
    if not settings.admin_api_key and not settings.is_production:
        return "dev-bypass"

    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Admin-Key header",
        )

    if api_key != settings.admin_api_key:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin API key",
        )

    return api_key
