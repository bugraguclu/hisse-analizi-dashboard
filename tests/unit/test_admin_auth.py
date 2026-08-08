"""Tests for admin authentication dependency."""

import pytest
from unittest.mock import patch

from fastapi import HTTPException

from src.api.dependencies import ensure_upstream_success, require_admin


@pytest.mark.asyncio
class TestRequireAdmin:
    async def test_dev_bypass_when_no_key_configured(self):
        """In dev mode without ADMIN_API_KEY, all requests pass."""
        with patch("src.api.dependencies.settings") as mock_settings:
            mock_settings.admin_api_key = ""
            mock_settings.is_production = False
            result = await require_admin(api_key=None)
            assert result == "dev-bypass"

    async def test_missing_key_returns_401(self):
        """Missing API key returns 401."""
        with patch("src.api.dependencies.settings") as mock_settings:
            mock_settings.admin_api_key = "secret123"
            mock_settings.is_production = True
            with pytest.raises(HTTPException) as exc_info:
                await require_admin(api_key=None)
            assert exc_info.value.status_code == 401

    async def test_wrong_key_returns_403(self):
        """Wrong API key returns 403."""
        with patch("src.api.dependencies.settings") as mock_settings:
            mock_settings.admin_api_key = "secret123"
            mock_settings.is_production = True
            with pytest.raises(HTTPException) as exc_info:
                await require_admin(api_key="wrong")
            assert exc_info.value.status_code == 403

    async def test_correct_key_passes(self):
        """Correct API key passes auth."""
        with patch("src.api.dependencies.settings") as mock_settings:
            mock_settings.admin_api_key = "secret123"
            mock_settings.is_production = True
            result = await require_admin(api_key="secret123")
            assert result == "secret123"


def test_ensure_upstream_success_preserves_success_payload():
    payload = {"data": [1, 2, 3]}
    assert ensure_upstream_success(payload) is payload


def test_ensure_upstream_success_raises_bad_gateway_for_adapter_error():
    with pytest.raises(HTTPException) as exc_info:
        ensure_upstream_success({"data": [], "error": "provider unavailable"})

    assert exc_info.value.status_code == 502
    assert exc_info.value.detail == "provider unavailable"
