from pydantic_settings import BaseSettings
from pydantic import Field


class Settings(BaseSettings):
    app_env: str = "development"
    database_url: str = "postgresql+asyncpg://assistant:assistant@localhost:5432/financial_assistant"
    database_url_sync: str = "postgresql://assistant:assistant@localhost:5432/financial_assistant"

    tz: str = "Europe/Istanbul"
    default_poll_interval_seconds: int = 30
    user_agent: str = "FinancialAssistant/1.0"
    log_level: str = "INFO"

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

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
