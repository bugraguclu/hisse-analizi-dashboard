"""Worker entrypoint: polling, notification, news and data-platform loops.

Run with: python -m src.workers.run_workers

CONCURRENCY SAFETY:
- Source polling is serialized per source by PostgreSQL advisory locks (also against
  the API's admin poll/backfill triggers); outbox entries are claimed with
  SELECT ... FOR UPDATE SKIP LOCKED and notifications are deduplicated by a unique
  constraint. The news and data-platform loops are not replica-aware, so run exactly
  ONE worker replica (WORKER_SINGLE_REPLICA=true, docker-compose replicas: 1).

DATA-PLATFORM LOOPS (docs/data-platform.md):
- market_loop (quotes, daily bars, reconciliation, backfill), fundamentals_loop
  (statements → facts → ratios), reference_loop (universe sync, dividends, holders,
  targets, KAP calendar), macro_loop (TCMB rates, inflation, FX bulletins) and
  quality_loop (cross-source checks, freshness). Each lives in its own module and
  is optional: a missing module is logged and skipped, so the worker keeps running
  during partial deployments.

SHUTDOWN:
- SIGTERM/SIGINT stop the cooperative loops (the current company poll / outbox
  entry / job finishes; nothing new starts), waiting at most
  WORKER_SHUTDOWN_TIMEOUT_SECONDS. The news loop is cancelled. Finally the
  shared HTTP client and the DB connection pool are closed.
- Exit code 0 on a requested shutdown, 1 if a loop crashed.
"""

import asyncio
import importlib
import signal
import sys
from collections.abc import Callable, Coroutine
from typing import Any

import structlog

from src.adapters.utils import close_http_client
from src.core.config import settings
from src.core.logging import setup_logging
from src.db.session import dispose_engine
from src.workers.news_worker import news_loop
from src.workers.notification_worker import notification_loop
from src.workers.polling_worker import polling_loop

logger = structlog.get_logger(__name__)

# (task name, module, loop function) — every loop takes the shared stop event.
DATA_PLATFORM_LOOPS: tuple[tuple[str, str, str], ...] = (
    ("market", "src.workers.market_worker", "market_loop"),
    ("fundamentals", "src.workers.fundamentals_worker", "fundamentals_loop"),
    ("reference", "src.workers.reference_worker", "reference_loop"),
    ("macro", "src.workers.macro_worker", "macro_loop"),
    ("quality", "src.workers.quality_worker", "quality_loop"),
)

LoopFactory = Callable[[asyncio.Event], Coroutine[Any, Any, None]]


def load_data_platform_loops() -> list[tuple[str, LoopFactory]]:
    """Resolve the optional data-platform loops; missing modules are skipped."""
    loops: list[tuple[str, LoopFactory]] = []
    for name, module_name, attribute in DATA_PLATFORM_LOOPS:
        try:
            module = importlib.import_module(module_name)
            loop = getattr(module, attribute)
        except (ImportError, AttributeError) as e:
            logger.warning("data_platform_loop_unavailable", loop=name, module=module_name, error=str(e))
            continue
        loops.append((name, loop))
    return loops


def _install_signal_handlers(stop: asyncio.Event) -> None:
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            loop.add_signal_handler(sig, _request_stop, stop, sig)
        except (NotImplementedError, RuntimeError):  # e.g. Windows
            pass


def _request_stop(stop: asyncio.Event, sig: signal.Signals) -> None:
    if not stop.is_set():
        logger.info("worker_shutdown_requested", signal=sig.name)
        stop.set()


async def main() -> int:
    setup_logging()
    stop = asyncio.Event()
    _install_signal_handlers(stop)
    crashed = False

    def _on_done(task: asyncio.Task[None]) -> None:
        nonlocal crashed
        if task.cancelled() or task.exception() is None:
            return
        crashed = True
        logger.error("worker_task_crashed", task=task.get_name(), error=repr(task.exception()))
        stop.set()

    cooperative = [
        asyncio.create_task(polling_loop(stop), name="polling"),
        asyncio.create_task(notification_loop(stop), name="notifications"),
    ]
    for name, loop_factory in load_data_platform_loops():
        cooperative.append(asyncio.create_task(loop_factory(stop), name=name))
    cancellable = [
        asyncio.create_task(news_loop(), name="news"),
    ]
    for task in (*cooperative, *cancellable):
        task.add_done_callback(_on_done)
    logger.info(
        "worker_started",
        single_replica=settings.worker_single_replica,
        loops=[task.get_name() for task in (*cooperative, *cancellable)],
    )

    await stop.wait()

    for task in cancellable:
        task.cancel()
    _done, pending = await asyncio.wait(cooperative, timeout=settings.worker_shutdown_timeout_seconds)
    for task in pending:
        logger.warning("worker_task_forced_stop", task=task.get_name())
        task.cancel()
    await asyncio.gather(*cooperative, *cancellable, return_exceptions=True)

    await close_http_client()
    await dispose_engine()
    logger.info("worker_stopped", crashed=crashed)
    return 1 if crashed else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
