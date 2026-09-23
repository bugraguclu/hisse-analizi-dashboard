"""Temel analiz adaptörünün ortak parçaları — sabitler, hata yardımcıları ve KAP şirket dizini.

``src.adapters.fundamentals`` bu modülü ve kardeş modülleri (``fundamentals_statements``,
``fundamentals_snapshot``, ``fundamentals_reference``) tek bir cephe (facade) olarak dışa açar.
"""

import asyncio
import re
from datetime import datetime
from typing import Any
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import httpx
import structlog

from src.adapters.financial_adapter import (
    IsYatirimError,
)
from src.adapters.utils import (
    MarketDataError,
    SymbolNotFoundError,
    cached,
    error_payload,
    get_http_client,
    run_sync,
)

logger = structlog.get_logger(__name__)




ISTANBUL_TZ = ZoneInfo("Europe/Istanbul")

# Cache lifetimes (seconds)
TTL_SNAPSHOT = 30               # live quote-driven fields (fast-info / info)
TTL_METRICS = 3600              # İş Yatırım company card (free float, foreign ratio)
TTL_STATEMENTS = 6 * 3600       # KAP summary + İş Yatırım statements (published quarterly)
TTL_REFERENCE = 6 * 3600        # dividends, capital increases, recommendations, holders, targets
TTL_CALENDAR = 3 * 3600         # expected financial-report dates
TTL_DISCLOSURES = 300           # latest KAP disclosures
TTL_PROFILE = 24 * 3600         # company profile (sector, website)
TTL_DIRECTORY = 24 * 3600       # KAP ticker → company page directory

KAP_BASE_URL = "https://www.kap.org.tr"
KAP_BIST_COMPANIES_URL = f"{KAP_BASE_URL}/tr/bist-sirketler"
_KAP_SUMMARY_PATH = "/sirket-bilgileri/ozet/"
_KAP_FINANCIAL_PATH = "/sirket-finansal-bilgileri/"
_TICKER_TOKEN_RE = re.compile(r"^[A-Z0-9]{2,8}$")
_PERIOD_LABEL_RE = re.compile(r"^\d{4}/\d{2}$")

_SOURCE_KAP = "KAP"
_SOURCE_ISY = "İş Yatırım"
_QUARTERS_FETCHED = 12

# User-facing (Turkish) error messages
_MSG_STATEMENTS = "Finansal tablolar şu anda alınamıyor"
_MSG_CASHFLOW = "Nakit akış tablosu şu anda alınamıyor"
_MSG_RATIOS = "Finansal oranlar şu anda hesaplanamıyor"
_MSG_QUOTE = "Piyasa verisi şu anda alınamıyor"
_MSG_REFERENCE = "Veri sağlayıcısına şu anda ulaşılamıyor"


def _today():
    return datetime.now(ISTANBUL_TZ).date()


_UNREACHABLE_ERRORS = (httpx.HTTPError, IsYatirimError, TimeoutError, ConnectionError)


def _failure(exc: BaseException, message: str, event: str, ticker: str, **payload: Any) -> dict[str, Any]:
    """Uniform adapter failure payload: logs the raw error, returns a short Turkish message.

    ``error_status``: the :class:`MarketDataError` status when given, 503 for
    unreachable upstreams, 502 for unusable upstream data.
    """
    result = error_payload(exc, message)
    if isinstance(exc, MarketDataError):
        logger.info(event, ticker=ticker, status=exc.status_code, error=exc.message)
    else:
        logger.error(event, ticker=ticker, error=f"{type(exc).__name__}: {exc}")
        result["error_status"] = 503 if isinstance(exc, _UNREACHABLE_ERRORS) else 502
    return {"ticker": ticker, **payload, **result}


def _discard(task: "asyncio.Future[Any]") -> None:
    """Cancel a helper task we no longer need, retrieving any stored exception."""
    if task.done():
        if not task.cancelled():
            task.exception()
    else:
        task.cancel()


# ---------------------------------------------------------------------------
# KAP directory (ticker → official company pages)
# ---------------------------------------------------------------------------

def _parse_kap_directory(html: str) -> dict[str, dict[str, str]]:
    """``{TICKER: {"url": financial summary URL, "page": company URL, "title": legal name}}``.

    The listing renders one table row per company: the first cell links the
    ticker(s) (one ``<div>`` per code, e.g. ``GARAN`` + ``TGB``), the second the
    legal name. Only ticker cells are read, so fund names such as "EMLAK KONUT
    DAMLA KENT GMS" can never shadow real tickers (``KENT``).
    """
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "html.parser")
    directory: dict[str, dict[str, str]] = {}
    for row in soup.find_all("tr"):
        cells = row.find_all("td", recursive=False)
        if not cells:
            continue
        anchor = cells[0].find("a", href=True)
        if anchor is None:
            continue
        href = str(anchor.get("href") or "")
        if _KAP_SUMMARY_PATH not in href:
            continue
        parts = [div.get_text(" ", strip=True) for div in anchor.find_all("div")]
        if not parts:
            parts = [anchor.get_text(" ", strip=True)]
        tokens = [token.upper() for part in parts for token in re.split(r"[\s,;/]+", part) if token]
        title = cells[1].get_text(" ", strip=True) if len(cells) > 1 else ""
        entry = {
            "url": urljoin(KAP_BASE_URL, href.replace(_KAP_SUMMARY_PATH, _KAP_FINANCIAL_PATH)),
            "page": urljoin(KAP_BASE_URL, href),
            "title": title,
        }
        for token in tokens:
            if _TICKER_TOKEN_RE.fullmatch(token):
                directory.setdefault(token, entry)
    return directory


async def get_kap_company_titles() -> dict[str, str]:
    """``{TICKER: official KAP title}`` for every listed company (raises if KAP is down)."""
    directory = await _get_kap_directory()
    return {ticker: entry["title"] for ticker, entry in directory.items() if entry.get("title")}


@cached(TTL_DIRECTORY, "kap_directory")
async def _get_kap_directory() -> dict[str, dict[str, str]]:
    response = await get_http_client().get(KAP_BIST_COMPANIES_URL)
    response.raise_for_status()
    directory: dict[str, dict[str, str]] = await run_sync(_parse_kap_directory, response.text)
    if len(directory) < 100:
        raise ValueError(f"KAP şirket listesi beklenenden kısa ({len(directory)})")
    return directory


async def _kap_company(ticker: str) -> dict[str, str] | None:
    """Directory entry for ``ticker``.

    Raises :class:`SymbolNotFoundError` when the directory loaded but does not
    list the ticker; returns ``None`` when the directory itself is unavailable
    (callers then proceed without the check).
    """
    try:
        directory = await _get_kap_directory()
    except Exception as e:
        logger.warning("kap_directory_unavailable", error=f"{type(e).__name__}: {e}")
        return None
    entry = directory.get(ticker.upper())
    if entry is None:
        raise SymbolNotFoundError(ticker)
    return entry


async def _require_listed(ticker: str) -> None:
    await _kap_company(ticker)


