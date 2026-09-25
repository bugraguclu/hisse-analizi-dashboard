"""Ekonomik takvim adaptörü — TradingView (birincil) + doviz.com (Türkçe adlar ve yedek).

**TradingView** (``economic-calendar.tradingview.com/events``) istenen her tarih aralığını
verir: geçmiş aylar, içinde bulunulan ay ve yaklaşık bir ay sonrası; gerçekleşen, önceki
ve **beklenti** (piyasa tahmini) değerleri birim/ölçekleriyle gelir. Aylık parçalar hâlinde
16 ülke birden çekilip önbelleğe alınır (geçmiş aylar 6 sa, bu ay ve sonrası 10 dk).
Olay adları yalnızca İngilizcedir; Türkçe adlar ``economic_calendar_titles`` ile doviz.com'un
aynı olaylara verdiği adlardan gelir (``title_tr``), önem düzeyi de eşleşen olaylarda
doviz.com'unkidir.

**doviz.com** (borsapy'nin kullandığı uç, kendi ayrıştırıcımızla) TradingView'e
ulaşılamazsa içinde bulunulan ay için yedek kaynaktır. borsapy 0.10.2
``economic_calendar()`` doviz.com yanıtını yanlış okuyor: yanıt dört sekme içerir (Bugün,
Yarın, Bu hafta, Bu ay) ve her sekmede her gün kendi başlığıyla gelir; borsapy sekme başına
yalnızca İLK gün başlığını okuduğu için satırlar yanlış günlere yazılıyor, sekmeler üst üste
bindiği için aynı olay 2–4 kez dönüyordu. Burada her satır kendisinden önceki gün başlığının
tarihini alır ve sekmeler birleştirilirken kopyalar atılır. doviz.com tarih parametresi kabul
etmez (pencere = içinde bulunulan ay ∪ bu hafta) ve beklenti sütunu hep boştur.

Satırlara konu etiketleri (``tags``) ve merkez bankası faiz kararı işareti (``key_event``)
eklenir. Eski alanlar (``Event``, ``Date``, ``Actual`` ...) aynen durur; yeni alanlar yalnızca
eklemedir.
"""

from __future__ import annotations

import asyncio
import hashlib
import math
import re
import unicodedata
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

import httpx
import structlog
from bs4 import BeautifulSoup

from src.adapters.economic_calendar_titles import learned_importance, translate_title
from src.adapters.utils import InvalidInputError, MarketDataError, cached, error_payload, get_http_client, run_sync

logger = structlog.get_logger(__name__)

ISTANBUL_TZ = ZoneInfo("Europe/Istanbul")
TTL_CALENDAR = 600  # actuals are filled in at release time; 10 min keeps them fresh
TTL_CALENDAR_ARCHIVE = 6 * 3600  # months already over only change on revisions
SOURCE_LABEL = "doviz.com ekonomik takvim"
TRADINGVIEW_SOURCE_LABEL = "TradingView"
MAX_WINDOW_DAYS = 124  # four months per request (the default window is three)
_FETCH_CONCURRENCY = 4
_ALL_IMPORTANCE = "3,2,1"  # doviz.com: 3=high, 2=mid, 1=low

TRADINGVIEW_CALENDAR_URL = "https://economic-calendar.tradingview.com/events"
# The endpoint answers 403 without a tradingview.com Origin (same headers as the scanner).
_TRADINGVIEW_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    ),
    "Origin": "https://www.tradingview.com",
    "Referer": "https://www.tradingview.com/",
    "Accept": "application/json",
}
_TRADINGVIEW_TIMEOUT = httpx.Timeout(20.0, connect=5.0)
# Fields kept from each event (the long English ``comment`` is dropped).
_TRADINGVIEW_FIELDS = (
    "id", "title", "country", "indicator", "category", "period", "referenceDate", "source", "source_url",
    "actual", "previous", "forecast", "unit", "scale", "currency", "importance", "date",
)

# doviz.com country codes → the (Turkish) names doviz.com itself prints.
CALENDAR_COUNTRIES: dict[str, str] = {
    "TR": "Türkiye",
    "US": "ABD",
    "EU": "Euro Bölgesi",
    "DE": "Almanya",
    "GB": "Birleşik Krallık",
    "FR": "Fransa",
    "IT": "İtalya",
    "JP": "Japonya",
    "CN": "Çin",
    "CA": "Kanada",
    "AU": "Avustralya",
    "CH": "İsviçre",
    "KR": "Güney Kore",
    "IN": "Hindistan",
    "BR": "Brezilya",
    "RU": "Rusya",
}
DEFAULT_COUNTRIES: tuple[str, ...] = ("TR", "US")
IMPORTANCE_LEVELS: tuple[str, ...] = ("low", "mid", "high")
_IMPORTANCE_ALIASES = {"medium": "mid", "orta": "mid", "dusuk": "low", "yuksek": "high"}

_TR_MONTHS = {
    "ocak": 1, "subat": 2, "mart": 3, "nisan": 4, "mayis": 5, "haziran": 6,
    "temmuz": 7, "agustos": 8, "eylul": 9, "ekim": 10, "kasim": 11, "aralik": 12,
}
_TIME_RE = re.compile(r"^(\d{1,2}):(\d{2})$")
# doviz.com appends the release period to every name: "... (-)" when there is
# none, "... (Eylül)" / "... (3.Çeyrek)" otherwise.
_PERIOD_SUFFIX_RE = re.compile(r"\s*\(([^()]*)\)\s*$")


def fold(text: str) -> str:
    """Case/diacritics-insensitive form for matching Turkish text: ``"İşsizlik"`` → ``"issizlik"``."""
    decomposed = unicodedata.normalize("NFKD", text.replace("ı", "i"))
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    return " ".join(stripped.lower().split())


# ---------------------------------------------------------------------------
# Topic tags (derived from the event name; an event may carry several)
# ---------------------------------------------------------------------------

