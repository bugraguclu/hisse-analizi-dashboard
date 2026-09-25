import logging
from typing import cast

import structlog
from structlog.typing import FilteringBoundLogger, Processor

from src.core.config import settings

_LEVELS = logging.getLevelNamesMapping()


def resolve_log_level(name: str) -> int:
    """Map a level name such as ``"debug"`` to its numeric value (unknown -> INFO)."""
    return _LEVELS.get(str(name).strip().upper(), logging.INFO)


def setup_logging() -> None:
    pretty = settings.app_env == "development"
    processors: list[Processor] = [
        structlog.contextvars.merge_contextvars,
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
    ]
    if pretty:
        # ConsoleRenderer formats exc_info itself (pretty tracebacks).
        processors.append(structlog.dev.ConsoleRenderer())
    else:
        processors += [structlog.processors.format_exc_info, structlog.processors.JSONRenderer()]

    structlog.configure(
        processors=processors,
        wrapper_class=structlog.make_filtering_bound_logger(resolve_log_level(settings.log_level)),
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(name: str | None = None) -> FilteringBoundLogger:
    return cast(FilteringBoundLogger, structlog.get_logger(name))
