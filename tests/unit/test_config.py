"""Tests for configuration and security."""

import pytest
from pydantic import ValidationError

from src.core.config import Settings

STRONG_KEY = "x" * 40
SAFE_DB = "postgresql+asyncpg://app:S3cure-Pa55@db:5432/hisse_analizi"
SAFE_DB_SYNC = "postgresql://app:S3cure-Pa55@db:5432/hisse_analizi"


def make(**kwargs) -> Settings:
    return Settings(_env_file=None, **kwargs)


def production(**overrides) -> Settings:
    values = {
        "app_env": "production",
        "admin_api_key": STRONG_KEY,
        "database_url": SAFE_DB,
        "database_url_sync": SAFE_DB_SYNC,
        "cors_origins": "https://borsa.example.com",
    }
    values.update(overrides)
    return make(**values)


class TestSettings:
    def test_cors_parsing(self):
        s = make(cors_origins="http://localhost:3000, http://example.com ")
        assert s.cors_allowed_origins == ["http://localhost:3000", "http://example.com"]

    def test_cors_empty(self):
        assert make(cors_origins="").cors_allowed_origins == []

    def test_is_production(self):
        assert make(app_env="production").is_production is True

    def test_is_not_production(self):
        assert make(app_env="development").is_production is False

    def test_staging_is_production(self):
        assert make(app_env="staging").is_production is True

    @pytest.mark.parametrize(
        ("raw", "expected"),
        [("prod", "production"), (" Production ", "production"), ("dev", "development"), ("stage", "staging")],
    )
    def test_app_env_aliases_are_normalized(self, raw, expected):
        assert make(app_env=raw).app_env == expected

    def test_unknown_app_env_is_rejected(self):
        """A typo must not silently fall back to development (admin bypass)."""
        with pytest.raises(ValidationError):
            make(app_env="prodution")

    def test_admin_auth_only_disabled_for_local_envs_without_key(self):
        assert make(app_env="development", admin_api_key="").admin_auth_disabled is True
        assert make(app_env="test", admin_api_key="").admin_auth_disabled is True
        assert make(app_env="development", admin_api_key="k").admin_auth_disabled is False
        assert make(app_env="staging", admin_api_key="").admin_auth_disabled is False
        assert make(app_env="production", admin_api_key="").admin_auth_disabled is False

    def test_invalid_trusted_proxy_is_rejected(self):
        with pytest.raises(ValidationError):
            make(trusted_proxies="127.0.0.1,not-an-ip")

    def test_invalid_rate_limit_is_rejected(self):
        with pytest.raises(ValidationError):
            make(rate_limit_admin="three per minute")


class TestProductionValidation:
    def test_valid_production_config(self):
        assert production().production_config_errors() == []

    def test_development_is_never_validated(self):
        assert make(app_env="development", admin_api_key="").production_config_errors() == []

    def test_missing_admin_key(self):
        errors = production(admin_api_key="").production_config_errors()
        assert any("ADMIN_API_KEY is required" in e for e in errors)

    def test_short_admin_key(self):
        errors = production(admin_api_key="short-key").production_config_errors()
        assert any("at least" in e for e in errors)

    @pytest.mark.parametrize("field", ["database_url", "database_url_sync"])
    def test_default_db_credentials_rejected(self, field):
        default = {
            "database_url": "postgresql+asyncpg://hisse:hisse@db:5432/hisse_analizi",
            "database_url_sync": "postgresql://hisse:hisse@db:5432/hisse_analizi",
        }[field]
        errors = production(**{field: default}).production_config_errors()
        assert any(field.upper() in e and "credentials" in e for e in errors)

    def test_wildcard_cors_rejected(self):
        errors = production(cors_origins="https://a.example.com,*").production_config_errors()
        assert any("CORS_ORIGINS" in e for e in errors)

    def test_validate_exits_on_errors(self, capsys):
        with pytest.raises(SystemExit) as exc_info:
            production(admin_api_key="").validate_production_config()
        assert exc_info.value.code == 1
        assert "FATAL CONFIG ERROR" in capsys.readouterr().err