_CB = r"^(?:fed|ecb|boe|boj|boc|rba|rbnz|snb|tcmb|bcb|cbr|pboc)\b"
_TAG_PATTERNS: tuple[tuple[str, str], ...] = (
    (
        "rates",
        r"faiz karari|gosterge faiz|politika faiz|\bppk\b|\bfomc\b|\bcopom\b|mevduat faiz orani|gecelik borc"
        r"|marjinal borc|iskonto faiz|refinansman|faiz projeksiyonu|para politikasi|kredi ana faiz"
        rf"|{_CB}.*(?:konusma|basin|faiz|karar|tutanak|toplanti|bilanco|alim|ozet|bulten|muzakere|bej kitap)",
    ),
    (
        "inflation",
        r"^(?!.*konut)(?:.*(?:enflasyon|\btufe\b|\bufe\b|\bpce\b|deflator|fiyat endeksi|fiyatlari|fiyatlar\b"
        r"|\bipca\b|igp-m|ipc-fipe|fiyati? beklenti|toptan (?:gida|yakit|imalat)))",
    ),
    (
        "labor",
        r"istihdam|issiz|bordro|kazanc|ucret|isgucu|\bjolts?\b|\badp\b|calisma saati|is arayan"
        r"|isten (?:cikarma|ayrilma)|is ilan|challenger|\bhmrc\b",
    ),
    (
        "growth",
        r"^(?!.*borc)(?:.*(?:gsyi?h|buyume orani|(?:sanayi|imalat|insaat|altyapi|otomobil) uretimi|kapasite kullan"
        r"|siparis|(?:sanayi|imalat|toptan) satis|ekonomik faaliyet|ibc-br|aktivite endeksi|faaliyet endeksi"
        r"|sabit varlik|\bkarlari?\b|verimlilik|oncu ekonomik|oncu endeks|es zamanli endeks|oncu gostergeler"
        r"|ucuncul sektor|(?:isletme|toptan|perakende) stok|isletme yatirimi|sermaye harcama|niesr|ekonomik tahmin))",
    ),
    (
        "surveys",
        r"\bpmi\b|\bism\b|\bifo\b|\bzew\b|tankan|\bcbi\b|\bcfib\b|\bnfib\b|ai group|\blmi\b|\bkof\b|guven"
        r"|iyimserlik|barometre|anket|ekonomik gozlemciler|\bfed\b.*endeks|philly fed|empire state|is ortami"
        r"|mevcut kosullar|tuketici beklentileri|michigan|\bbsi\b|westpac|\bnab\b|egilimleri",
    ),
    (
        "consumer",
        r"perakende satis|hanehalki (?:harcama|tuketim)|kisisel (?:gelir|harcama)|tuketici (?:kredisi|harcama)"
        r"|arac (?:satis|tescil)|otomobil satis|\bredbook\b|\bbrc\b|(?:ozel|nihai) tuketim|motorlu arac|binek arac"
        r"|toplam arac|magaza",
    ),
    ("housing", r"konut|mortgage|\bmba\b|yapi ruhsat|insaat|\bnahb\b|case-shiller|\brics\b|cotality"),
    (
        "trade",
        r"dis ticaret|ihracat|ithalat|cari islemler|mal ticaret|turist|\btic\b|yabanci menkul|yabanci tahvil"
        r"|yabancilarin hisse|dogrudan yabanci|\bdyy\b|sermaye akim|doviz rezerv|dis borc",
    ),
    ("fiscal", r"butce|yonetim borcu|brut borc|kamu sektoru|hazine nakit|\becofin\b|eurogroup|hukumet"),
    (
        "credit",
        r"^(?!.*faiz)(?:.*(?:para arzi|parasal taban|kredi|mevduat buyumesi|sosyal finansman|\bm[1-4]\b))",
    ),
    (
        "energy",
        r"\beia\b|\bapi ham|baker hughes|\biea\b|petrol|dogal gaz|\bwasde\b|\bnopa\b|tahil|emtia|benzin"
        r"|kalorifer|rafine|cushing",
    ),
    ("auction", r"ihale"),
    (
        "speech",
        r"konusma|basin toplantisi|tutanak|toplanti|genel kurul|bej kitap|muzakere ozeti|tartismasinin ozeti",
    ),
    ("holiday", r"\btatil\b|bayram"),
)
_TAG_RULES: tuple[tuple[str, re.Pattern[str]], ...] = tuple((tag, re.compile(p)) for tag, p in _TAG_PATTERNS)
OTHER_TAG = "other"
TAG_CODES: tuple[str, ...] = (*(tag for tag, _ in _TAG_PATTERNS), OTHER_TAG)
_KEY_EVENT_RE = re.compile(r"faiz karari")
# "(Benzin/Oto Hariç)", "(Gıda ve Enerji Hariç)": what a series EXCLUDES must not tag it.
_EXCLUSION_RE = re.compile(r"\([^()]*\bharic\)")


def calendar_tags(title: str) -> list[str]:
    """Topic tags for an event title, most important first; ``["other"]`` when nothing matches."""
    folded = _EXCLUSION_RE.sub(" ", fold(title))
    tags = [tag for tag, pattern in _TAG_RULES if pattern.search(folded)]
    return tags or [OTHER_TAG]


def is_key_event(title: str) -> bool:
    """Central-bank rate decisions (TCMB PPK, Fed, ECB ...) — the calendar's headline rows."""
    return bool(_KEY_EVENT_RE.search(fold(title)))


