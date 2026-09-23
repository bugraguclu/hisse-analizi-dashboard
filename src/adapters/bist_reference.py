"""Borsa İstanbul hisse evreni ve resmî referans kaynakları.

Kaynaklar (2026-09-23 canlı doğrulandı):

* **Borsa İstanbul endeks bileşen dosyası** (``hisse_endeks_ds.csv``) — resmî; tüm
  endekslerin (XU100, XU030, XBANK, sektör/şehir endeksleri...) bileşenleri. ``;``
  ayraçlı, iki başlık satırı (TR + EN), kodlar ``AEFES.E`` biçiminde, tek ``TARIH``.
* **TradingView tarayıcısı** (``turkey/scan``, tüm piyasa tek istek, ~0,4 sn) — işlem
  gören her menkul kıymet: ISIN, ``sector.tr``/``industry.tr``, ``type``/``subtype``,
  halka açıklık (``float_shares_percent_current``) ve endeks üyelikleri (``indexes``).
* **KAP dizinleri** — ``/tr/bist-sirketler`` (``mkkMemberOid`` + resmî unvan + şehir),
  ``/tr/Sektorler`` (KAP sektörü) ve ``/tr/Pazarlar`` (işlem gördüğü pazar); her biri tek
  istek, veriler Next.js "flight" yükünün içinde JSON olarak gelir.
* **KAP şirket "genel" sayfası** (``/tr/sirket-bilgileri/genel/<oid>``) — MKK'nın fiili
  dolaşımdaki pay oranı (resmî halka açıklık), %5+ ortaklar, internet adresi, sektör,
  pazar ve endeksler. Şirket başına bir istek; KAP WAF'ı (~100 istek/2 dk → 6 dk engel)
  nedeniyle yalnızca yavaş, sıralı yenilemede kullanılır.
* **KAP beklenen bildirimler** (``/tr/api/expected-disclosure-inquiry/company``) — şirketin
  önümüzdeki finansal rapor pencereleri (``ruleOid``/``taxonomyOid`` ile).

Ayrıştırıcılar saf fonksiyonlardır (birim testleri ağsız çalışır); ``fetch_*`` fonksiyonları
paylaşılan HTTP istemcisini kullanır ve hata durumunda kısa Türkçe mesajlı
:class:`~src.adapters.utils.MarketDataError` fırlatır.
"""

from __future__ import annotations

import asyncio
import csv
import io
import json
import math
import re
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

import httpx
import structlog

from src.adapters.utils import (
    TRADINGVIEW_SCAN_URL,
    MarketDataError,
    cached,
    get_http_client,
    run_sync,
    sanitize_data,
)
from src.parsers.helpers import restore_turkish_name, turkish_title

logger = structlog.get_logger(__name__)

BIST_INDEX_CSV_URL = "https://www.borsaistanbul.com/datum/hisse_endeks_ds.csv"
KAP_BASE_URL = "https://www.kap.org.tr"
KAP_COMPANIES_URL = f"{KAP_BASE_URL}/tr/bist-sirketler"
KAP_SECTORS_URL = f"{KAP_BASE_URL}/tr/Sektorler"
KAP_MARKETS_URL = f"{KAP_BASE_URL}/tr/Pazarlar"
KAP_EXPECTED_DISCLOSURES_URL = f"{KAP_BASE_URL}/tr/api/expected-disclosure-inquiry/company"
KAP_EXPECTED_DISCLOSURES_PAGE = f"{KAP_BASE_URL}/tr/beklenen-bildirim-sorgu"


def kap_general_url(member_oid: str) -> str:
    return f"{KAP_BASE_URL}/tr/sirket-bilgileri/genel/{member_oid}"


def kap_summary_url(member_oid: str) -> str:
    return f"{KAP_BASE_URL}/tr/sirket-bilgileri/ozet/{member_oid}"


# Reference directories change a few times a year. Shorter than a day so the daily
# universe sync never reuses the previous day's copy.
TTL_KAP_DIRECTORY = 12 * 3600
TTL_INDEX_FILE = 6 * 3600

_TIMEOUT = httpx.Timeout(30.0, connect=10.0)
_TRADINGVIEW_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Origin": "https://www.tradingview.com",
    "Referer": "https://www.tradingview.com/",
}
_TRADINGVIEW_UNIVERSE_COLUMNS = (
    "name",
    "description",
    "isin",
    "sector.tr",
    "industry.tr",
    "type",
    "subtype",
    "market_cap_basic",
    "float_shares_percent_current",
    "indexes",
)
_TRADINGVIEW_RANGE = 3000  # the whole BIST fits in one page (650 rows on 2026-09-23)

# Security types stored in ``companies.security_type``.
SECURITY_STOCK = "stock"
SECURITY_CLOSED_END_FUND = "closed_end_fund"

