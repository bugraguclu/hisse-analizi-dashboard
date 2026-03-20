import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, update
from src.db.session import async_session_factory
from src.db.models import NormalizedEvent
from src.services.event_service import EventService

async def backfill_classification():
    """Mevcut tüm haberleri yeni keyword mantığı ile tekrar sınıflandırır."""
    async with async_session_factory() as session:
        event_service = EventService(session)
        
        # Tüm olayları çek
        result = await session.execute(select(NormalizedEvent))
        events = result.scalars().all()
        
        print(f"Total events found: {len(events)}")
        updated_count = 0
        
        for event in events:
            old_category = event.category
            new_category = event_service._classify_event(event.title or "", event.excerpt or event.body_text)
            
            if old_category != new_category:
                event.category = new_category
                updated_count += 1
        
        await session.commit()
        print(f"Backfill completed. Updated {updated_count} events.")

if __name__ == "__main__":
    asyncio.run(backfill_classification())
