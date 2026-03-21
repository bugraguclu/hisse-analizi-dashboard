"""Tests for admin authentication dependency."""

import pytest
from unittest.mock import patch

from fastapi import HTTPException

from src.api.dependencies import require_admin


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
