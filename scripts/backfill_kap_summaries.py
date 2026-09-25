"""Backfill stored KAP events with KAP list data and re-classify every event.

Events stored before the KAP list endpoint was used carry only the disclosure form name
("Özel Durum Açıklaması (Genel)"). This script downloads KAP's disclosure list one
Istanbul day at a time (one request per day, spaced by the adapter) and adds the KAP
summary, publisher and correction/attachment flags to the matching events, then re-runs
severity/category classification on all events so the new categories apply everywhere.

Idempotent and resumable (``--since`` / ``--until``). KAP's WAF is respected: a failed
day waits out the adapter cooldown and is retried a few times before it is skipped.

Usage:
    python scripts/backfill_kap_summaries.py [--since 2026-02-01] [--until 2026-09-23] [--dry-run]
"""

import argparse
import asyncio
import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import func, select  # noqa: E402

from src.adapters import kap  # noqa: E402
from src.db.models import NormalizedEvent  # noqa: E402
from src.db.session import async_session_factory, dispose_engine  # noqa: E402
from src.services.event_service import enrich_kap_events, reclassify_events  # noqa: E402

_DAY_ATTEMPTS = 3
# KAP's WAF drops the connection after roughly a hundred requests in a couple of minutes.
_DEFAULT_DELAY_SECONDS = 4.0


async def _first_event_day() -> date | None:
    async with async_session_factory() as session:
        first = (
            await session.execute(select(func.min(NormalizedEvent.published_at)).where(NormalizedEvent.source_code == "kap"))
        ).scalar_one_or_none()
    return kap.istanbul_today(first) if first is not None else None


async def _fetch_day(day: date) -> list[dict] | None:
    for attempt in range(1, _DAY_ATTEMPTS + 1):
        try:
            return await kap.fetch_disclosure_list(day, day)
        except kap.KapUnavailableError as e:
            wait = kap._FAILURE_COOLDOWN_SECONDS + 5
            print(f"  {day}: KAP unavailable (attempt {attempt}/{_DAY_ATTEMPTS}): {e}; waiting {wait}s", flush=True)
            if attempt < _DAY_ATTEMPTS:
                await asyncio.sleep(wait)
    return None


async def backfill(
    since: date | None, until: date | None, *, dry_run: bool, reclassify: bool, delay: float = _DEFAULT_DELAY_SECONDS
) -> int:
    try:
        start = since or await _first_event_day()
        end = until or kap.istanbul_today()
        if start is None:
            print("No KAP events stored; nothing to backfill.")
            return 0
        totals = {"days": 0, "disclosures": 0, "matched": 0, "updated": 0}
        skipped: list[date] = []
        day = start
        while day <= end:
            items = await _fetch_day(day)
            if items is None:
                skipped.append(day)
            else:
                async with async_session_factory() as session:
                    stats = await enrich_kap_events(session, items)
                    if dry_run:
                        await session.rollback()
                    else:
                        await session.commit()
                totals["days"] += 1
                for key in ("disclosures", "matched", "updated"):
                    totals[key] += stats[key]
                print(f"  {day}: {len(items)} disclosures on KAP, {stats['matched']} stored rows, {stats['updated']} updated", flush=True)
            day += timedelta(days=1)
            if day <= end:
                await asyncio.sleep(delay)

        print(f"Enrichment {'(dry run) ' if dry_run else ''}done: {totals}")
        if skipped:
            print(f"Skipped days (KAP unavailable), re-run with --since/--until: {[d.isoformat() for d in skipped]}")

        if reclassify:
            async with async_session_factory() as session:
                result = await reclassify_events(session, dry_run=dry_run)
            print(
                f"Reclassification {'(dry run) ' if dry_run else ''}: scanned={result['scanned']} changed={result['changed']} "
                f"severity={result['severity_changes']} category={result['category_changes']}"
            )
        return 1 if skipped else 0
    finally:
        await dispose_engine()


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--since", type=date.fromisoformat, help="first Istanbul day (default: oldest stored KAP event)")
    parser.add_argument("--until", type=date.fromisoformat, help="last Istanbul day (default: today)")
    parser.add_argument("--dry-run", action="store_true", help="report changes without writing")
    parser.add_argument("--no-reclassify", action="store_true", help="skip the final reclassification of all events")
    parser.add_argument(
        "--delay", type=float, default=_DEFAULT_DELAY_SECONDS, help="seconds between days (KAP rate limit)"
    )
    return parser.parse_args()


if __name__ == "__main__":
    args = _parse_args()
    sys.exit(
        asyncio.run(
            backfill(args.since, args.until, dry_run=args.dry_run, reclassify=not args.no_reclassify, delay=args.delay)
        )
    )
