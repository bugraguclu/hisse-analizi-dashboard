import httpx
import structlog
from bs4 import BeautifulSoup

from src.adapters.base import BaseAdapter, RawEventData
from src.core.config import settings
from src.db.models import PollingState
from src.parsers.helpers import compute_content_hash, clean_whitespace

logger = structlog.get_logger(__name__)

IR_URL = "https://www.anadoluefes.com/sayfa/1/652/yatirimci-iliskileri"
BASE_URL = "https://www.anadoluefes.com"


class AnadoluEfesIRAdapter(BaseAdapter):
    """Anadolu Efes yatırımcı ilişkileri sayfası scraper."""

    def get_source_code(self) -> str:
        return "anadoluefes_ir"

    async def fetch(self, ticker: str, polling_state: PollingState | None = None) -> list[RawEventData]:
        if ticker != "AEFES":
            return []
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(
                    connect=settings.http_connect_timeout,
                    read=settings.http_read_timeout,
                ),
                headers={"User-Agent": settings.user_agent},
                follow_redirects=True,
            ) as client:
                resp = await client.get(IR_URL)
                resp.raise_for_status()

            soup = BeautifulSoup(resp.text, "lxml")
            events: list[RawEventData] = []

            # Find all PDF/document links
            for link in soup.find_all("a", href=True):
                href = str(link.get("href", ""))
                is_doc = any(ext in href.lower() for ext in [".pdf", ".doc", ".docx", ".xls", ".xlsx"])
                is_ir_page = "/sayfa/" in href or "/yatirimci" in href.lower()

                if not (is_doc or is_ir_page):
                    continue

                canonical_url = href if href.startswith("http") else f"{BASE_URL}{href}"
                title = clean_whitespace(link.get_text(strip=True))
                if not title or len(title) < 3:
                    title = href.split("/")[-1]

                doc_type = "pdf" if ".pdf" in href.lower() else "page"
                content_hash = compute_content_hash(canonical_url, title, "")

                attachment_urls = [canonical_url] if is_doc else []

                events.append(
                    RawEventData(
                        canonical_url=canonical_url,
                        source_event_type="OFFICIAL_IR_UPDATE",
                        title=title,
                        summary=title,
                        content_hash=content_hash,
                        raw_payload_json={"document_type": doc_type, "ir_page": IR_URL},
                        attachment_urls=attachment_urls,
                        http_status=resp.status_code,
                    )
                )

            logger.info("anadoluefes_ir_fetched", count=len(events))
            return events

        except Exception as e:
            logger.error("anadoluefes_ir_error", error=str(e))
            return []
