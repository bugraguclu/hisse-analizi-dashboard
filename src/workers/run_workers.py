"""Worker entrypoint: polling, notification and news loops.

Run with: python -m src.workers.run_workers

CONCURRENCY SAFETY:
- Source polling is serialized per source by PostgreSQL advisory locks (also against
  the API's admin poll/backfill triggers); outbox entries are claimed with
  SELECT ... FOR UPDATE SKIP LOCKED and notifications are deduplicated by a unique
  constraint. The news worker is not replica-aware, so run exactly
  ONE worker replica (WORKER_SINGLE_REPLICA=true, docker-compose replicas: 1).

SHUTDOWN:
- SIGTERM/SIGINT stop the polling and notification loops cooperatively (the current
  company poll / outbox entry finishes; nothing new starts), waiting at most
  WORKER_SHUTDOWN_TIMEOUT_SECONDS. The news loop is cancelled. Finally the
  shared HTTP client and the DB connection pool are closed.
- Exit code 0 on a requested shutdown, 1 if a loop crashed.
"""

import asyncio
import signal
import sys

import structlog

from src.adapters.utils import close_http_client
from src.core.config import settings
from src.core.logging import setup_logging
from src.db.session import dispose_engine
from src.workers.news_worker import news_loop
from src.workers.notification_worker import notification_loop
from src.workers.polling_worker import polling_loop

logger = structlog.get_logger(__name__)


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
    cancellable = [
        asyncio.create_task(news_loop(), name="news"),
    ]
    for task in (*cooperative, *cancellable):
        task.add_done_callback(_on_done)
    logger.info("worker_started", single_replica=settings.worker_single_replica)

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
