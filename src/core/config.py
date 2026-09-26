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

    # Haber toplama (Faz 2)
    news_poll_enabled: bool = True
    news_poll_interval_seconds: int = 900  # 15 dakika
    news_fetch_concurrency: int = 4

    # Worker concurrency
    worker_max_concurrency: int = 5
    # Informational: polling is always protected by PostgreSQL advisory locks and the
    # outbox by FOR UPDATE SKIP LOCKED. Keep a single replica anyway because the news
    # worker is not replica-aware.
    worker_single_replica: bool = True
    worker_shutdown_timeout_seconds: float = 8.0  # fits Docker's default 10 s stop timeout

    # Market store (data-infra WS2): quotes + daily bars (src/workers/market_worker.py) and
    # store-first reads (src/services/market_service.py). Times are Europe/Istanbul, weekdays.
    market_store_enabled: bool = True  # false = live-only reads (pre data-platform behaviour)
    market_store_timeout_seconds: float = 3.0  # a store read slower than this falls back to live
    market_quote_interval_seconds: int = 60  # quotes + running daily bar refresh inside the window
    market_session_open: str = "09:55"  # quote polling window (opening auction ... closing auction)
    market_session_close: str = "18:20"  # one more run follows once the session is final (18:30)
    market_quote_max_age_seconds: int = 180  # in session: older stored quotes are refreshed live
    market_bar_max_age_seconds: int = 300  # in session: older running bars are refreshed from the quote
    market_isy_fallback_max_symbols: int = 60  # İş Yatırım OneEndeks requests per quote cycle
    market_daily_bars_after: str = "18:40"  # final daily bars job (after the closing-price session)
    market_reconcile_after: str = "20:00"  # İş Yatırım reconciliation (turnover, VWAP, close checks)
    market_reconcile_days: int = 10  # calendar days re-checked per reconciliation
    market_reconcile_concurrency: int = 2
    market_backfill_enabled: bool = True
    market_backfill_core_years: int = 5  # history kept for tracking_tier=core
    market_backfill_universe_years: int = 2  # history kept for the rest of the universe
    market_backfill_batch_size: int = 40  # symbols per backfill pass (TradingView ~3 s/symbol)
    market_backfill_max_seconds: float = 300.0  # time budget of one backfill pass
    market_backfill_delay_seconds: float = 1.0  # pause between symbols (TradingView websocket)
    market_backfill_idle_seconds: int = 3600  # re-check interval once every symbol is covered

    # Macro store (data-infra WS4): TCMB rates/corridor, TÜİK CPI/PPI, FX bulletins.
    # Freshness windows for the store-first service (src/services/macro_service.py);
    # "age" is time since we last *checked* the provider, not the observation's own date
    # (a policy rate decision can be legitimately months old and still be the latest one).
    macro_max_age_rates_hours: float = 6.0
    macro_max_age_inflation_hours: float = 12.0
    macro_max_age_fx_peak_hours: float = 1.0  # 15:00-16:30 Istanbul (around the ~15:30 bulletin)
    macro_max_age_fx_offpeak_hours: float = 6.0
    macro_fx_backfill_days: int = 730  # ~2 years of calendar days (weekends skipped up front)
    macro_fx_archive_concurrency: int = 6
    # EVDS3 (evds3.tcmb.gov.tr) is optional: pulling series *values* needs a free key
    # (https://evds3.tcmb.gov.tr -> BENIM SAYFAM); catalogue browsing does not. Empty
    # (default) disables src/adapters/evds_adapter.py — only tcmb.*/tuik.* are stored.
    macro_evds_api_key: str = ""

    # Fundamentals store (data-infra WS3): KAP financial summary + İş Yatırım MaliTablo →
    # financial_statements / financial_facts / financial_ratios (src/services/fundamentals_service.py).
    # API reads are store-first: a company's statements are "fresh" for this long after the
    # last successful refresh (live fetch + store when older; stale copy when the provider fails).
    fundamentals_max_age_statements_hours: float = 72.0
    fundamentals_max_age_ratios_hours: float = 36.0
    # Worker cadence (src/workers/fundamentals_worker.py): per-company statement refresh.
    fundamentals_refresh_core_hours: float = 72.0  # tracking_tier = core (BIST 100)
    fundamentals_refresh_universe_hours: float = 336.0  # everything else (14 days)
    fundamentals_retry_failed_hours: float = 6.0  # after a failed refresh attempt
    fundamentals_batch_size: int = 12  # companies per worker iteration
    fundamentals_loop_interval_seconds: int = 600
    fundamentals_ratios_hour: int = 19  # daily ratio job after this Istanbul hour (final closes)
    # kap.org.tr WAF blocks an IP for ~6 min after ~100 requests / 2 min: one request at a
    # time, at least this many seconds apart (per process), and a cool-down after a block.
    fundamentals_kap_min_interval_seconds: float = 3.0
    fundamentals_kap_block_seconds: float = 420.0
    fundamentals_isy_concurrency: int = 3  # İş Yatırım MaliTablo companies fetched in parallel
    fundamentals_live_timeout_seconds: float = 30.0  # API request waits at most this for a refresh
    fundamentals_quote_max_age_hours: float = 96.0  # quotes-table price accepted for ratios
    fundamentals_worker_enabled: bool = True

    # Reference data (data-infra WS1): company universe + index memberships
    # (src/services/universe_service.py) and per-company reference datasets — dividends,
    # capital increases, holders, analyst targets, KAP calendar (src/services/reference_service.py,
    # src/workers/reference_worker.py). Times are Europe/Istanbul.
    reference_worker_enabled: bool = True
    reference_universe_sync_time: str = "07:30"  # daily universe.sync (HH:MM Istanbul)
    reference_universe_stale_hours: float = 20.0  # on worker start: sync if the last good run is older
    reference_extra_core_tickers: str = ""  # comma-separated tickers kept core besides XU100 members
    reference_company_refresh_days: float = 7.0  # reference.company: each core company at most this often
    reference_retry_failed_hours: float = 6.0  # a company whose refresh failed waits this long
    reference_tick_seconds: int = 900  # worker wake-up interval (spreads the refreshes over the day)
    reference_batch_size: int = 2  # companies refreshed per tick
    reference_concurrency: int = 2  # companies refreshed in parallel (İş Yatırım ~10 s/company)
    reference_company_delay_seconds: float = 5.0  # pause after each company (polite to providers)
    reference_once_max_companies: int = 10  # run_reference_once() without tickers: due companies
    reference_max_age_hours: float = 24.0  # API: stored dividends/recommendations/targets/calendar
    reference_holders_max_age_hours: float = 168.0  # API: stored ownership structure
    reference_isin_sample_size: int = 10  # universe.sync: ISINs cross-checked with ISIN Türkiye (MKK)

    # Platform quality (data-infra WS6): last-good-copy store (data_snapshots), cross-source/
    # freshness checks (data_quality_checks, src/services/quality_service.py) and /data/status.
    # Times are Europe/Istanbul.
    quality_worker_enabled: bool = True
    quality_daily_run_time: str = "19:30"  # after daily bars/ratios/fx have landed
    quality_stale_run_hours: float = 24.0  # on worker start: run now if the last good run is older
    quality_retention_days: int = 90  # data_quality_checks rows older than this are purged
    quality_ingestion_retention_days: int = 30  # ingestion_runs rows older than this are purged
    quality_snapshot_purge_grace_days: int = 14  # data_snapshots kept this long past expires_at
    quality_refresh_timeout_seconds: float = 120.0  # POST /admin/data/refresh time budget
    # Freshness thresholds (see docs/data-platform.md §7 for the full catalogue).
    quality_quotes_session_warn_minutes: float = 20.0  # in trading hours
    quality_quotes_session_fail_minutes: float = 60.0
    quality_quotes_offsession_warn_hours: float = 48.0  # outside trading hours (incl. weekends)
    quality_quotes_offsession_fail_hours: float = 120.0
    quality_fundamentals_coverage_warn_pct: float = 80.0  # core companies with a recent statement
    quality_fundamentals_coverage_fail_pct: float = 50.0
    quality_macro_cadence_default_days: int = 45  # fallback for series without an explicit policy
    quality_ingestion_default_interval_hours: float = 24.0  # ingestion.health: "no run in 2x this"
    quality_integrity_fail_threshold: int = 5  # violating rows beyond this -> fail instead of warn
    quality_stale_active_company_days: int = 3  # is_active company with no quote in N days -> warn
    quality_price_crosscheck_symbols: int = 5  # cross_source.price_isyatirim: random core symbols
    quality_price_crosscheck_bars: int = 10  # ... over this many recent daily bars
    quality_price_crosscheck_warn_pct: float = 2.0  # relative deviation vs HGDG_KAPANIS
    quality_price_crosscheck_fail_pct: float = 5.0
    quality_price_crosscheck_timeout_seconds: float = 20.0

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
