import structlog

from src.adapters.base import BaseAdapter, RawEventData
from src.adapters.utils import run_sync, get_http_client
from src.core.config import settings
from src.db.models import PollingState
from src.parsers.helpers import compute_content_hash, parse_date, clean_whitespace

logger = structlog.get_logger(__name__)


class KAPAdapter(BaseAdapter):
    """KAP bildirimleri: borsapy birincil, /api/disclosures yedek. Multi-stock destekli."""

    def __init__(self, ticker: str = "THYAO"):
        self.ticker = ticker

    def get_source_code(self) -> str:
        return "kap"

    async def fetch(self, polling_state: PollingState | None = None) -> list[RawEventData]:
        events = await self._fetch_via_borsapy()
        if not events:
            logger.warning("borsapy_kap_empty_fallback_to_api", ticker=self.ticker)
            events = await self._fetch_via_kap_api(polling_state)
        return events

    async def _fetch_via_borsapy(self) -> list[RawEventData]:
        try:
            import borsapy as bp

            ticker = await run_sync(bp.Ticker, self.ticker)
            news_df = await run_sync(lambda: ticker.news)

            if news_df is None or news_df.empty:
                logger.info("borsapy_kap_no_data", ticker=self.ticker)
                return []

            events: list[RawEventData] = []
            for _, row in news_df.iterrows():
                title = clean_whitespace(str(row.get("Title", "")))
                url = str(row.get("URL", ""))
                date_str = str(row.get("Date", ""))
                published_at = parse_date(date_str)

                external_id = ""
                if "/Bildirim/" in url:
                    external_id = url.split("/Bildirim/")[-1].strip("/")

                content_hash = compute_content_hash(
                    url, title, published_at.isoformat() if published_at else ""
                )

                events.append(
                    RawEventData(
                        external_id=external_id,
                        canonical_url=url,
                        source_event_type="KAP_DISCLOSURE",
                        title=title,
                        summary=title,
                        published_at=published_at,
                        content_hash=content_hash,
                        raw_payload_json={"source": "borsapy", "date": date_str, "title": title, "url": url, "ticker": self.ticker},
                    )
                )

            logger.info("borsapy_kap_fetched", ticker=self.ticker, count=len(events))
            return events

        except Exception as e:
            logger.error("borsapy_kap_error", ticker=self.ticker, error=str(e))
            return []

    async def _fetch_via_kap_api(self, polling_state: PollingState | None = None) -> list[RawEventData]:
        try:
            url = "https://www.kap.org.tr/tr/api/disclosures"
            if polling_state and polling_state.last_seen_external_id:
                url = f"{url}?afterDisclosureIndex={polling_state.last_seen_external_id}"

            client = get_http_client()
            resp = await client.get(url)
            resp.raise_for_status()

            data = resp.json()
            if not isinstance(data, list):
                logger.warning("kap_api_unexpected_format", type=type(data).__name__)
                return []

            events: list[RawEventData] = []
            for item in data:
                basic = item.get("basic", {})
                stock_codes = str(basic.get("stockCodes", ""))
                if self.ticker not in stock_codes:
                    continue

                disclosure_index = str(basic.get("disclosureIndex", ""))
                title = clean_whitespace(str(basic.get("title", "")))
                published_at_str = str(basic.get("publishDate", basic.get("disclosureDate", "")))
                published_at = parse_date(published_at_str)

                detail_url = f"https://www.kap.org.tr/tr/Bildirim/{disclosure_index}"
                content_hash = compute_content_hash(
                    detail_url, title, published_at.isoformat() if published_at else ""
                )

                events.append(
                    RawEventData(
                        external_id=disclosure_index,
                        canonical_url=detail_url,
                        source_event_type="KAP_DISCLOSURE",
                        title=title,
                        summary=title,
                        published_at=published_at,
                        content_hash=content_hash,
                        raw_payload_json=item,
                        http_status=resp.status_code,
                    )
                )

            logger.info("kap_api_fetched", ticker=self.ticker, count=len(events))
            return events

        except Exception as e:
            logger.error("kap_api_error", ticker=self.ticker, error=str(e))
            return []
