import httpx
import structlog
from bs4 import BeautifulSoup

from src.adapters.base import BaseAdapter, RawEventData
from src.core.config import settings
from src.db.models import PollingState
from src.parsers.helpers import compute_content_hash, parse_date, clean_whitespace, strip_html

logger = structlog.get_logger(__name__)

NEWS_URLS = [
    "https://www.anadoluefes.com/haber-liste/247",   # Kurumsal Haberler
    "https://www.anadoluefes.com/haber-liste/717",   # Basında Anadolu Efes
]
BASE_URL = "https://www.anadoluefes.com"


class AnadoluEfesNewsAdapter(BaseAdapter):
    """Anadolu Efes resmi site haberleri scraper."""

    def get_source_code(self) -> str:
        return "anadoluefes_news"

    async def fetch(self, ticker: str, polling_state: PollingState | None = None) -> list[RawEventData]:
        if ticker != "AEFES":
            return []
        all_events: list[RawEventData] = []

        async with httpx.AsyncClient(
            timeout=httpx.Timeout(
                connect=settings.http_connect_timeout,
                read=settings.http_read_timeout,
            ),
            headers={"User-Agent": settings.user_agent},
            follow_redirects=True,
        ) as client:
            for page_url in NEWS_URLS:
                try:
                    events = await self._fetch_page(client, page_url)
                    all_events.extend(events)
                except Exception as e:
                    logger.error("anadoluefes_news_page_error", url=page_url, error=str(e))

        logger.info("anadoluefes_news_fetched", count=len(all_events))
        return all_events

    async def _fetch_page(self, client: httpx.AsyncClient, page_url: str) -> list[RawEventData]:
        resp = await client.get(page_url)
        resp.raise_for_status()

        soup = BeautifulSoup(resp.text, "lxml")
        events: list[RawEventData] = []

        news_links = soup.find_all("a", href=True)
        for link in news_links:
            href = str(link.get("href", ""))
            if "/haber/" not in href:
                continue

            canonical_url = href if href.startswith("http") else f"{BASE_URL}{href}"
            title = clean_whitespace(link.get_text(strip=True))
            if not title:
                continue

            # Try to get date from parent or sibling elements
            date_text = ""
            parent = link.find_parent()
            if parent:
                date_el = parent.find(class_=lambda c: c and "date" in str(c).lower()) if parent else None
                if date_el:
                    date_text = date_el.get_text(strip=True)

            published_at = parse_date(date_text) if date_text else None
            content_hash = compute_content_hash(
                canonical_url, title, published_at.isoformat() if published_at else ""
            )

            # Fetch detail page for body
            body_text = ""
            try:
                detail_resp = await client.get(canonical_url)
                if detail_resp.status_code == 200:
                    detail_soup = BeautifulSoup(detail_resp.text, "lxml")
                    content_div = (
                        detail_soup.find("div", class_="content-detail")
                        or detail_soup.find("div", class_="news-detail")
                        or detail_soup.find("article")
                        or detail_soup.find("div", class_="detail")
                    )
                    if content_div:
                        body_text = strip_html(content_div.get_text(separator=" ", strip=True))
            except Exception as e:
                logger.warning("anadoluefes_detail_error", url=canonical_url, error=str(e))

            category = "kurumsal" if "247" in page_url else "basinda"
            events.append(
                RawEventData(
                    canonical_url=canonical_url,
                    source_event_type="OFFICIAL_NEWS",
                    title=title,
                    summary=body_text[:500] if body_text else title,
                    published_at=published_at,
                    content_hash=content_hash,
                    raw_payload_json={"category": category, "page_url": page_url},
                    body_text=body_text,
                    http_status=resp.status_code,
                )
            )

        return events