# KAP "PAY PİYASASI" segments, most specific listing first: a code can appear in
# several markets (e.g. ISMEN: YILDIZ PAZAR + structured products for its warrants).
EQUITY_MARKET_PRIORITY: tuple[str, ...] = (
    "YILDIZ PAZAR",
    "ANA PAZAR",
    "ALT PAZAR",
    "YAKIN İZLEME PAZARI",
    "PİYASA ÖNCESİ İŞLEM PLATFORMU",
    "GİRİŞİM SERMAYESİ PAZARI",
    "YAPILANDIRILMIŞ ÜRÜNLER VE FON PAZARI",
    "EMTİA PAZARI",
)
NON_EQUITY_MARKETS = frozenset({"YAPILANDIRILMIŞ ÜRÜNLER VE FON PAZARI", "EMTİA PAZARI"})

_TICKER_RE = re.compile(r"^[A-Z0-9]{2,10}$")
_INDEX_CODE_RE = re.compile(r"^[A-Z0-9]{2,10}$")
_ISIN_RE = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")
_FLIGHT_CHUNK_RE = re.compile(r'self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)')
_LEGAL_SUFFIX_RE = re.compile(
    r"[\s,]+(?:T\.?\s?A\.?\s?Ş\.?|T\.?\s?A\.?\s?O\.?|A\.?\s?Ş\.?|A\.?\s?O\.?|A\.\s?S\.?|AS|ANON[İI]M\s+Ş[İI]RKET[İI]"
    r"|ANONIM\s+SIRKETI|AKTIENGESELLSCHAFT)\s*$",
    re.IGNORECASE,
)
# Words kept upper-case in generated display names.
_ACRONYMS = frozenset({"GYO", "GMYO", "YO", "BYF", "TAV", "BİM", "ŞOK", "QNB", "ICBC", "TR", "A1", "HSY", "DO", "CO"})
_LOWER_WORDS = frozenset({"VE", "İLE"})


def _fail(message: str, status_code: int = 503) -> MarketDataError:
    return MarketDataError(message, status_code=status_code)


def finite(value: Any) -> float | None:
    """``value`` as a finite float; ``None`` for missing/NaN/Inf/bool/sentinel values."""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or abs(number) >= 1e90:
        return None
    return number


def parse_tr_number(text: Any) -> float | None:
    """Turkish-formatted number (``"678.740.030,84"``, ``"49,18"``, ``"100"``) → float."""
    if text is None:
        return None
    if isinstance(text, (int, float)) and not isinstance(text, bool):
        return finite(text)
    raw = str(text).strip().replace("%", "").replace(" ", "")
    if not raw or raw in {"-", "—"}:
        return None
    if "," in raw:
        raw = raw.replace(".", "").replace(",", ".")
    elif raw.count(".") > 1:
        raw = raw.replace(".", "")
    return finite(raw)


def strip_suffix(code: str) -> str:
    """``"AEFES.E"`` → ``"AEFES"`` (Borsa İstanbul bulletin codes carry a market suffix)."""
    value = (code or "").strip().upper()
    return value.split(".", 1)[0] if "." in value else value


# ---------------------------------------------------------------------------
# Borsa İstanbul index constituent file
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class IndexInfo:
    code: str
    name_tr: str | None
    name_en: str | None


@dataclass(frozen=True)
class IndexConstituent:
    index_code: str
    ticker: str
    bulletin_name: str | None


@dataclass(frozen=True)
class IndexFile:
    """Parsed ``hisse_endeks_ds.csv``: every (index, constituent) pair of one publication day."""

    as_of: date | None
    indices: dict[str, IndexInfo]
    constituents: list[IndexConstituent]

    def members(self, index_code: str) -> set[str]:
        return {c.ticker for c in self.constituents if c.index_code == index_code}

    def tickers(self) -> set[str]:
        return {c.ticker for c in self.constituents}

    def bulletin_names(self) -> dict[str, str]:
        names: dict[str, str] = {}
        for c in self.constituents:
            if c.bulletin_name:
                names.setdefault(c.ticker, c.bulletin_name)
        return names

    def index_codes_by_ticker(self) -> dict[str, tuple[str, ...]]:
        codes: dict[str, list[str]] = {}
        for c in self.constituents:
            codes.setdefault(c.ticker, []).append(c.index_code)
        return {ticker: tuple(sorted(set(values))) for ticker, values in codes.items()}


def _parse_csv_date(text: str) -> date | None:
    try:
        return datetime.strptime(text.strip(), "%d/%m/%Y").date()
    except ValueError:
        return None


