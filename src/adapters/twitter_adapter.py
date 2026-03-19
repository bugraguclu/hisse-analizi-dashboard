"""Twitter/X adaptoru — finansal asset ile ilgili tweet arama."""

import asyncio

import structlog

logger = structlog.get_logger(__name__)


async def get_tweets(ticker: str, limit: int = 20) -> dict:
    """Belirli bir hisse icin tweet'leri getir."""
    try:
        import borsapy as bp
        loop = asyncio.get_event_loop()
        t = await loop.run_in_executor(None, lambda: bp.Ticker(ticker))
        tweets = await loop.run_in_executor(None, lambda: t.tweets)
        if tweets is None:
            return {"ticker": ticker, "tweets": []}
        if hasattr(tweets, "iterrows"):
            records = tweets.head(limit).reset_index().to_dict(orient="records")
            return {"ticker": ticker, "count": len(records), "tweets": records}
        if isinstance(tweets, list):
            return {"ticker": ticker, "count": len(tweets[:limit]), "tweets": tweets[:limit]}
        return {"ticker": ticker, "tweets": []}
    except Exception as e:
        logger.error("twitter_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "tweets": [], "error": str(e)}
