"""Application settings, read from the environment / ``.env`` via pydantic-settings.

Production and staging deployments are validated at import time
(:func:`Settings.validate_production_config`): the process refuses to start with
missing secrets, default database credentials or a wildcard CORS policy.
"""

import ipaddress
import sys

from limits import parse_many
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url
from sqlalchemy.exc import ArgumentError

# Canonical environment names; common shorthands are normalised onto them so a
# typo such as APP_ENV=prod can never silently fall back to development behaviour.
ALLOWED_ENVIRONMENTS = ("development", "test", "staging", "production")
_ENV_ALIASES = {
    "dev": "development",
    "local": "development",
    "testing": "test",
    "stage": "staging",
    "prod": "production",
}
_PRODUCTION_ENVIRONMENTS = ("production", "staging")

# Passwords that must never be used outside local development (the first one is the
# docker-compose default).
_WEAK_DB_PASSWORDS = frozenset({"hisse", "postgres", "password", "changeme", "admin", "secret"})
MIN_ADMIN_API_KEY_LENGTH = 24


def split_csv(value: str) -> list[str]:
    """Split a comma-separated setting into trimmed, non-empty items."""
    return [item.strip() for item in value.split(",") if item.strip()]


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "postgresql+asyncpg://hisse:hisse@localhost:5432/hisse_analizi"
    # Used by Alembic migrations (sync driver, psycopg2).
    database_url_sync: str = "postgresql://hisse:hisse@localhost:5432/hisse_analizi"
    db_echo: bool = False  # log every SQL statement (very noisy; debugging only)

    tz: str = "Europe/Istanbul"
    default_poll_interval_seconds: int = 30
    user_agent: str = "HisseAnalizi/1.0"
    log_level: str = "INFO"

    # Admin authentication — required in production/staging. With an empty key the
    # admin endpoints are open ONLY when APP_ENV is development or test.
    admin_api_key: str = ""

    # CORS — comma-separated origins; defaults to localhost for dev
    cors_origins: str = "http://localhost:3000,http://localhost:8000"

    # Reverse proxies whose X-Forwarded-For header is trusted when identifying the
    # client for rate limiting (comma-separated IPs and/or CIDR networks). The
    # Next.js dashboard proxies every browser request, so its address must be here.
    trusted_proxies: str = "127.0.0.1,::1,172.16.0.0/12,10.0.0.0/8,192.168.0.0/16"

    # Rate limiting (slowapi syntax, e.g. "60/minute")
    rate_limit_default: str = "300/minute"  # per client; one page view fans out ~20 API calls
    rate_limit_admin: str = "20/minute"

    # SMTP
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = "noreply@example.com"
    smtp_use_tls: bool = True  # port 465 -> implicit TLS, any other port -> STARTTLS
    smtp_timeout_seconds: float = 30.0
    enable_real_email: bool = False

    # HTTP
    http_connect_timeout: float = 15.0
    http_read_timeout: float = 30.0

    # Backoff (polling sources and outbox retries)
    backoff_base_seconds: int = 60
    backoff_max_seconds: int = 900
    backoff_factor: int = 2
    max_consecutive_failures: int = 5  # a source above this is logged as degraded

    # Outbox / notifications
    outbox_batch_size: int = 10
    outbox_max_attempts: int = 5  # after this many failed attempts an entry is dead (status=failed)
    outbox_retention_days: int = 30  # processed outbox rows older than this are purged
    notification_max_event_age_hours: int = 48  # older events are not e-mailed (backfills, outages)

    # AI / LLM (haber duygu siniflandirma)
    ai_provider: str = "gemini"  # "gemini" (Google AI Studio) | "anthropic" (Claude)
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash"
    anthropic_api_key: str = ""
    ai_classifier_model: str = "claude-haiku-4-5"  # AI_PROVIDER=anthropic iken kullanilan model
    ai_daily_budget_usd: float = 5.0

    # Haber toplama (Faz 2)
    news_poll_enabled: bool = True
    news_poll_interval_seconds: int = 900  # 15 dakika
    news_fetch_concurrency: int = 4
    ai_news_classify_enabled: bool = True  # LLM anahtari yoksa otomatik atlanir

    # Worker concurrency
    worker_max_concurrency: int = 5
    # Informational: polling is always protected by PostgreSQL advisory locks and the
    # outbox by FOR UPDATE SKIP LOCKED. Keep a single replica anyway because the news
    # worker is not replica-aware.
    worker_single_replica: bool = True
    worker_shutdown_timeout_seconds: float = 8.0  # fits Docker's default 10 s stop timeout

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @field_validator("app_env", mode="before")
    @classmethod
    def _normalize_app_env(cls, value: object) -> str:
        env = str(value or "").strip().lower()
        env = _ENV_ALIASES.get(env, env)
        if env not in ALLOWED_ENVIRONMENTS:
            raise ValueError(f"APP_ENV must be one of {', '.join(ALLOWED_ENVIRONMENTS)} (got {value!r})")
        return env

    @field_validator("trusted_proxies")
    @classmethod
    def _validate_trusted_proxies(cls, value: str) -> str:
        for item in split_csv(value):
            try:
                ipaddress.ip_network(item, strict=False)
            except ValueError as exc:
                raise ValueError(f"TRUSTED_PROXIES entry {item!r} is not an IP address or CIDR network") from exc
        return value

    @field_validator("rate_limit_default", "rate_limit_admin")
    @classmethod
    def _validate_rate_limit(cls, value: str) -> str:
        try:
            parse_many(value)
        except ValueError as exc:
            raise ValueError(f"invalid rate limit {value!r} (expected e.g. '60/minute')") from exc
        return value

    @property
    def cors_allowed_origins(self) -> list[str]:
        return split_csv(self.cors_origins)

    @property
    def is_production(self) -> bool:
        return self.app_env in _PRODUCTION_ENVIRONMENTS

    @property
    def admin_auth_disabled(self) -> bool:
        """True only for local development/test without a configured admin key."""
        return not self.admin_api_key and self.app_env in ("development", "test")

    def production_config_errors(self) -> list[str]:
        """Return the list of fatal configuration problems for production/staging."""
        if not self.is_production:
            return []

        errors: list[str] = []

        if not self.admin_api_key:
            errors.append("ADMIN_API_KEY is required in production/staging")
        elif len(self.admin_api_key) < MIN_ADMIN_API_KEY_LENGTH:
            errors.append(
                f"ADMIN_API_KEY must be at least {MIN_ADMIN_API_KEY_LENGTH} characters "
                "(generate one with: python -c \"import secrets; print(secrets.token_urlsafe(32))\")"
            )

        for name, url in (("DATABASE_URL", self.database_url), ("DATABASE_URL_SYNC", self.database_url_sync)):
            try:
                password = make_url(url).password
            except ArgumentError:
                errors.append(f"{name} is not a valid database URL")
                continue
            if password is not None and password.lower() in _WEAK_DB_PASSWORDS:
                errors.append(f"{name} uses default/weak database credentials")

        if "*" in self.cors_allowed_origins:
            errors.append("CORS_ORIGINS must list explicit origins; '*' is not allowed in production/staging")

        return errors

    def validate_production_config(self) -> None:
        """Fail fast if the production/staging configuration is unsafe."""
        errors = self.production_config_errors()
        if errors:
            for err in errors:
                print(f"FATAL CONFIG ERROR: {err}", file=sys.stderr)
            raise SystemExit(1)


settings = Settings()
settings.validate_production_config()