def parse_index_csv(text: str) -> IndexFile:
    """Parse the Borsa İstanbul constituent file.

    Layout: two header lines (Turkish, English) then
    ``BILESEN KODU;BULTEN_ADI;ENDEKS KODU;ENDEKS ADI;ENDEKS INGILIZCE ADI;TARIH``.
    Header lines are recognised by content (not position) so an extra/missing
    header line cannot turn into a bogus constituent. Raises ``ValueError`` when
    no constituent row is found.
    """
    reader = csv.reader(io.StringIO(text.lstrip("﻿")), delimiter=";")
    indices: dict[str, IndexInfo] = {}
    constituents: list[IndexConstituent] = []
    seen: set[tuple[str, str]] = set()
    dates: dict[date, int] = {}
    for row in reader:
        cells = [cell.strip() for cell in row]
        if len(cells) < 3 or not any(cells):
            continue
        head = cells[0].upper()
        if head.startswith(("BILESEN", "BİLEŞEN", "CONSTITUENT")):
            continue
        ticker = strip_suffix(cells[0])
        index_code = cells[2].strip().upper()
        if not _TICKER_RE.fullmatch(ticker) or not _INDEX_CODE_RE.fullmatch(index_code):
            continue
        name_tr = cells[3] if len(cells) > 3 and cells[3] else None
        name_en = cells[4] if len(cells) > 4 and cells[4] else None
        if index_code not in indices:
            indices[index_code] = IndexInfo(index_code, name_tr, name_en)
        if (index_code, ticker) in seen:
            continue
        seen.add((index_code, ticker))
        constituents.append(IndexConstituent(index_code, ticker, cells[1] or None))
        day = _parse_csv_date(cells[5]) if len(cells) > 5 else None
        if day is not None:
            dates[day] = dates.get(day, 0) + 1
    if not constituents:
        raise ValueError("Endeks bileşen dosyasında satır bulunamadı")
    as_of = max(dates, key=lambda d: (dates[d], d)) if dates else None
    return IndexFile(as_of=as_of, indices=indices, constituents=constituents)


@cached(TTL_INDEX_FILE, "bist_index_file")
async def fetch_index_file() -> IndexFile:
    """Download and parse the official constituent file (raises :class:`MarketDataError`)."""
    try:
        response = await get_http_client().get(BIST_INDEX_CSV_URL, timeout=_TIMEOUT)
        response.raise_for_status()
    except httpx.HTTPError as e:
        logger.warning("bist_index_file_unreachable", error=f"{type(e).__name__}: {e}")
        raise _fail("Borsa İstanbul endeks dosyasına ulaşılamadı") from e
    raw = response.content
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1254", errors="replace")
    try:
        return parse_index_csv(text)
    except ValueError as e:
        raise _fail("Borsa İstanbul endeks dosyası okunamadı", status_code=502) from e


# ---------------------------------------------------------------------------
# TradingView scanner — the traded universe
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TvSecurity:
    ticker: str
    description: str | None
    isin: str | None
    sector: str | None
    industry: str | None
    type: str | None
    subtype: str | None
    market_cap: float | None
    free_float_pct: float | None
    index_codes: tuple[str, ...] = ()


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    return text or None


def _tv_index_codes(value: Any) -> tuple[str, ...]:
    codes: set[str] = set()
    for item in value if isinstance(value, list) else []:
        if isinstance(item, Mapping):
            proname = str(item.get("proname") or "")
            code = proname.split(":", 1)[-1].strip().upper()
            if _INDEX_CODE_RE.fullmatch(code):
                codes.add(code)
    return tuple(sorted(codes))


def _percent(value: Any) -> float | None:
    number = finite(value)
    return number if number is not None and 0 <= number <= 100 else None


def parse_tradingview_universe(body: Any, columns: Iterable[str] = _TRADINGVIEW_UNIVERSE_COLUMNS) -> dict[str, TvSecurity]:
    """``{TICKER: TvSecurity}`` from a whole-market scanner response (BIST rows only)."""
    cols = list(columns)
    data = body.get("data") if isinstance(body, Mapping) else None
    result: dict[str, TvSecurity] = {}
    for item in data if isinstance(data, list) else []:
        if not isinstance(item, Mapping):
            continue
        values = item.get("d")
        symbol = str(item.get("s") or "")
        exchange, _, ticker = symbol.partition(":")
        if exchange.upper() != "BIST" or not isinstance(values, list) or len(values) != len(cols):
            continue
        ticker = ticker.strip().upper()
        if not _TICKER_RE.fullmatch(ticker):
            continue
        row = dict(zip(cols, sanitize_data(values)))
        isin = _clean_text(row.get("isin"))
        result[ticker] = TvSecurity(
            ticker=ticker,
            description=_clean_text(row.get("description")),
            isin=isin.upper() if isin and _ISIN_RE.fullmatch(isin.upper()) else None,
            sector=_clean_text(row.get("sector.tr")),
            industry=_clean_text(row.get("industry.tr")),
            type=_clean_text(row.get("type")),
            subtype=_clean_text(row.get("subtype")),
            market_cap=finite(row.get("market_cap_basic")),
            free_float_pct=_percent(row.get("float_shares_percent_current")),
            index_codes=_tv_index_codes(row.get("indexes")),
        )
    return result


