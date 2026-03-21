"""Tests for configuration and security."""

from src.core.config import Settings


class TestSettings:
    def test_cors_parsing(self):
        s = Settings(cors_origins="http://localhost:3000, http://example.com ")
        origins = s.cors_allowed_origins
        assert origins == ["http://localhost:3000", "http://example.com"]

    def test_cors_empty(self):
        s = Settings(cors_origins="")
        assert s.cors_allowed_origins == []

    def test_is_production(self):
        s = Settings(app_env="production")
        assert s.is_production is True

    def test_is_not_production(self):
        s = Settings(app_env="development")
        assert s.is_production is False

    def test_staging_is_production(self):
        s = Settings(app_env="staging")
        assert s.is_production is True
