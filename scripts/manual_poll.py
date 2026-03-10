"""Manuel poll script: python scripts/manual_poll.py --source kap"""
import argparse
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.core.logging import setup_logging
from src.workers.polling_worker import poll_source, run_all_sources_once


async def main():
    setup_logging()

    parser = argparse.ArgumentParser(description="Manual poll runner")
    parser.add_argument("--source", type=str, default=None, help="Source code to poll (kap, anadoluefes_news, anadoluefes_ir, price)")
    args = parser.parse_args()

    if args.source:
        result = await poll_source(args.source)
        print(f"\nResult: {result}")
    else:
        results = await run_all_sources_once()
        for r in results:
            print(f"\n{r.get('source', 'unknown')}: {r}")


if __name__ == "__main__":
    asyncio.run(main())