async def fetch_tradingview_universe() -> dict[str, TvSecurity]:
    """Every BIST security the free TradingView feed carries (one request)."""
    payload = {
        "columns": list(_TRADINGVIEW_UNIVERSE_COLUMNS),
        "filter": [],
        "markets": ["turkey"],
        "options": {"lang": "tr"},
        "range": [0, _TRADINGVIEW_RANGE],
        "sort": {"sortBy": "name", "sortOrder": "asc"},
        "symbols": {"query": {"types": []}, "tickers": []},
    }
    try:
        response = await get_http_client().post(
            TRADINGVIEW_SCAN_URL, json=payload, headers=_TRADINGVIEW_HEADERS, timeout=_TIMEOUT
        )
    except httpx.HTTPError as e:
        logger.warning("tradingview_universe_unreachable", error=f"{type(e).__name__}: {e}")
        raise _fail("Piyasa verisi sağlayıcısına ulaşılamadı") from e
    if response.status_code >= 400:
        logger.warning("tradingview_universe_http_error", status=response.status_code, body=response.text[:200])
        raise _fail("Piyasa verisi sağlayıcısı isteği reddetti", 503 if response.status_code >= 500 else 502)
    try:
        body = response.json()
    except ValueError as e:
        raise _fail("Piyasa verisi sağlayıcısından geçersiz yanıt alındı", status_code=502) from e
    total = body.get("totalCount") if isinstance(body, dict) else None
    if isinstance(total, int) and total > _TRADINGVIEW_RANGE:
        logger.warning("tradingview_universe_truncated", total=total, range=_TRADINGVIEW_RANGE)
    return parse_tradingview_universe(body)


# ---------------------------------------------------------------------------
# KAP directories (Next.js flight payloads)
# ---------------------------------------------------------------------------

def decode_next_flight(html: str) -> str:
    """Concatenate the ``self.__next_f.push([1, "..."])`` string chunks of a Next.js page."""
    parts: list[str] = []
    for chunk in _FLIGHT_CHUNK_RE.findall(html):
        try:
            parts.append(json.loads(f'"{chunk}"'))
        except json.JSONDecodeError:
            continue
    return "".join(parts)


_DECODER = json.JSONDecoder()


def iter_json_objects(text: str, prefix: str) -> Iterator[Any]:
    """Decode every JSON value that starts at an occurrence of ``prefix`` (``'{"sectorName":'``)."""
    start = 0
    while True:
        index = text.find(prefix, start)
        if index < 0:
            return
        try:
            value, end = _DECODER.raw_decode(text, index)
        except json.JSONDecodeError:
            start = index + len(prefix)
            continue
        yield value
        start = end


def _codes(value: Any) -> list[str]:
    tokens = re.split(r"[\s,;/]+", str(value or "").upper())
    return [token for token in tokens if _TICKER_RE.fullmatch(token)]


@dataclass(frozen=True)
class KapMember:
    ticker: str
    member_oid: str
    title: str | None
    city: str | None = None
    codes: tuple[str, ...] = ()


def parse_kap_members(html_or_flight: str) -> dict[str, KapMember]:
    """``{TICKER: KapMember}`` from ``/tr/bist-sirketler`` (one member may own several codes)."""
    text = decode_next_flight(html_or_flight) or html_or_flight
    members: dict[str, KapMember] = {}
    for obj in iter_json_objects(text, '{"mkkMemberOid":'):
        if not isinstance(obj, dict):
            continue
        oid = _clean_text(obj.get("mkkMemberOid"))
        codes = _codes(obj.get("stockCode"))
        if not oid or not codes:
            continue
        for code in codes:
            members.setdefault(
                code,
                KapMember(
                    ticker=code,
                    member_oid=oid,
                    title=_clean_text(obj.get("kapMemberTitle")),
                    city=_clean_text(obj.get("cityName")),
                    codes=tuple(codes),
                ),
            )
    return members


@dataclass(frozen=True)
class KapSector:
    ticker: str
    member_oid: str | None
    sector: str
    title: str | None


def parse_kap_sectors(html_or_flight: str) -> dict[str, KapSector]:
    """``{TICKER: KapSector}`` from ``/tr/Sektorler`` (``sectorName`` = KAP sub-sector)."""
    text = decode_next_flight(html_or_flight) or html_or_flight
    sectors: dict[str, KapSector] = {}
    for obj in iter_json_objects(text, '{"sectorName":'):
        if not isinstance(obj, dict):
            continue
        name = _clean_text(obj.get("sectorName"))
        if not name:
            continue
        for code in _codes(obj.get("stockCode")):
            sectors.setdefault(
                code,
                KapSector(code, _clean_text(obj.get("mkkMemberOid")), name, _clean_text(obj.get("title"))),
            )
    return sectors


def best_equity_market(markets: Iterable[str]) -> str | None:
    """Most specific equity segment of a code (``YILDIZ PAZAR`` over debt/structured markets)."""
    names = set(markets)
    for name in EQUITY_MARKET_PRIORITY:
        if name in names:
            return name
    return None


