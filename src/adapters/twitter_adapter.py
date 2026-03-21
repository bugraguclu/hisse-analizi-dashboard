"""Twitter/X adaptoru — finansal asset ile ilgili tweet arama."""

import structlog

from src.adapters.utils import cached, df_to_records, run_sync, TTL_MARKET

logger = structlog.get_logger(__name__)


@cached(TTL_MARKET, "twitter")
async def get_tweets(ticker: str, limit: int = 20) -> dict:
    """Belirli bir hisse icin tweet'leri getir."""
    try:
        import borsapy as bp
        t = await run_sync(lambda: bp.Ticker(ticker))
        tweets = await run_sync(lambda: t.tweets)
        if tweets is None:
            return {"ticker": ticker, "tweets": []}
        if hasattr(tweets, "iterrows"):
            records = df_to_records(tweets.head(limit))
            return {"ticker": ticker, "count": len(records), "tweets": records}
        if isinstance(tweets, list):
            return {"ticker": ticker, "count": len(tweets[:limit]), "tweets": tweets[:limit]}
        return {"ticker": ticker, "tweets": []}
    except Exception as e:
        logger.error("twitter_error", ticker=ticker, error=str(e))
        return {"ticker": ticker, "tweets": [], "error": str(e)}