# The same topics for TradingView's English names (folded: lower case, no diacritics).
_CB_EN = r"^(?:fed|fomc|ecb|boe|boj|boc|rba|rbnz|snb|tcmb|cbrt|bcb|cbr|pboc|rbi|bok|ny fed)\b"
_TAG_PATTERNS_EN: tuple[tuple[str, str], ...] = (
    (
        "rates",
        r"interest rate decision|policy rate|deposit (?:facility )?rate|(?:overnight|marginal) (?:borrowing|lending)"
        r"|lending (?:facility )?rate|refinanc|discount rate|prime rate|cash rate|repo rate|selic|\bcopom\b"
        r"|monetary policy|rate projection|\bmpc\b|interest rate (?:statement|expectations)"
        rf"|{_CB_EN}.*(?:speech|press conference|rate|decision|minutes|meeting|balance sheet|purchase|summary|bulletin"
        r"|beige book|testimony|statement|opinions|deliberations|vote)",
    ),
    (
        "inflation",
        r"^(?!.*(?:house|home|dwelling|property)).*(?:inflation|\bcpi\b|\bppi\b|\bpce\b|\bhicp\b|deflator"
        r"|price index|prices\b|\bipca\b|igp-m|igp-10|ipc-fipe|price expectations|\brpi\b)",
    ),
    (
        "labor",
        r"employ|payroll|earnings|wage|labou?r (?:cost|force|market|productivity)|\bjolts?\b|\badp\b|hours"
        r"|jobless|job (?:cuts|quits|openings|ads|vacancies)|jobs|challenger|claimant|\bhmrc\b|participation rate"
        r"|jobseekers|unit labou?r",
    ),
    (
        "growth",
        r"^(?!.*debt).*(?:\bgdp\b|growth rate|(?:industrial|manufacturing|construction|auto|car|machine) (?:production|output)"
        r"|capacity utili|orders|(?:industrial|manufacturing|wholesale) sales|economic activity|ibc-br|activity index"
        r"|fixed asset|\bprofits?\b|productivity|leading (?:economic )?index|leading indicators|coincident index"
        r"|tertiary industry|(?:business|wholesale|retail) inventories|business investment|capital (?:expenditure|spending)"
        r"|niesr|economic forecast|infrastructure output|\bgdp\b)",
    ),
    (
        "surveys",
        r"\bpmi\b|\bism\b|\bifo\b|\bzew\b|tankan|\bcbi\b|\bcfib\b|\bnfib\b|ai group|\blmi\b|\bkof\b|confidence"
        r"|sentiment|optimism|barometer|survey|economy watchers|fed .*index|philly fed|empire state|business climate"
        r"|business outlook|current conditions|consumer expectations|michigan|\bbsi\b|westpac|\bnab\b|trends|\bgfk\b"
        r"|business conditions|economic outlook",
    ),
    (
        "consumer",
        r"retail sales|household (?:spending|consumption)|personal (?:income|spending)|consumer (?:credit|spending)"
        r"|(?:vehicle|car|auto) (?:sales|registrations)|\bredbook\b|\bbrc\b|(?:private|final) consumption|motor vehicle"
        r"|passenger car|total vehicle|distributive trades|consumer spending",
    ),
    (
        "housing",
        r"hous|home (?:sales|price|loans)|mortgage|\bmba\b|building permits|construction|\bnahb\b|case-shiller|\brics\b"
        r"|cotality|dwelling|property prices|building (?:consents|approvals)",
    ),
    (
        "trade",
        r"balance of trade|trade balance|exports|imports|current account|goods trade|tourist|\btic\b|foreign"
        r" (?:securities|bond|stock|investment|direct)|direct investment|\bfdi\b|capital flows|foreign exchange reserves"
        r"|fx reserves|external debt|terms of trade",
    ),
    ("fiscal", r"budget|government (?:debt|spending)|gross debt|public sector|treasury cash|\becofin\b|eurogroup|fiscal"),
    (
        "credit",
        r"^(?!.*\brate\b).*(?:money supply|monetary base|loan|lending|credit|deposit growth|social financing"
        r"|\bm[1-4]\b)",
    ),
    (
        "energy",
        r"\beia\b|\bapi crude|baker hughes|\biea\b|crude|\boil\b|natural gas|\bwasde\b|\bnopa\b|grain|commodit"
        r"|gasoline|heating oil|distillate|refinery|cushing|\bopec\b",
    ),
    ("auction", r"auction"),
    (
        "speech",
        r"speech|speaks|press conference|minutes|meeting|general assembly|beige book|summary of opinions|account of"
        r"|testimony|hearing|deliberations|summit",
    ),
    (
        "holiday",
        r"holiday|\bday\b|festival|golden week|equinox|new year|christmas|easter|thanksgiving|\bfeast\b|\beid\b",
    ),
)
_TAG_RULES_EN: tuple[tuple[str, re.Pattern[str]], ...] = tuple((tag, re.compile(p)) for tag, p in _TAG_PATTERNS_EN)
_KEY_EVENT_EN_RE = re.compile(r"interest rate decision")
# TradingView's own (coarse, sometimes odd) category — only when no name pattern matches.
_CATEGORY_TAGS = {
    "prce": "inflation",
    "lbr": "labor",
    "gdp": "growth",
    "bsnss": "surveys",
    "cnsm": "consumer",
    "hse": "housing",
    "trd": "trade",
    "gov": "fiscal",
    "mny": "rates",
    "bnd": "auction",
    "mrkt": "auction",
    "enrg": "energy",
}


def tradingview_tags(title_en: str, title_tr: str | None, category: str | None, all_day: bool) -> list[str]:
    """Topic tags for a TradingView event: English name patterns ∪ Turkish ones, category as fallback."""
    folded = fold(title_en)
    if all_day and _TAG_RULES_EN[-1][1].search(folded):
        return ["holiday"]
    found = {tag for tag, pattern in _TAG_RULES_EN[:-1] if pattern.search(folded)}
    if title_tr:
        found.update(tag for tag in calendar_tags(title_tr) if tag not in (OTHER_TAG, "holiday"))
    if not found and "election" in folded:
        return [OTHER_TAG]
    if not found and category in _CATEGORY_TAGS:
        found.add(_CATEGORY_TAGS[category])
    # TAG_CODES order: most important topic first (rates before speech, inflation before surveys ...).
    return [tag for tag in TAG_CODES if tag in found] or [OTHER_TAG]