def parse_kap_markets(html_or_flight: str) -> dict[str, str]:
    """``{TICKER: market segment}`` (``"YILDIZ PAZAR"``...) from ``/tr/Pazarlar`` — equity market only."""
    text = decode_next_flight(html_or_flight) or html_or_flight
    by_code: dict[str, set[str]] = {}
    for obj in iter_json_objects(text, '{"financialMarketOid":'):
        if not isinstance(obj, dict):
            continue
        market = _clean_text(obj.get("marketName"))
        if not market:
            continue
        for item in obj.get("marketDetailContentList") or []:
            if isinstance(item, dict):
                for code in _codes(item.get("stockCode")):
                    by_code.setdefault(code, set()).add(market)
    result: dict[str, str] = {}
    for code, markets in by_code.items():
        best = best_equity_market(markets)
        if best:
            result[code] = best
    return result


@dataclass
class KapDirectory:
    members: dict[str, KapMember] = field(default_factory=dict)
    sectors: dict[str, KapSector] = field(default_factory=dict)
    markets: dict[str, str] = field(default_factory=dict)

    def member_oid(self, ticker: str) -> str | None:
        member = self.members.get(ticker)
        if member is not None:
            return member.member_oid
        sector = self.sectors.get(ticker)
        return sector.member_oid if sector is not None else None

    def title(self, ticker: str) -> str | None:
        member = self.members.get(ticker)
        if member is not None and member.title:
            return member.title
        sector = self.sectors.get(ticker)
        return sector.title if sector is not None else None


async def _kap_page(url: str) -> str:
    """GET a kap.org.tr page through the process-wide KAP gate (spacing + WAF back-off)."""
    from src.adapters.fundamentals_common import kap_get

    try:
        response = await kap_get(url)
        response.raise_for_status()
    except httpx.HTTPError as e:
        logger.warning("kap_page_unreachable", url=url, error=f"{type(e).__name__}: {e}")
        raise _fail("KAP'a ulaşılamadı") from e
    return response.text


@cached(TTL_KAP_DIRECTORY, "kap_members")
async def fetch_kap_members() -> dict[str, KapMember]:
    members: dict[str, KapMember] = await run_sync(parse_kap_members, await _kap_page(KAP_COMPANIES_URL))
    if len(members) < 300:
        raise _fail(f"KAP şirket dizini beklenenden kısa ({len(members)})", status_code=502)
    return members


@cached(TTL_KAP_DIRECTORY, "kap_sectors")
async def fetch_kap_sectors() -> dict[str, KapSector]:
    sectors: dict[str, KapSector] = await run_sync(parse_kap_sectors, await _kap_page(KAP_SECTORS_URL))
    if len(sectors) < 300:
        raise _fail(f"KAP sektör listesi beklenenden kısa ({len(sectors)})", status_code=502)
    return sectors


@cached(TTL_KAP_DIRECTORY, "kap_markets")
async def fetch_kap_markets() -> dict[str, str]:
    markets: dict[str, str] = await run_sync(parse_kap_markets, await _kap_page(KAP_MARKETS_URL))
    if len(markets) < 300:
        raise _fail(f"KAP pazar listesi beklenenden kısa ({len(markets)})", status_code=502)
    return markets


async def resolve_member_oid(ticker: str) -> str | None:
    """KAP member OID of ``ticker`` from the (cached) directory; ``None`` if unknown/unreachable."""
    try:
        members = await fetch_kap_members()
    except MarketDataError as e:
        logger.info("kap_member_directory_unavailable", ticker=ticker, error=e.message)
        return None
    member = members.get(ticker.upper())
    return member.member_oid if member is not None else None


# ---------------------------------------------------------------------------
# KAP company "genel" page (official free float, shareholders, website...)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class KapFreeFloat:
    ticker: str
    ratio_pct: float | None
    shares: float | None
    total_shares: float | None
    as_of: date | None


@dataclass(frozen=True)
class KapHolder:
    name: str
    share_pct: float | None
    voting_pct: float | None
    amount_tl: float | None


@dataclass
class KapCompanyGeneral:
    sector: str | None = None           # "MALİ KURULUŞLAR / BANKALAR" (main / sub)
    markets: tuple[str, ...] = ()
    indices: tuple[str, ...] = ()
    website: str | None = None
    paid_in_capital: float | None = None
    free_float: dict[str, KapFreeFloat] = field(default_factory=dict)
    shareholders: list[KapHolder] = field(default_factory=list)
    shareholders_as_of: date | None = None

    @property
    def sub_sector(self) -> str | None:
        if not self.sector:
            return None
        return self.sector.split(" / ")[-1].strip() or None


def _split_list(value: Any) -> tuple[str, ...]:
    return tuple(part.strip() for part in str(value or "").split(" / ") if part.strip())


