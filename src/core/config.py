import sys

from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "postgresql+asyncpg://hisse:hisse@localhost:5432/hisse_analizi"
    database_url_sync: str = "postgresql://hisse:hisse@localhost:5432/hisse_analizi"

    tz: str = "Europe/Istanbul"
    default_poll_interval_seconds: int = 30
    user_agent: str = "HisseAnalizi/1.0"
    log_level: str = "INFO"

    # Admin authentication — required in non-dev environments
    admin_api_key: str = ""

    # CORS — comma-separated origins; defaults to localhost for dev
    cors_origins: str = "http://localhost:3000,http://localhost:8000"

    # Rate limiting
    rate_limit_default: str = "60/minute"
    rate_limit_admin: str = "20/minute"
    rate_limit_expensive: str = "30/minute"

    # SMTP
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from: str = "noreply@example.com"
    smtp_use_tls: bool = True
    enable_real_email: bool = False

    # HTTP
    http_connect_timeout: float = 15.0
    http_read_timeout: float = 30.0

    # Backoff
    backoff_base_seconds: int = 60
    backoff_max_seconds: int = 900
    backoff_factor: int = 2
    max_consecutive_failures: int = 5

    # Worker concurrency
    worker_max_concurrency: int = 5
    worker_single_replica: bool = True  # TEMPORARY: set to False only after implementing advisory locks

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}

    @property
    def cors_allowed_origins(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env in ("production", "staging")

    def validate_production_config(self) -> None:
        """Fail fast if required production secrets are missing."""
        if not self.is_production:
            return

        errors: list[str] = []

        if not self.admin_api_key:
            errors.append("ADMIN_API_KEY is required in production/staging")

        if self.database_url == "postgresql+asyncpg://hisse:hisse@localhost:5432/hisse_analizi":
            errors.append("DATABASE_URL appears to use default dev credentials in production")

        if errors:
            for err in errors:
                print(f"FATAL CONFIG ERROR: {err}", file=sys.stderr)
            sys.exit(1)


settings = Settings()
settings.validate_production_config()