def is_key_event_en(title_en: str) -> bool:
    return bool(_KEY_EVENT_EN_RE.search(fold(title_en)))


# ---------------------------------------------------------------------------
# Values
# ---------------------------------------------------------------------------

_MAGNITUDE = {"K": 1e3, "B": 1e3, "M": 1e6, "MN": 1e6, "MR": 1e9, "MLR": 1e9, "T": 1e12}
_NUMBER_RE = re.compile(r"^([+-]?[\d.,]+)\s*(%|K|B|M|MN|MR|MLR|T)?$", re.IGNORECASE)
# Turkish percentage notation used by doviz.com: "%7,6", "-%0,3", "%-0,3".
_LEADING_PERCENT_RE = re.compile(r"^([+-]?)%([+-]?[\d.,]+)$")


def calendar_number(value: Any) -> float | None:
    """``"91,9"`` → 91.9, ``"-0,3%"`` / ``"%-0,3"`` → -0.3, ``"250K"`` → 250000; anything else → ``None``."""
    if value is None:
        return None
    text = str(value).strip().replace("\xa0", "").replace(" ", "")
    leading = _LEADING_PERCENT_RE.match(text)
    if leading:
        sign, digits = leading.groups()
        if sign == "-":
            digits = digits[1:] if digits.startswith("-") else f"-{digits.lstrip('+')}"
        text = f"{digits}%"
    match = _NUMBER_RE.match(text)
    if not match:
        return None
    number_text, suffix = match.group(1), (match.group(2) or "").upper()
    if "," in number_text:
        number_text = number_text.replace(".", "").replace(",", ".")
    elif number_text.count(".") > 1:
        number_text = number_text.replace(".", "")
    try:
        number = float(number_text)
    except ValueError:
        return None
    return number * _MAGNITUDE.get(suffix, 1.0) if suffix and suffix != "%" else number


_SCALES = ("K", "M", "B", "T")


def format_tr_number(value: float) -> str:
    """``-1234.5`` → ``"-1.234,5"`` (Turkish separators, as many decimals as the source gave)."""
    text = f"{value:.10g}"
    if "e" in text:  # tiny/huge values: fixed notation, trailing zeros trimmed
        text = f"{value:.6f}".rstrip("0").rstrip(".")
    sign = "-" if text.startswith("-") else ""
    whole, _, fraction = text.lstrip("-").partition(".")
    grouped = f"{int(whole):,}".replace(",", ".")
    return f"{sign}{grouped},{fraction}" if fraction else f"{sign}{grouped}"


def format_tr_value(value: float | None, unit: str | None, scale: str | None) -> str | None:
    """doviz.com-style text for a TradingView value: ``"%31,51"``, ``"-5,24B"``, ``"206K"`` (currency → ``unit``)."""
    if value is None:
        return None
    number = format_tr_number(value)
    if unit == "%":
        return f"%{number}"
    return f"{number}{scale}" if scale in _SCALES else number


# ---------------------------------------------------------------------------
# HTML parsing
# ---------------------------------------------------------------------------


def _cell_text(cell: Any) -> str | None:
    text = " ".join(cell.get_text(" ", strip=True).split())
    return text or None


def _parse_day_header(text: str) -> date | None:
    """``"22 Eylül 2026"`` → ``date(2026, 9, 22)``."""
    parts = fold(text).split()
    if len(parts) != 3 or parts[1] not in _TR_MONTHS:
        return None
    try:
        return date(int(parts[2]), _TR_MONTHS[parts[1]], int(parts[0]))
    except ValueError:
        return None


def _is_day_header(element: Any) -> bool:
    classes = element.get("class") or []
    return element.name == "div" and "text-bold" in classes and "text-center" in classes


def _importance(cell: Any) -> str:
    marker = cell.find("span", class_="importance")
    classes = {str(cls) for cls in (marker.get("class") or [])} if marker else set()
    return next((level for level in reversed(IMPORTANCE_LEVELS) if level in classes), "low")


def _parse_tab(container: Any) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    day: date | None = None
    for element in container.find_all(["div", "tr"]):
        if element.name == "div":
            if _is_day_header(element):
                day = _parse_day_header(element.get_text(" ", strip=True))
            continue
        cells = element.find_all("td", recursive=False)
        if len(cells) < 7 or day is None:
            continue
        event = _cell_text(cells[3])
        if not event:
            continue
        time_text = _cell_text(cells[0]) or ""
        rows.append(
            {
                "day": day,
                "time": time_text if _TIME_RE.match(time_text) else None,
                "country": _cell_text(cells[1]),
                "importance": _importance(cells[2]),
                "event": event,
                "actual": _cell_text(cells[4]),
                "forecast": _cell_text(cells[5]),
                "previous": _cell_text(cells[6]),
            }
        )
    return rows


def _row_key(row: dict[str, Any]) -> tuple[Any, ...]:
    return row["day"], row["time"], row["event"]


def _completeness(row: dict[str, Any]) -> int:
    return sum(row[field] is not None for field in ("actual", "forecast", "previous"))


def _merge_tabs(tabs: Sequence[Sequence[dict[str, Any]]]) -> list[dict[str, Any]]:
    """Union of overlapping tabs: per key, as many rows as the tab that lists it most often."""
    merged: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
    for rows in tabs:
        groups: dict[tuple[Any, ...], list[dict[str, Any]]] = {}
        for row in rows:
            groups.setdefault(_row_key(row), []).append(row)
        for key, group in groups.items():
            kept = merged.setdefault(key, [])
            for index, row in enumerate(group):
                if index >= len(kept):
                    kept.append(row)
                elif _completeness(row) > _completeness(kept[index]):
                    kept[index] = row
    return [row for rows in merged.values() for row in rows]


def _split_title(event: str) -> tuple[str, str | None]:
    """``"Enflasyon Oranı  (Yıllık) (-)"`` → ``("Enflasyon Oranı (Yıllık)", None)``; ``"... (Eylül)"`` → period ``"Eylül"``."""
    name = " ".join(event.split())
    match = _PERIOD_SUFFIX_RE.search(name)
    if not match:
        return name, None
    title = name[: match.start()].strip() or name
    period = match.group(1).strip()
    return title, (period if period and period != "-" else None)