def _parse_kap_day(value: Any) -> date | None:
    text = str(value or "").strip()
    for fmt, size in (("%Y%m%d", 8), ("%d/%m/%Y", 10), ("%d.%m.%Y", 10)):
        try:
            return datetime.strptime(text[:size], fmt).date()
        except ValueError:
            continue
    return None


def _first_website(value: Any) -> str | None:
    for token in re.split(r"\s+/\s+|[\s,;]+", str(value or "")):
        token = token.strip().rstrip("/")
        if "." in token and len(token) <= 300 and not token.startswith("@") and "@" not in token:
            return token
    return None


def parse_kap_general(html_or_flight: str) -> KapCompanyGeneral:
    """Items of the KAP company "genel" page keyed by their stable ``itemKey``."""
    text = decode_next_flight(html_or_flight) or html_or_flight
    items: dict[str, dict[str, Any]] = {}
    marker = '"itemObject":'
    start = 0
    while True:
        index = text.find(marker, start)
        if index < 0:
            break
        try:
            obj, end = _DECODER.raw_decode(text, index + len(marker))
        except json.JSONDecodeError:
            start = index + len(marker)
            continue
        start = end
        if isinstance(obj, dict) and isinstance(obj.get("itemKey"), str):
            items.setdefault(obj["itemKey"], obj)

    general = KapCompanyGeneral()
    value = (items.get("kpy41_acc2_sektor") or {}).get("value")
    general.sector = _clean_text(value)
    general.markets = _split_list((items.get("kpy41_acc3_sermaye_arac_pazar") or {}).get("value"))
    general.indices = _split_list((items.get("kpy41_acc3_endeksler") or {}).get("value"))
    general.website = _first_website((items.get("kpy41_acc1_int_addres") or {}).get("value"))
    general.paid_in_capital = parse_tr_number((items.get("kpy41_acc5_odenmis_sermaye") or {}).get("value"))

    for row in (items.get("kpy41_acc5_fiili_dolasimdaki_pay") or {}).get("value") or []:
        if not isinstance(row, dict):
            continue
        code = strip_suffix(str(row.get("isin") or ""))
        if not _TICKER_RE.fullmatch(code):
            continue
        general.free_float[code] = KapFreeFloat(
            ticker=code,
            ratio_pct=_percent(parse_tr_number(row.get("actualOutstandingSharesRatio"))),
            shares=parse_tr_number(row.get("actualSharesOutstanding")),
            total_shares=parse_tr_number(row.get("totalShares")),
            as_of=_parse_kap_day(row.get("creationDate")),
        )

    holders_item = items.get("kpy41_acc5_sermayede_dogrudan") or {}
    for row in holders_item.get("value") or []:
        if not isinstance(row, dict):
            continue
        name = _clean_text(row.get("shareholder"))
        if not name or name.upper() in {"TOPLAM", "TOTAL"}:
            continue
        general.shareholders.append(
            KapHolder(
                name=name,
                share_pct=_percent(parse_tr_number(row.get("ratioInCapital"))),
                voting_pct=_percent(parse_tr_number(row.get("votingRightRatio"))),
                amount_tl=parse_tr_number(row.get("shareInCapital")),
            )
        )
    general.shareholders_as_of = _parse_kap_day(holders_item.get("creationDate"))
    return general


async def fetch_kap_general(member_oid: str) -> KapCompanyGeneral:
    """One KAP request (keep these slow: the KAP WAF blocks ~100 requests / 2 min)."""
    html = await _kap_page(kap_general_url(member_oid))
    general: KapCompanyGeneral = await run_sync(parse_kap_general, html)
    if general.sector is None and not general.free_float and not general.shareholders:
        raise _fail("KAP şirket sayfası beklenen alanları içermiyor", status_code=502)
    return general


# ---------------------------------------------------------------------------
# KAP expected disclosures
# ---------------------------------------------------------------------------

EXPECTED_WINDOW_DAYS = 180


@dataclass(frozen=True)
class ExpectedDisclosureRecord:
    subject: str
    period_term: str | None
    fiscal_year: int | None
    start_date: date | None
    end_date: date | None
    rule_oid: str | None
    taxonomy_oid: str | None

    def natural_key(self) -> str:
        """Identity of one reporting obligation (dates may move, the obligation does not)."""
        return "|".join(
            str(part or "")
            for part in (self.rule_oid, self.taxonomy_oid, self.subject, self.period_term, self.fiscal_year)
        )


def parse_expected_disclosures(payload: Any) -> list[ExpectedDisclosureRecord]:
    records: list[ExpectedDisclosureRecord] = []
    seen: set[str] = set()
    for item in payload if isinstance(payload, list) else []:
        if not isinstance(item, Mapping):
            continue
        subject = _clean_text(item.get("subject"))
        if not subject:
            continue
        year = item.get("year")
        try:
            fiscal_year = int(year) if year not in (None, "") else None
        except (TypeError, ValueError):
            fiscal_year = None
        record = ExpectedDisclosureRecord(
            subject=subject[:200],
            period_term=(_clean_text(item.get("ruleTypeTerm")) or None),
            fiscal_year=fiscal_year,
            start_date=_parse_kap_day(item.get("startDate")),
            end_date=_parse_kap_day(item.get("endDate")),
            rule_oid=_clean_text(item.get("ruleOid")),
            taxonomy_oid=_clean_text(item.get("taxonomyOid")),
        )
        key = record.natural_key()
        if key in seen:
            continue
        seen.add(key)
        records.append(record)
    return records


