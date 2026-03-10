"""Worker entrypoint: polling + notification loops."""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

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