def _row_id(code: str, row: dict[str, Any], occurrence: int) -> str:
    raw = f"{code}|{row['day'].isoformat()}|{row['time'] or ''}|{row['event']}|{occurrence}"
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def _record(code: str, row: dict[str, Any], occurrence: int) -> dict[str, Any]:
    day: date = row["day"]
    time_text: str | None = row["time"]
    hour, minute = (int(part) for part in time_text.split(":")) if time_text else (0, 0)
    when = datetime(day.year, day.month, day.day, hour % 24, minute % 60, tzinfo=ISTANBUL_TZ)
    title, period = _split_title(row["event"])
    period_match = _PERIOD_SUFFIX_RE.search(" ".join(row["event"].split()))
    return {
        # Legacy (capitalized, doviz.com/borsapy) keys — unchanged contract.
        "Date": day.isoformat(),
        "Time": time_text,
        "Country": row["country"] or CALENDAR_COUNTRIES.get(code, code),
        "Importance": row["importance"],
        "Event": row["event"],
        "Actual": row["actual"],
        "Forecast": row["forecast"],
        "Previous": row["previous"],
        "Period": period_match.group(1).strip() if period_match else None,
        "datetime": when.isoformat(),
        "all_day": time_text is None,
        "actual_value": calendar_number(row["actual"]),
        "forecast_value": calendar_number(row["forecast"]),
        "previous_value": calendar_number(row["previous"]),
        # add-only
        "id": _row_id(code, row, occurrence),
        "country_code": code,
        "title": title,
        "period_label": period,
        "tags": calendar_tags(title),
        "key_event": is_key_event(title),
        # add-only, shared with the TradingView rows
        "title_en": None,
        "title_tr": title,
        "unit": None,
        "scale": None,
        "reference_date": None,
        "source_name": None,
        "source_url": None,
        "provider": "doviz",
    }


def parse_calendar_html(html: str, code: str) -> list[dict[str, Any]]:
    """doviz.com ``calendarHTML`` → calendar rows for country ``code`` (unsorted)."""
    soup = BeautifulSoup(html, "lxml")
    tabs = soup.find_all("div", id=re.compile(r"^calendar-content-\d+$")) or [soup]
    rows = _merge_tabs([_parse_tab(tab) for tab in tabs])
    seen: dict[tuple[Any, ...], int] = {}
    records = []
    for row in rows:
        key = _row_key(row)
        occurrence = seen.get(key, 0)
        seen[key] = occurrence + 1
        records.append(_record(code, row, occurrence))
    return records


# ---------------------------------------------------------------------------
# Fetching
# ---------------------------------------------------------------------------


def _doviz_request() -> tuple[str, dict[str, str]]:
    """Endpoint + headers. The public bearer token is borsapy's, so a borsapy upgrade keeps it current."""
    try:
        from borsapy._providers.dovizcom_calendar import DovizcomCalendarProvider as Provider
    except ImportError as e:  # pragma: no cover - only if borsapy moves the provider
        raise MarketDataError("Ekonomik takvim kaynağı yapılandırılamadı") from e
    headers = {
        **Provider.DEFAULT_HEADERS,
        "Authorization": f"Bearer {Provider.BEARER_TOKEN}",
        "Accept": "application/json",
    }
    return Provider.BASE_URL, headers


@cached(TTL_CALENDAR, "macro_calendar_country")
async def _fetch_country(code: str) -> dict[str, Any]:
    """One country's calendar window (raises on failure, so failures are not cached)."""
    url, headers = _doviz_request()
    response = await get_http_client().get(
        url, params={"country": code, "importance": _ALL_IMPORTANCE}, headers=headers
    )
    response.raise_for_status()
    try:
        payload = response.json()
    except ValueError as e:
        raise MarketDataError("Ekonomik takvim yanıtı okunamadı") from e
    html = payload.get("calendarHTML") if isinstance(payload, dict) else None
    if not isinstance(html, str):
        raise MarketDataError("Ekonomik takvim yanıtı beklenen biçimde değil")
    rows = await run_sync(parse_calendar_html, html, code)
    return {"rows": rows, "fetched_at": datetime.now(ISTANBUL_TZ).isoformat(timespec="seconds")}


async def _fetch_countries(codes: Sequence[str]) -> tuple[dict[str, dict[str, Any]], list[str]]:
    semaphore = asyncio.Semaphore(_FETCH_CONCURRENCY)

    async def fetch(code: str) -> dict[str, Any]:
        async with semaphore:
            return await _fetch_country(code)

    results = await asyncio.gather(*(fetch(code) for code in codes), return_exceptions=True)
    fetched: dict[str, dict[str, Any]] = {}
    failed: list[str] = []
    for code, result in zip(codes, results, strict=True):
        if isinstance(result, BaseException):
            if not isinstance(result, Exception):  # CancelledError / KeyboardInterrupt
                raise result
            logger.warning("macro_calendar_country_unavailable", country=code, error=f"{type(result).__name__}: {result}")
            failed.append(code)
        else:
            fetched[code] = result
    return fetched, failed


# ---------------------------------------------------------------------------
# TradingView
# ---------------------------------------------------------------------------

_TR_MONTH_ABBR = ("Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara")
_EN_MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}
_TRADINGVIEW_IMPORTANCE = {1: "high", 0: "mid", -1: "low"}
_TRADINGVIEW_ATTEMPTS = 2


def months_between(start: date, end: date) -> list[str]:
    """``"YYYY-MM"`` of every month overlapping ``[start, end]``."""
    months: list[str] = []
    year, month = start.year, start.month
    while (year, month) <= (end.year, end.month):
        months.append(f"{year:04d}-{month:02d}")
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)
    return months