async def fetch_expected_disclosures(member_oid: str, today: date) -> list[ExpectedDisclosureRecord]:
    """Open and upcoming (``today`` .. +180 days) reporting windows of one KAP member."""
    payload = {
        "startDate": today.isoformat(),
        "endDate": (today + timedelta(days=EXPECTED_WINDOW_DAYS)).isoformat(),
        "memberTypes": ["IGS"],
        "mkkMemberOidList": [member_oid],
        "disclosureClass": "",
        "subjects": [],
        "mainSector": "",
        "sector": "",
        "subSector": "",
        "market": "",
        "index": "",
        "year": "",
        "term": "",
        "ruleType": "",
    }
    headers = {
        "Accept": "application/json, */*",
        "Content-Type": "application/json",
        "Origin": KAP_BASE_URL,
        "Referer": KAP_EXPECTED_DISCLOSURES_PAGE,
    }
    from src.adapters.fundamentals_common import kap_gate

    if kap_gate.blocked_for() > 0:  # the WAF is blocking us: do not extend the block
        raise _fail("KAP beklenen bildirim takvimine ulaşılamadı")
    try:
        response = await get_http_client().post(
            KAP_EXPECTED_DISCLOSURES_URL, json=payload, headers=headers, timeout=_TIMEOUT
        )
        if response.status_code in (403, 429):
            kap_gate.block(f"HTTP {response.status_code}")
        response.raise_for_status()
        body = response.json()
    except httpx.HTTPError as e:
        if isinstance(e, httpx.TransportError):
            kap_gate.block(f"{type(e).__name__}: {e}")
        logger.warning("kap_expected_unreachable", oid=member_oid, error=f"{type(e).__name__}: {e}")
        raise _fail("KAP beklenen bildirim takvimine ulaşılamadı") from e
    except ValueError as e:
        raise _fail("KAP beklenen bildirim takvimi okunamadı", status_code=502) from e
    if not isinstance(body, list):
        raise _fail("KAP beklenen bildirim takvimi okunamadı", status_code=502)
    return parse_expected_disclosures(body)


# ---------------------------------------------------------------------------
# Universe assembly
# ---------------------------------------------------------------------------

@dataclass
class UniverseSources:
    """Everything one universe sync fetched; a source that failed is ``None`` (see ``errors``)."""

    tradingview: dict[str, TvSecurity] | None = None
    index_file: IndexFile | None = None
    kap: KapDirectory | None = None
    errors: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class UniverseEntry:
    """One security of the BIST equity universe, merged from all sources."""

    ticker: str
    legal_name: str
    display_name: str
    isin: str | None
    sector: str | None          # KAP sector (sub-sector level)
    industry: str | None        # TradingView industry (tr)
    market_segment: str | None  # KAP "pazar"
    security_type: str
    kap_member_oid: str | None
    free_float_pct: float | None  # TradingView (bulk); per-company refresh overrides with KAP/MKK
    index_codes: tuple[str, ...] = ()
    sources: tuple[str, ...] = ()


_FOLD = str.maketrans("ÇĞİÖŞÜçğıöşü", "CGIOSUcgiosu")
_TITLE_WORD_RE = re.compile(r"[0-9A-Za-zÇĞİÖŞÜçğıöşü]+")


def _fold(word: str) -> str:
    return word.translate(_FOLD).upper()


def _title_word(word: str, official: set[str]) -> str:
    """Title-case one upper-case word.

    Words spelled as in the official (Turkish upper-case) KAP title use Turkish rules
    (``YOLLARI`` → ``Yolları``). Abbreviations absent from the title (``FIN.``) and
    foreign words (letters outside the Turkish alphabet: ``CREDITWEST``) come from
    ASCII-folded feeds, where ``I`` usually stands for a dotted ``i``.
    """
    def one(part: str) -> str:
        core = part.strip("()&'")
        if not core:
            return part
        if _fold(core) in official and not re.search(r"[QWX]", core):
            return turkish_title(part)
        return part[:1] + part[1:].replace("İ", "i").lower()  # str.lower("İ") adds a combining dot

    return "".join(one(part) for part in re.split(r"([-.])", word))


