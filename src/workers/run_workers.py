"""Worker entrypoint: polling + notification loops.

Run with: python -m src.workers.run_workers

CONCURRENCY SAFETY:
- Default mode (WORKER_SINGLE_REPLICA=true): Run exactly ONE worker replica.
  Enforce via docker-compose replicas=1 or process manager.
- Multi-replica mode (WORKER_SINGLE_REPLICA=false): Multiple workers are safe.
  PostgreSQL advisory locks prevent duplicate source polling.
  Outbox entries are claimed via SELECT ... FOR UPDATE SKIP LOCKED.
  Notifications are deduplicated via DB unique constraint.
"""

import asyncio

from src.core.logging import setup_logging
from src.workers.polling_worker import polling_loop
from src.workers.notification_worker import notification_loop


async def main():
    setup_logging()
    await asyncio.gather(
        polling_loop(),
        notification_loop(),
    )


if __name__ == "__main__":
    asyncio.run(main())
