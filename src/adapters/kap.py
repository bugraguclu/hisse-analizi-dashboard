"""KAP bildirimleri adaptörü (polling worker).

Birincil kaynak borsapy'nin KAP bildirim sorgusu (``Ticker.news``). Eski
``/tr/api/disclosures`` uç noktası yalnızca borsapy HATA verdiğinde kısa bir
zaman aşımıyla denenir; borsapy'nin boş dönmesi (şirketin yeni bildirimi yok)
normal bir durumdur ve yedeğe düşülmez.

Tarihler KAP'ta ``GG.AA.YYYY SS:DD:ss`` biçiminde İstanbul yerel saatidir;
``parse_date`` bunları Europe/Istanbul saat dilimli (doğru an) datetime'a
çevirir. İçerik hash'i ve dedup anahtarı bu yerel gösterimle hesaplanır
(mevcut kayıtlarla uyum için değiştirilmemelidir); veritabanı ``timestamptz``
olduğundan an UTC olarak saklanır.
"""

import re
import time
from collections.abc import Iterable, Mapping
from typing import Any

import httpx
import structlog

from src.adapters.base import BaseAdapter, RawEventData
from src.adapters.utils import cached, get_http_client, run_sync
from src.db.models import PollingState
from src.parsers.helpers import clean_whitespace, compute_content_hash, parse_date

logger = structlog.get_logger(__name__)

KAP_DISCLOSURE_URL = "https://www.kap.org.tr/tr/Bildirim/{index}"
KAP_DISCLOSURES_API_URL = "https://www.kap.org.tr/tr/api/disclosures"
_API_TIMEOUT = httpx.Timeout(10.0, connect=5.0)
# The legacy feed lists the latest disclosures of ALL companies, so one download serves a
# whole polling cycle (single-flight + short TTL) instead of one download per company.
_FEED_TTL_SECONDS = 60
# After a failed download, fail fast for a while instead of re-downloading once per company.
_FEED_FAILURE_COOLDOWN_SECONDS = 60
_feed_failed_until = 0.0


class KapUnavailableError(RuntimeError):
    """Neither borsapy nor the KAP feed answered; the poll counts the company as failed."""


@cached(ttl_seconds=_FEED_TTL_SECONDS, key_prefix="kap")
async def _download_disclosure_feed() -> list[dict[str, Any]]:
    resp = await get_http_client().get(KAP_DISCLOSURES_API_URL, timeout=_API_TIMEOUT)
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, list):
        raise KapUnavailableError(f"unexpected KAP feed format: {type(data).__name__}")
    return [item for item in data if isinstance(item, dict)]


async def fetch_disclosure_feed() -> list[dict[str, Any]]:
    """Recent KAP disclosures of all companies (shared, cached; raises when unavailable)."""
    global _feed_failed_until
    if time.monotonic() < _feed_failed_until:
        raise KapUnavailableError("KAP feed recently failed; retrying after cooldown")
    try:
        return await _download_disclosure_feed()
    except Exception as e:
        _feed_failed_until = time.monotonic() + _FEED_FAILURE_COOLDOWN_SECONDS
        if isinstance(e, KapUnavailableError):
            raise
        raise KapUnavailableError(f"{type(e).__name__}: {e}") from e
_DISCLOSURE_ID_RE = re.compile(r"/Bildirim/(\d+)")
_STOCK_CODE_SPLIT_RE = re.compile(r"[\s,;/]+")


def stock_codes(value: Any) -> set[str]:
    """Stock codes of a disclosure (``"AKSA, BERA,YBTAS"`` → ``{"AKSA", "BERA", "YBTAS"}``)."""
    if isinstance(value, (list, tuple, set)):
        parts: Iterable[str] = (str(v) for v in value)
    else:
        parts = _STOCK_CODE_SPLIT_RE.split(str(value or ""))
    return {p.strip().upper() for p in parts if p and p.strip()}


def disclosure_id(url: str) -> str | None:
    match = _DISCLOSURE_ID_RE.search(url or "")
    return match.group(1) if match else None


def _published_iso(published_at: Any) -> str:
    return published_at.isoformat() if published_at else ""