def display_name_for(ticker: str, bulletin_name: str | None, official_title: str | None, description: str | None) -> str:
    """Readable short name: the bulletin name with Turkish letters restored, else the title sans legal form."""
    base = bulletin_name or official_title or description or ticker
    base = _LEGAL_SUFFIX_RE.sub("", base).strip(" ,-") or base
    if official_title:
        base = restore_turkish_name(base, official_title)
    if base != base.upper():  # already mixed case (curated / provider casing)
        return base[:200]
    official = {_fold(w) for w in _TITLE_WORD_RE.findall(official_title or "")}
    words: list[str] = []
    for word in base.split():
        core = word.strip("().,")
        if len(core) <= 1 or core in _ACRONYMS or any(ch.isdigit() for ch in core):
            words.append(word)
        elif core in _LOWER_WORDS and words:
            words.append(word.replace(core, core.replace("İ", "i").lower()))
        else:
            words.append(_title_word(word, official))
    return " ".join(words)[:200] or ticker


def classify_security(tv: TvSecurity | None, market_segment: str | None) -> str | None:
    """``stock`` / ``closed_end_fund`` for equities; ``None`` for ETFs, certificates and other non-equity."""
    if tv is not None:
        kind = (tv.type or "").lower()
        subtype = (tv.subtype or "").lower()
        if kind == "fund":
            return SECURITY_CLOSED_END_FUND if subtype == "closedend" else None
        if kind not in ("stock", ""):
            return None
        # Turkish ISINs: TRA/TRE = shares; TRY funds, TRX/TRN certificates, TRM... structured products.
        if tv.isin and tv.isin.startswith("TR") and tv.isin[2] not in ("A", "E"):
            return None
    if market_segment in NON_EQUITY_MARKETS:
        return None
    return SECURITY_STOCK


def build_universe(sources: UniverseSources) -> tuple[list[UniverseEntry], dict[str, str]]:
    """Merge the sources into the equity universe.

    Membership: every TradingView stock / closed-end fund plus every constituent of
    the official index file (a few index members — e.g. ISATR — have no TradingView
    feed). KAP only enriches (member OID, official title, sector, market segment).
    Returns ``(entries, skipped)`` where ``skipped`` maps excluded tickers to a reason.
    """
    tv = sources.tradingview or {}
    index_file = sources.index_file
    kap = sources.kap or KapDirectory()
    bulletin = index_file.bulletin_names() if index_file else {}
    index_codes = index_file.index_codes_by_ticker() if index_file else {}
    candidates = set(tv) | set(index_codes)

    entries: list[UniverseEntry] = []
    skipped: dict[str, str] = {}
    for ticker in sorted(candidates):
        security = tv.get(ticker)
        segment = kap.markets.get(ticker)
        security_type = classify_security(security, segment)
        if security_type is None:
            if ticker in index_codes:  # an official index constituent is an equity by definition
                security_type = SECURITY_STOCK
            else:
                skipped[ticker] = f"non-equity ({security.type if security else '?'}/{security.subtype if security else '?'})"
                continue
        title = kap.title(ticker)
        legal_name = title or (security.description if security else None) or bulletin.get(ticker) or ticker
        sector = kap.sectors.get(ticker)
        origin = []
        if security is not None:
            origin.append("tradingview")
        if ticker in index_codes:
            origin.append("borsaistanbul")
        if kap.member_oid(ticker):
            origin.append("kap")
        entries.append(
            UniverseEntry(
                ticker=ticker,
                legal_name=legal_name[:500],
                display_name=display_name_for(
                    ticker, bulletin.get(ticker), title, security.description if security else None
                ),
                isin=security.isin if security else None,
                sector=sector.sector[:200] if sector else None,
                industry=security.industry[:200] if security and security.industry else None,
                market_segment=segment[:100] if segment else None,
                security_type=security_type,
                kap_member_oid=kap.member_oid(ticker),
                free_float_pct=security.free_float_pct if security else None,
                index_codes=index_codes.get(ticker, ()),
                sources=tuple(origin),
            )
        )
    return entries, skipped


async def fetch_universe_sources() -> UniverseSources:
    """Fetch all universe sources concurrently; failures are recorded, never raised."""
    results = await asyncio.gather(
        fetch_tradingview_universe(),
        fetch_index_file(),
        fetch_kap_members(),
        fetch_kap_sectors(),
        fetch_kap_markets(),
        return_exceptions=True,
    )
    names = ("tradingview", "index_file", "kap_members", "kap_sectors", "kap_markets")
    sources = UniverseSources()
    values: dict[str, Any] = {}
    for name, result in zip(names, results):
        if isinstance(result, BaseException):
            message = result.message if isinstance(result, MarketDataError) else f"{type(result).__name__}: {result}"
            sources.errors[name] = message
            logger.warning("universe_source_failed", source=name, error=message)
        else:
            values[name] = result
    sources.tradingview = values.get("tradingview")
    sources.index_file = values.get("index_file")
    if any(key in values for key in ("kap_members", "kap_sectors", "kap_markets")):
        sources.kap = KapDirectory(
            members=values.get("kap_members") or {},
            sectors=values.get("kap_sectors") or {},
            markets=values.get("kap_markets") or {},
        )
    return sources
