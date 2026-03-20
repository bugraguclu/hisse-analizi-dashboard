import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.db.session import async_session_factory
from src.db.models import PollingState
from sqlalchemy import update

async def reset():
    async with async_session_factory() as session:
        await session.execute(update(PollingState).values(consecutive_failures=0, last_error=None))
        await session.commit()
        print('Polling failures reset successfully.')

if __name__ == '__main__':
    asyncio.run(reset())
