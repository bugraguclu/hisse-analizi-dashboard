"""Google News RSS adapter'i (Faz 2).

Hisse bazli haber toplama: Google News'un halka acik RSS arama beslemesinden
baslik, kaynak URL, yayin tarihi ve kisa aciklama ceker (kullanim kosullarina
uygun — tam icerik indirilmez, yalnizca RSS meta verisi).
"""

from __future__ import annotations

import html
import re
from datetime import datetime, timezone
from urllib.parse import quote

import structlog
from bs4 import BeautifulSoup
from dateutil import parser as date_parser

from src.adapters.utils import get_http_client

logger = structlog.get_logger(__name__)

_RSS_URL = "https://news.google.com/rss/search?q={query}&hl=tr&gl=TR&ceid=TR:tr"
_TAG_RE = re.compile(r"<[^>]+>")


def _clean(text: str | None) -> str:
    """HTML etiketlerini ve entity'leri temizler."""
    if not text:
        return ""
    return html.unescape(_TAG_RE.sub("", text)).strip()


def build_query(ticker: str, company_name: str) -> str:
    """Sirket icin arama sorgusu: tam ad VEYA 'TICKER hisse'."""
    name = company_name.strip()
    # Cok uzun unvanlarda ilk 4 kelime yeterli (BIST unvanlari 'A.S.' vb. ile biter)
    words = name.split()
    if len(words) > 4:
        name = " ".join(words[:4])
    return f'"{name}" OR "{ticker} hisse"'


async def fetch_news(ticker: str, company_name: str, limit: int = 20) -> list[dict]:
    """Bir hisse icin Google News RSS sonuclarini dondurur.

    Donen kayit: {title, url, snippet, source_name, published_at}
    """
    query = build_query(ticker, company_name)
    url = _RSS_URL.format(query=quote(query))
    try:
        client = get_http_client()
        resp = await client.get(url)
        resp.raise_for_status()
    except Exception as e:
        logger.warning("news_rss_fetch_error", ticker=ticker, error=str(e))
        return []

    try:
        soup = BeautifulSoup(resp.text, "xml")
    except Exception:
        soup = BeautifulSoup(resp.text, "html.parser")

    items: list[dict] = []
    for item in soup.find_all("item")[:limit]:
        title = _clean(item.title.get_text() if item.title else None)
        link = item.link.get_text().strip() if item.link else ""
        if not title or not link:
            continue

        published_at: datetime | None = None
        if item.pubDate:
            try:
                published_at = date_parser.parse(item.pubDate.get_text())
                if published_at.tzinfo is None:
                    published_at = published_at.replace(tzinfo=timezone.utc)
            except Exception:
                published_at = None

        source_tag = item.find("source")
        source_name = _clean(source_tag.get_text()) if source_tag else ""

        # Google News basliklari genelde " - Kaynak" ekiyle gelir; ayikla
        if source_name and title.endswith(f" - {source_name}"):
            title = title[: -len(f" - {source_name}")].strip()

        items.append(
            {
                "title": title[:512],
                "url": link[:1024],
                "snippet": _clean(item.description.get_text() if item.description else None)[:1000],
                "source_name": source_name[:200],
                "published_at": published_at or datetime.now(timezone.utc),
            }
        )
    return items