def disclosure_event(
    *,
    title: str,
    url: str,
    date_text: str,
    raw_payload: Mapping[str, Any] | None = None,
    http_status: int | None = None,
) -> RawEventData | None:
    """Build a ``RawEventData`` for one disclosure; ``None`` when it has no title."""
    clean_title = clean_whitespace(title)
    if not clean_title:
        return None
    index = disclosure_id(url)
    canonical_url = KAP_DISCLOSURE_URL.format(index=index) if index else (url or None)
    published_at = parse_date(date_text)
    return RawEventData(
        external_id=index,
        canonical_url=canonical_url,
        source_event_type="KAP_DISCLOSURE",
        title=clean_title,
        summary=clean_title,
        published_at=published_at,
        content_hash=compute_content_hash(canonical_url or "", clean_title, _published_iso(published_at)),
        raw_payload_json=dict(raw_payload) if raw_payload is not None else None,
        http_status=http_status,
    )


def _dedupe(events: Iterable[RawEventData]) -> list[RawEventData]:
    seen: set[str] = set()
    result: list[RawEventData] = []
    for event in events:
        key = event.external_id or event.content_hash
        if key in seen:
            continue
        seen.add(key)
        result.append(event)
    return result


class KAPAdapter(BaseAdapter):
    """KAP bildirimleri: borsapy birincil, ``/api/disclosures`` yalnızca hata durumunda yedek."""

    def __init__(self, ticker: str = "THYAO"):
        self.ticker = ticker.strip().upper()

    def get_source_code(self) -> str:
        return "kap"

    async def fetch(self, polling_state: PollingState | None = None) -> list[RawEventData]:
        try:
            return await self._fetch_via_borsapy()
        except Exception as e:
            logger.warning("borsapy_kap_failed_fallback_to_api", ticker=self.ticker, error=f"{type(e).__name__}: {e}")
        return await self._fetch_via_kap_api()

    async def _fetch_via_borsapy(self) -> list[RawEventData]:
        """Latest disclosures via borsapy. Raises on upstream failure; ``[]`` = nothing new."""
        import borsapy as bp

        ticker = await run_sync(bp.Ticker, self.ticker)
        news_df = await run_sync(lambda: ticker.news)
        if news_df is None or getattr(news_df, "empty", True):
            logger.info("borsapy_kap_no_data", ticker=self.ticker)
            return []

        events: list[RawEventData] = []
        for _, row in news_df.iterrows():
            title = str(row.get("Title") or "")
            url = str(row.get("URL") or "")
            date_text = str(row.get("Date") or "")
            event = disclosure_event(
                title=title,
                url=url,
                date_text=date_text,
                raw_payload={"source": "borsapy", "date": date_text, "title": title, "url": url, "ticker": self.ticker},
            )
            if event is not None:
                events.append(event)
        events = _dedupe(events)
        logger.info("borsapy_kap_fetched", ticker=self.ticker, count=len(events))
        return events

    async def _fetch_via_kap_api(self) -> list[RawEventData]:
        """Legacy KAP JSON feed, filtered to disclosures that list this exact stock code.

        Raises :class:`KapUnavailableError` when the feed cannot be read, so the polling
        worker records a failure (and backs off) instead of mistaking it for "no news".
        """
        try:
            data = await fetch_disclosure_feed()
        except KapUnavailableError as e:
            logger.warning("kap_api_error", ticker=self.ticker, error=str(e)[:300])
            raise

        events: list[RawEventData] = []
        for item in data:
            basic = item.get("basic") or {}
            if self.ticker not in stock_codes(basic.get("stockCodes")):
                continue
            index = str(basic.get("disclosureIndex") or "").strip()
            if not index:
                continue
            event = disclosure_event(
                title=str(basic.get("title") or ""),
                url=KAP_DISCLOSURE_URL.format(index=index),
                date_text=str(basic.get("publishDate") or basic.get("disclosureDate") or ""),
                raw_payload=item,
                http_status=200,
            )
            if event is not None:
                events.append(event)
        events = _dedupe(events)
        logger.info("kap_api_fetched", ticker=self.ticker, count=len(events))
        return events