def _add_months(day: date, count: int) -> date:
    """First day of the month ``count`` months after ``day``'s month."""
    index = day.year * 12 + day.month - 1 + count
    return date(index // 12, index % 12 + 1, 1)


def resolve_window(start: date | None, end: date | None, today: date) -> tuple[date, date]:
    """The days a request covers: last month → next month by default; one bound → the month beside it."""
    if start is None and end is None:
        start, end = _add_months(today, -1), _add_months(today, 2) - timedelta(days=1)
    elif start is None:
        assert end is not None
        start = _add_months(end, -1)
    elif end is None:
        end = _add_months(start, 2) - timedelta(days=1)
    if (end - start).days + 1 > MAX_WINDOW_DAYS:
        raise InvalidInputError(f"Tarih aralığı en fazla {MAX_WINDOW_DAYS} gün olabilir.")
    return start, end


def _utc_param(moment: datetime) -> str:
    return moment.astimezone(UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


async def fetch_tradingview_month(month: str) -> list[dict[str, Any]]:
    """Raw TradingView events of one Istanbul month, every supported country (raises on failure)."""
    year, number = (int(part) for part in month.split("-"))
    first = date(year, number, 1)
    start = datetime(first.year, first.month, 1, tzinfo=ISTANBUL_TZ)
    following = _add_months(first, 1)
    end = datetime(following.year, following.month, 1, tzinfo=ISTANBUL_TZ)
    params = {
        "from": _utc_param(start),
        "to": _utc_param(end - timedelta(milliseconds=1)),
        "countries": ",".join(CALENDAR_COUNTRIES),
    }
    response: httpx.Response | None = None
    for attempt in range(_TRADINGVIEW_ATTEMPTS):
        try:
            response = await get_http_client().get(
                TRADINGVIEW_CALENDAR_URL, params=params, headers=_TRADINGVIEW_HEADERS, timeout=_TRADINGVIEW_TIMEOUT
            )
            if response.status_code == 429 or response.status_code >= 500:
                response.raise_for_status()
            break
        except httpx.HTTPError:
            if attempt + 1 == _TRADINGVIEW_ATTEMPTS:
                raise
            await asyncio.sleep(0.5)
    assert response is not None
    response.raise_for_status()
    try:
        payload = response.json()
    except ValueError as e:
        raise MarketDataError("TradingView takvim yanıtı okunamadı") from e
    result = payload.get("result") if isinstance(payload, dict) else None
    if not isinstance(result, list):
        raise MarketDataError("TradingView takvim yanıtı beklenen biçimde değil")
    return [{field: event.get(field) for field in _TRADINGVIEW_FIELDS} for event in result if isinstance(event, dict)]


def _finite(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return None
    number = float(value)
    return number if math.isfinite(number) else None


def _text(value: Any) -> str | None:
    text = " ".join(str(value).split()) if value is not None else ""
    return text or None


def _reference_day(value: Any) -> date | None:
    text = _text(value)
    try:
        return date.fromisoformat(text[:10]) if text else None
    except ValueError:
        return None


def period_label_tr(period: str | None) -> str | None:
    """TradingView ``"Aug"`` / ``"Sep/04"`` / ``"Q3"`` → ``"Ağu"`` / ``"4 Eyl"`` / ``"3. Çeyrek"``."""
    if not period:
        return None
    if match := re.fullmatch(r"Q([1-4])", period):
        return f"{match.group(1)}. Çeyrek"
    if match := re.fullmatch(r"([A-Za-z]{3,4})/(\d{1,2})", period):
        month = _EN_MONTHS.get(match.group(1).lower())
        return f"{int(match.group(2))} {_TR_MONTH_ABBR[month - 1]}" if month else period
    month = _EN_MONTHS.get(period.lower())
    return _TR_MONTH_ABBR[month - 1] if month else period


def tradingview_record(event: Mapping[str, Any]) -> dict[str, Any] | None:
    """One TradingView event → a calendar row (the doviz.com rows' shape); ``None`` when unusable."""
    code = str(event.get("country") or "").upper()
    title_en = _text(event.get("title"))
    if code not in CALENDAR_COUNTRIES or not title_en:
        return None
    try:
        moment = datetime.fromisoformat(str(event.get("date") or "").replace("Z", "+00:00"))
    except ValueError:
        return None
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=UTC)

    actual, forecast, previous = (_finite(event.get(field)) for field in ("actual", "forecast", "previous"))
    period = _text(event.get("period"))
    utc = moment.astimezone(UTC)
    # Holidays, summits, elections: midnight UTC, no period and no values.
    all_day = (utc.hour, utc.minute, utc.second) == (0, 0, 0) and not period and actual is previous is forecast is None
    if all_day:
        day = utc.date()
        time_text = None
        when = datetime(day.year, day.month, day.day, tzinfo=ISTANBUL_TZ)
    else:
        when = moment.astimezone(ISTANBUL_TZ)
        day = when.date()
        time_text = when.strftime("%H:%M")

    title_tr = translate_title(title_en)
    title = title_tr or title_en
    unit = _text(event.get("unit"))
    scale_text = (_text(event.get("scale")) or "").upper()
    scale = scale_text if scale_text in _SCALES else None
    level = event.get("importance")
    importance = learned_importance(code, title_en) or (
        _TRADINGVIEW_IMPORTANCE.get(level, "low") if isinstance(level, int) else "low"
    )
    period_tr = period_label_tr(period)
    reference = _reference_day(event.get("referenceDate"))
    event_id = _text(event.get("id"))
    row_id = f"tv{event_id}" if event_id else hashlib.sha1(f"{code}|{when.isoformat()}|{title_en}".encode()).hexdigest()[:12]
    return {
        # Legacy keys (doviz.com/borsapy shape); values in doviz.com's Turkish notation.
        "Date": day.isoformat(),
        "Time": time_text,
        "Country": CALENDAR_COUNTRIES[code],
        "Importance": importance,
        "Event": f"{title} ({period_tr})" if period_tr else title,
        "Actual": format_tr_value(actual, unit, scale),
        "Forecast": format_tr_value(forecast, unit, scale),
        "Previous": format_tr_value(previous, unit, scale),
        "Period": period_tr,
        "datetime": when.isoformat(),
        "all_day": all_day,
        "actual_value": actual,
        "forecast_value": forecast,
        "previous_value": previous,
        # add-only
        "id": row_id,
        "country_code": code,
        "title": title,
        "period_label": period,
        "tags": tradingview_tags(title_en, title_tr, _text(event.get("category")), all_day),
        "key_event": is_key_event_en(title_en) or bool(title_tr and is_key_event(title_tr)),
        "title_en": title_en,
        "title_tr": title_tr,
        "unit": unit,
        "scale": scale,
        "reference_date": reference.isoformat() if reference else None,
        "source_name": _text(event.get("source")),
        "source_url": _text(event.get("source_url")),
        "provider": "tradingview",
    }


def tradingview_rows(events: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    rows: dict[str, dict[str, Any]] = {}
    for event in events:
        record = tradingview_record(event)
        if record is not None:
            rows.setdefault(record["id"], record)
    return list(rows.values())


def fill_series_units(
    rows: Sequence[dict[str, Any]], siblings: Sequence[dict[str, Any]] | None = None
) -> list[dict[str, Any]]:
    """Unit and scale for TradingView rows that came without them, from the same series.

    TradingView leaves ``unit``/``scale`` off some scheduled releases (Türkiye's CPI before
    the day: previous 31.51, no "%"), while the series' released rows carry them. Rows with
    neither get the latest sibling's (same country, same English name, from ``siblings`` or
    ``rows``) and their values are written again. Rows are copied, never changed in place:
    they come from the month cache.
    """
    known: dict[tuple[str, str], tuple[str | None, str | None]] = {}
    for row in sorted(siblings if siblings is not None else rows, key=lambda item: item["datetime"]):
        if row.get("provider") == "tradingview" and row.get("title_en") and (row.get("unit") or row.get("scale")):
            known[(row["country_code"], row["title_en"])] = (row.get("unit"), row.get("scale"))
    filled: list[dict[str, Any]] = []
    for row in rows:
        found = None
        if row.get("provider") == "tradingview" and not (row.get("unit") or row.get("scale")):
            found = known.get((row["country_code"], row.get("title_en") or ""))
        if found is None:
            filled.append(row)
            continue
        unit, scale = found
        filled.append(
            {
                **row,
                "unit": unit,
                "scale": scale,
                "Actual": format_tr_value(row.get("actual_value"), unit, scale),
                "Forecast": format_tr_value(row.get("forecast_value"), unit, scale),
                "Previous": format_tr_value(row.get("previous_value"), unit, scale),
            }
        )
    return filled


async def _tradingview_month(month: str) -> dict[str, Any]:
    events = await fetch_tradingview_month(month)
    rows = await run_sync(tradingview_rows, events)
    return {"rows": rows, "fetched_at": datetime.now(ISTANBUL_TZ).isoformat(timespec="seconds")}


@cached(TTL_CALENDAR, "macro_calendar_tv_month")
async def _tradingview_month_live(month: str) -> dict[str, Any]:
    """This month and later: actuals fill in during the day."""
    return await _tradingview_month(month)


@cached(TTL_CALENDAR_ARCHIVE, "macro_calendar_tv_month_archive")
async def _tradingview_month_archive(month: str) -> dict[str, Any]:
    """Months already over: only revisions change them."""
    return await _tradingview_month(month)


async def _fetch_tradingview(months: Sequence[str], current_month: str) -> tuple[dict[str, dict[str, Any]], list[str]]:
    semaphore = asyncio.Semaphore(_FETCH_CONCURRENCY)

    async def fetch(month: str) -> dict[str, Any]:
        async with semaphore:
            loader = _tradingview_month_archive if month < current_month else _tradingview_month_live
            return await loader(month)

    results = await asyncio.gather(*(fetch(month) for month in months), return_exceptions=True)
    fetched: dict[str, dict[str, Any]] = {}
    failed: list[str] = []
    for month, result in zip(months, results, strict=True):
        if isinstance(result, BaseException):
            if not isinstance(result, Exception):  # CancelledError / KeyboardInterrupt
                raise result
            logger.warning("macro_calendar_month_unavailable", month=month, error=f"{type(result).__name__}: {result}")
            failed.append(month)
        else:
            fetched[month] = result
    return fetched, failed


# ---------------------------------------------------------------------------
# Query parsing + filtering
# ---------------------------------------------------------------------------


def _tokens(raw: str | Sequence[str] | None) -> list[str]:
    items = raw.split(",") if isinstance(raw, str) else list(raw or [])
    return [item.strip() for item in items if item and item.strip()]


def _unique(values: Sequence[str]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(values))


@dataclass(frozen=True)
class CalendarQuery:
    countries: tuple[str, ...] = DEFAULT_COUNTRIES
    start: date | None = None
    end: date | None = None
    importance: tuple[str, ...] = ()
    tags: tuple[str, ...] = ()
    q: str | None = None

    @classmethod
    def parse(
        cls,
        countries: str | Sequence[str] | None = None,
        start: str | date | None = None,
        end: str | date | None = None,
        importance: str | Sequence[str] | None = None,
        tags: str | Sequence[str] | None = None,
        q: str | None = None,
    ) -> CalendarQuery:
        """Validate raw (query-string) filters; anything unknown → :class:`InvalidInputError` (HTTP 400)."""
        codes = [token.upper() for token in _tokens(countries)]
        if "ALL" in codes:
            codes = list(CALENDAR_COUNTRIES)
        unknown = [code for code in codes if code not in CALENDAR_COUNTRIES]
        if unknown:
            raise InvalidInputError(
                f"Geçersiz ülke kodu: {', '.join(unknown)}. Geçerli kodlar: {', '.join(CALENDAR_COUNTRIES)}"
            )

        levels = [_IMPORTANCE_ALIASES.get(fold(token), fold(token)) for token in _tokens(importance)]
        if any(level not in IMPORTANCE_LEVELS for level in levels):
            raise InvalidInputError("Geçersiz önem düzeyi (low, mid, high).")

        topic_tags = [fold(token) for token in _tokens(tags)]
        if any(tag not in TAG_CODES for tag in topic_tags):
            raise InvalidInputError(f"Geçersiz etiket. Geçerli etiketler: {', '.join(TAG_CODES)}")

        start_day, end_day = _parse_day(start, "start"), _parse_day(end, "end")
        if start_day and end_day and start_day > end_day:
            raise InvalidInputError("'start' tarihi 'end' tarihinden sonra olamaz.")

        text = " ".join((q or "").split())
        return cls(
            countries=_unique(codes) or DEFAULT_COUNTRIES,
            start=start_day,
            end=end_day,
            importance=_unique(levels),
            tags=_unique(topic_tags),
            q=text or None,
        )


def _parse_day(value: str | date | None, name: str) -> date | None:
    if value is None or isinstance(value, date):
        return value
    text = value.strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError as e:
        raise InvalidInputError(f"Geçersiz '{name}' tarihi (YYYY-AA-GG bekleniyor).") from e


def _search_text(row: dict[str, Any]) -> str:
    names = " ".join(filter(None, (row["title"], row.get("title_en"), row.get("title_tr"))))
    return fold(f"{names} {row['Country']} {row['country_code']} {row.get('period_label') or ''}")


def filter_calendar(rows: Sequence[dict[str, Any]], query: CalendarQuery) -> list[dict[str, Any]]:
    """Rows matching every active filter; ``q`` is a Turkish-insensitive AND of words."""
    start = query.start.isoformat() if query.start else None
    end = query.end.isoformat() if query.end else None
    importance = set(query.importance)
    tags = set(query.tags)
    terms = fold(query.q).split() if query.q else []
    result = []
    for row in rows:
        if start and row["Date"] < start or end and row["Date"] > end:
            continue
        if importance and row["Importance"] not in importance:
            continue
        if tags and not tags.intersection(row["tags"]):
            continue
        if terms:
            haystack = _search_text(row)
            if not all(term in haystack for term in terms):
                continue
        result.append(row)
    return result


def _sort_key(order: dict[str, int]) -> Any:
    return lambda row: (row["datetime"], order.get(row["country_code"], len(order)), row["title"])


def _today() -> date:
    return datetime.now(ISTANBUL_TZ).date()


async def get_economic_calendar(
    countries: str | Sequence[str] | None = None,
    *,
    start: str | date | None = None,
    end: str | date | None = None,
    importance: str | Sequence[str] | None = None,
    tags: str | Sequence[str] | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    """Ekonomik takvim: seçili ülkeler (varsayılan TR + ABD), zamana göre sıralı.

    ``start``/``end`` hem pencereyi (hangi aylar çekilecek) hem filtreyi belirler; ikisi de
    yoksa pencere geçen ayın başından gelecek ayın sonuna kadardır (en fazla 124 gün).
    TradingView'e ulaşılamayan aylar ``unavailable_months``'ta döner; içinde bulunulan ay
    için doviz.com yedeği denenir (``providers``). Hiç veri yoksa hata değil
    ``available: false``; geçersiz filtre → ``{"error": ..., "error_status": 400}``.
    """
    try:
        query = CalendarQuery.parse(countries, start, end, importance, tags, q)
        today = _today()
        window_start, window_end = resolve_window(query.start, query.end, today)
    except InvalidInputError as e:
        return error_payload(e, "Geçersiz takvim filtresi")

    months = months_between(window_start, window_end)
    current_month = today.strftime("%Y-%m")
    fetched, unavailable = await _fetch_tradingview(months, current_month)
    rows_by_month = {month: result["rows"] for month, result in fetched.items()}
    fetched_at = [result["fetched_at"] for result in fetched.values()]
    providers = ["tradingview"] if fetched else []
    failed_countries: list[str] = []

    if current_month in unavailable:
        # doviz.com only publishes the current month (Turkish names, no forecasts).
        dz_fetched, failed_countries = await _fetch_countries(query.countries)
        month_start = today.replace(day=1).isoformat()
        month_end = (_add_months(today, 1) - timedelta(days=1)).isoformat()
        if dz_fetched:
            rows_by_month[current_month] = [
                row
                for code in query.countries
                if code in dz_fetched
                for row in dz_fetched[code]["rows"]
                if month_start <= row["Date"] <= month_end
            ]
            fetched_at.extend(dz_fetched[code]["fetched_at"] for code in dz_fetched)
            providers.append("doviz")
            unavailable = [month for month in unavailable if month != current_month]

    selected = set(query.countries)
    first_day, last_day = window_start.isoformat(), window_end.isoformat()
    order = {code: index for index, code in enumerate(CALENDAR_COUNTRIES)}
    fetched_rows = [row for month in months for row in rows_by_month.get(month, []) if row["country_code"] in selected]
    all_rows = sorted(
        fill_series_units([row for row in fetched_rows if first_day <= row["Date"] <= last_day], siblings=fetched_rows),
        key=_sort_key(order),
    )
    return {
        "calendar": filter_calendar(all_rows, query),
        "source": TRADINGVIEW_SOURCE_LABEL if "tradingview" in providers else SOURCE_LABEL if providers else None,
        "available": bool(all_rows),
        # add-only
        "total": len(all_rows),
        "countries": [{"code": code, "name": CALENDAR_COUNTRIES[code]} for code in query.countries],
        "supported_countries": [{"code": code, "name": name} for code, name in CALENDAR_COUNTRIES.items()],
        "failed_countries": failed_countries,
        "window": {"start": first_day, "end": last_day},
        "as_of": min(fetched_at) if fetched_at else None,
        "providers": providers,
        "unavailable_months": unavailable,
    }
