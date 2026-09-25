"""Tests for admin authentication and ticker validation."""

import itertools
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from src.api import dependencies
from src.api.dependencies import _keys_match, require_admin, validate_ticker
from src.core.config import Settings

_ip_counter = itertools.count(1)
GOOD_KEY = "k" * 32


def _request() -> Request:
    """A request from a unique client IP (the failure throttle is per client)."""
    n = next(_ip_counter)
    return Request({"type": "http", "headers": [], "client": (f"198.51.{n // 250}.{n % 250 + 1}", 1234)})


def _settings(**kwargs) -> Settings:
    return Settings(_env_file=None, **kwargs)


@pytest.mark.asyncio
class TestRequireAdmin:
    async def test_dev_bypass_when_no_key_configured(self):
        with patch.object(dependencies, "settings", _settings(app_env="development", admin_api_key="")):
            assert await require_admin(_request(), api_key=None) == "dev-bypass"

    @pytest.mark.parametrize("env", ["production", "staging"])
    async def test_no_bypass_in_production_like_envs_without_key(self, env):
        """An empty key must never open the admin API outside development/test."""
        with patch.object(dependencies, "settings", _settings(app_env=env, admin_api_key="")):
            with pytest.raises(HTTPException) as exc_info:
                await require_admin(_request(), api_key=None)
            assert exc_info.value.status_code == 503
            with pytest.raises(HTTPException):
                await require_admin(_request(), api_key="anything")

    async def test_configured_key_is_enforced_even_in_development(self):
        with patch.object(dependencies, "settings", _settings(app_env="development", admin_api_key=GOOD_KEY)):
            with pytest.raises(HTTPException) as exc_info:
                await require_admin(_request(), api_key=None)
            assert exc_info.value.status_code == 401

    async def test_missing_key_returns_401(self):
        with patch.object(dependencies, "settings", _settings(app_env="production", admin_api_key=GOOD_KEY)):
            with pytest.raises(HTTPException) as exc_info:
                await require_admin(_request(), api_key=None)
            assert exc_info.value.status_code == 401

    async def test_wrong_key_returns_403(self):
        with patch.object(dependencies, "settings", _settings(app_env="production", admin_api_key=GOOD_KEY)):
            with pytest.raises(HTTPException) as exc_info:
                await require_admin(_request(), api_key="wrong")
            assert exc_info.value.status_code == 403

    async def test_correct_key_passes(self):
        with patch.object(dependencies, "settings", _settings(app_env="production", admin_api_key=GOOD_KEY)):
            assert await require_admin(_request(), api_key=GOOD_KEY) == GOOD_KEY

    async def test_comparison_is_constant_time(self):
        with patch.object(dependencies, "settings", _settings(app_env="production", admin_api_key=GOOD_KEY)):
            with patch.object(dependencies.hmac, "compare_digest", wraps=dependencies.hmac.compare_digest) as spy:
                await require_admin(_request(), api_key=GOOD_KEY)
            spy.assert_called_once()

    async def test_repeated_failures_are_throttled(self):
        request = _request()
        with patch.object(dependencies, "settings", _settings(app_env="production", admin_api_key=GOOD_KEY)):
            for _ in range(10):
                with pytest.raises(HTTPException) as exc_info:
                    await require_admin(request, api_key="wrong")
                assert exc_info.value.status_code == 403
            with pytest.raises(HTTPException) as exc_info:
                await require_admin(request, api_key=GOOD_KEY)
            assert exc_info.value.status_code == 429
            # other clients are unaffected
            assert await require_admin(_request(), api_key=GOOD_KEY) == GOOD_KEY


def test_keys_match_handles_non_ascii_and_length_mismatch():
    assert _keys_match("şifre-ğüç", "şifre-ğüç")
    assert not _keys_match("short", "longer-key")
    assert not _keys_match("", "x")


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("thyao", "THYAO"), (" GARAN.IS ", "GARAN"), ("XU100", "XU100"), ("akbnk.e", "AKBNK")],
)
def test_validate_ticker_normalizes_like_market_endpoints(raw: str, expected: str):
    assert validate_ticker(raw) == expected


@pytest.mark.parametrize("raw", ["", "T", "THY-AO", "A" * 11, "'; DROP TABLE"])
def test_validate_ticker_rejects_garbage_with_turkish_400(raw: str):
    with pytest.raises(HTTPException) as exc_info:
        validate_ticker(raw)
    assert exc_info.value.status_code == 400
    assert "Geçersiz sembol" in exc_info.value.detail
