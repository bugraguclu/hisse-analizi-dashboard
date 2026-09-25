"""KAP bildirimleri adaptörü (polling worker + bildirim içeriği).

Birincil kaynak KAP'ın genel bildirim listesidir
(``POST /tr/api/disclosure/members/byCriteria``): tek istek, verilen tarih aralığındaki
TÜM şirketlerin bildirimlerini özet, yayımlayan kurum ve ilgili hisse kodlarıyla döndürür.
Polling döngüsü listeyi bir kez indirir (single-flight + kısa TTL) ve her şirket için hisse
koduna göre süzer. Eskiden şirket başına bir sorgu atılıyordu (~100 istek/döngü); KAP'ın
WAF'ı bunu "Server disconnected" ile kesiyor ve akış saatlerce güncellenmiyordu.

Bildirimin tam metni (``GET /tr/api/notification/attachment-detail/{index}``) yalnızca
kullanıcı bir bildirimi açtığında istenir; ``parse_disclosure_body`` KAP'ın iki HTML
biçimini (XBRL taksonomi formları ve eski rapor formları) başlık / alan / metin / tablo
bloklarına çevirir.

Tarihler KAP'ta ``GG.AA.YYYY SS:DD:ss`` biçiminde İstanbul yerel saatidir; ``parse_date``
bunları Europe/Istanbul saat dilimli (doğru an) datetime'a çevirir. İçerik hash'i ve dedup
anahtarı bu yerel gösterimle ve form adıyla (``subject``) hesaplanır — önceki kayıtlarla
(borsapy dönemi) aynı anahtarlar üretilir; değiştirilmemelidir. Veritabanı ``timestamptz``
olduğundan an UTC olarak saklanır.
"""

import asyncio
import re
import time
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any, Literal
from zoneinfo import ZoneInfo

import httpx
import structlog
from bs4 import BeautifulSoup, Comment, NavigableString, Tag

from src.adapters.base import BaseAdapter, RawEventData
from src.adapters.utils import cached
from src.core.config import settings
from src.core.time import utcnow
from src.db.models import PollingState
from src.parsers.helpers import clean_whitespace, compute_content_hash, parse_date

logger = structlog.get_logger(__name__)

KAP_BASE_URL = "https://www.kap.org.tr"
KAP_DISCLOSURE_URL = KAP_BASE_URL + "/tr/Bildirim/{index}"
KAP_LIST_URL = KAP_BASE_URL + "/tr/api/disclosure/members/byCriteria"
KAP_DETAIL_URL = KAP_BASE_URL + "/tr/api/notification/attachment-detail/{index}"
_LIST_REFERER = KAP_BASE_URL + "/tr/bildirim-sorgu"

# The list endpoint returns at most this many rows and, when it truncates, silently keeps
# the NEWEST ones (no error, no cursor). Wider ranges are bisected by date.
LIST_RESULT_CAP = 2000
_TIMEOUT = httpx.Timeout(12.0, connect=5.0)
# One download serves a whole polling cycle (all companies) and every API process request.
_FEED_TTL_SECONDS = 45
# After a failed request (WAF disconnect, timeout, 5xx) fail fast instead of re-poking KAP.
_FAILURE_COOLDOWN_SECONDS = 90
# Spacing between consecutive KAP requests of this process (backfills, content views).
_MIN_REQUEST_INTERVAL_SECONDS = 1.0
# A poller that was down for a while catches up at most this far back (older gaps: backfill).
CATCH_UP_MAX_DAYS = 7
_ISTANBUL = ZoneInfo("Europe/Istanbul")

_failed_until = 0.0
_request_lock: asyncio.Lock | None = None
_last_request_at = 0.0
_client: httpx.AsyncClient | None = None


class KapUnavailableError(RuntimeError):
    """KAP did not answer usably; the poll counts as failed (and backs off)."""


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(
            timeout=_TIMEOUT,
            headers={
                "User-Agent": f"{settings.user_agent} (+https://github.com/bugraguclu/hisse-analizi-dashboard)",
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": "tr-TR,tr;q=0.9",
            },
            follow_redirects=True,
            # Docker VM has no IPv6 egress (same reason as adapters.utils.get_http_client).
            transport=httpx.AsyncHTTPTransport(local_address="0.0.0.0"),
        )
    return _client


def _lock() -> asyncio.Lock:
    global _request_lock
    if _request_lock is None:
        _request_lock = asyncio.Lock()
    return _request_lock


async def _request(method: Literal["GET", "POST"], url: str, *, referer: str, json_body: Any = None) -> Any:
    """One polite KAP request (serialised + spaced per process) returning parsed JSON.

    Raises :class:`KapUnavailableError` on any network/HTTP/format failure and starts a
    cooldown during which further calls fail immediately: a WAF disconnect does not lift
    in seconds and retrying only extends it.
    """
    global _failed_until, _last_request_at
    # The cooldown mirrors KAP's block, which lasts in wall-clock time (a monotonic clock
    # stops while a laptop sleeps and would stretch it); request spacing stays monotonic.
    if time.time() < _failed_until:
        raise KapUnavailableError("KAP recently failed; retrying after cooldown")
    async with _lock():
        if time.time() < _failed_until:
            raise KapUnavailableError("KAP recently failed; retrying after cooldown")
        wait = _last_request_at + _MIN_REQUEST_INTERVAL_SECONDS - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            resp = await _get_client().request(method, url, json=json_body, headers={"Referer": referer})
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            _failed_until = time.time() + _FAILURE_COOLDOWN_SECONDS
            raise KapUnavailableError(f"{type(e).__name__}: {e}"[:300]) from e
        finally:
            _last_request_at = time.monotonic()


def reset_state() -> None:
    """Forget cooldown/spacing state (tests)."""
    global _failed_until, _last_request_at
    _failed_until = 0.0
    _last_request_at = 0.0


# ---------------------------------------------------------------------------
# Disclosure list
# ---------------------------------------------------------------------------


async def _fetch_list_raw(from_date: date, to_date: date) -> list[dict[str, Any]]:
    data = await _request(
        "POST",
        KAP_LIST_URL,
        referer=_LIST_REFERER,
        json_body={
            "fromDate": from_date.isoformat(),
            "toDate": to_date.isoformat(),
            "mkkMemberOidList": [],
            "subjectList": [],
        },
    )
    if not isinstance(data, list):
        raise KapUnavailableError(f"unexpected KAP list format: {type(data).__name__}")
    return [item for item in data if isinstance(item, dict)]


async def fetch_disclosure_list(from_date: date, to_date: date) -> list[dict[str, Any]]:
    """Every KAP disclosure (all members) published on ``from_date``..``to_date`` (Istanbul days).

    A window that comes back at the result cap is bisected until it fits; a single day over
    the cap cannot be narrowed further and keeps only its newest rows (logged).
    """
    if from_date > to_date:
        return []
    data = await _fetch_list_raw(from_date, to_date)
    if len(data) < LIST_RESULT_CAP:
        return data
    if from_date == to_date:
        logger.warning("kap_list_day_over_cap", day=from_date.isoformat(), cap=LIST_RESULT_CAP)
        return data
    mid = from_date + timedelta(days=(to_date - from_date).days // 2)
    merged: dict[str, dict[str, Any]] = {}
    for item in (*await fetch_disclosure_list(from_date, mid), *await fetch_disclosure_list(mid + timedelta(days=1), to_date)):
        merged[str(item.get("disclosureIndex") or id(item))] = item
    return list(merged.values())


@cached(ttl_seconds=_FEED_TTL_SECONDS, key_prefix="kap")
async def fetch_recent_disclosures(from_date: date, to_date: date) -> list[dict[str, Any]]:
    """Shared, short-lived cache of the list for the polling window (one download per cycle)."""
    return await fetch_disclosure_list(from_date, to_date)


def istanbul_today(now: datetime | None = None) -> date:
    return (now or utcnow()).astimezone(_ISTANBUL).date()


def polling_window(state: PollingState | None, now: datetime | None = None) -> tuple[date, date]:
    """Istanbul-day range to request: yesterday..today normally (so disclosures published just
    before midnight are never missed), reaching back to the last successful poll after an
    outage, capped at ``CATCH_UP_MAX_DAYS``."""
    today = istanbul_today(now)
    start = today - timedelta(days=1)
    last_success = state.last_success_at if state is not None else None
    if last_success is not None:
        start = min(start, last_success.astimezone(_ISTANBUL).date())
    return max(start, today - timedelta(days=CATCH_UP_MAX_DAYS)), today


# ---------------------------------------------------------------------------
# List item -> RawEventData
# ---------------------------------------------------------------------------

_DISCLOSURE_ID_RE = re.compile(r"/Bildirim/(\d+)", re.IGNORECASE)
_STOCK_CODE_SPLIT_RE = re.compile(r"[\s,;/]+")
# KAP replaces typographic apostrophes with "?" ("Endeksi?ne", "A.Ş.?DEN").
_BROKEN_APOSTROPHE_RE = re.compile(r"(?<=[^\W\d_])\?(?=[^\W\d_])")
_CORRECTION_STATUSES = {"DUZENLENEN", "DÜZENLENEN", "DUZELTILEN", "DÜZELTİLEN"}


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


def clean_kap_text(text: Any) -> str:
    """Whitespace-normalised KAP text with KAP's broken apostrophes repaired."""
    return clean_whitespace(_BROKEN_APOSTROPHE_RE.sub("'", str(text or "")))


def item_tickers(item: Mapping[str, Any]) -> set[str]:
    """Every stock code a list item concerns: the publisher's own codes plus related stocks."""
    return stock_codes(item.get("stockCodes")) | stock_codes(item.get("relatedStocks"))


def _published_iso(published_at: Any) -> str:
    return published_at.isoformat() if published_at else ""


def disclosure_event(
    *,
    title: str,
    url: str,
    date_text: str,
    summary: str | None = None,
    raw_payload: Mapping[str, Any] | None = None,
    http_status: int | None = None,
) -> RawEventData | None:
    """Build a ``RawEventData`` for one disclosure; ``None`` when it has no title.

    ``title`` is the KAP form name ("Özel Durum Açıklaması (Genel)") and is part of the
    content hash; ``summary`` is the free-text headline and is not.
    """
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
        summary=clean_kap_text(summary) or clean_title,
        published_at=published_at,
        content_hash=compute_content_hash(canonical_url or "", clean_title, _published_iso(published_at)),
        raw_payload_json=dict(raw_payload) if raw_payload is not None else None,
        http_status=http_status,
    )


def event_from_item(item: Mapping[str, Any]) -> RawEventData | None:
    index = str(item.get("disclosureIndex") or "").strip()
    if not index.isdigit():
        return None
    return disclosure_event(
        title=str(item.get("subject") or item.get("title") or ""),
        url=KAP_DISCLOSURE_URL.format(index=index),
        date_text=str(item.get("publishDate") or ""),
        summary=str(item.get("summary") or ""),
        raw_payload={"source": "kap", **item},
        http_status=200,
    )


def disclosure_metadata(payload: Mapping[str, Any] | None) -> dict[str, Any]:
    """Display metadata kept on the normalized event (publisher, correction flag, …)."""
    if not payload or payload.get("source") != "kap":
        return {}
    meta: dict[str, Any] = {}
    publisher = clean_kap_text(payload.get("kapTitle"))
    if publisher:
        meta["publisher"] = publisher
    for key, src in (("disclosure_class", "disclosureClass"), ("disclosure_type", "disclosureType")):
        if payload.get(src):
            meta[key] = str(payload[src])
    codes = sorted(stock_codes(payload.get("stockCodes")))
    related = sorted(stock_codes(payload.get("relatedStocks")))
    if codes:
        meta["stock_codes"] = codes
    if related:
        meta["related_stocks"] = related
    status = str(payload.get("modifyStatus") or "").strip().upper()
    if status in _CORRECTION_STATUSES:
        meta["is_correction"] = True
    if isinstance(payload.get("attachmentCount"), int) and payload["attachmentCount"] > 0:
        meta["attachment_count"] = payload["attachmentCount"]
    if payload.get("isLate") is True:
        meta["is_late"] = True
    return meta


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


def events_for_ticker(items: Sequence[Mapping[str, Any]], ticker: str) -> list[RawEventData]:
    """Disclosures of one company (exact stock-code match), newest first, de-duplicated."""
    code = ticker.strip().upper()
    events = [e for item in items if code in item_tickers(item) and (e := event_from_item(item)) is not None]
    return _dedupe(events)


class KAPAdapter(BaseAdapter):
    """KAP bildirimleri: tüm şirketler için tek (önbellekli) liste isteği, hisse koduna göre süzülür."""

    def __init__(self, ticker: str = "THYAO"):
        self.ticker = ticker.strip().upper()

    def get_source_code(self) -> str:
        return "kap"

    async def fetch(self, polling_state: PollingState | None = None) -> list[RawEventData]:
        from_date, to_date = polling_window(polling_state)
        items = await fetch_recent_disclosures(from_date, to_date)
        events = events_for_ticker(items, self.ticker)
        logger.debug("kap_company_filtered", ticker=self.ticker, count=len(events), feed_size=len(items))
        return events


# ---------------------------------------------------------------------------
# Disclosure content (detail)
# ---------------------------------------------------------------------------

ContentBlock = dict[str, Any]

_MAX_BLOCKS = 250
_MAX_TEXT_CHARS = 40_000
_MAX_TABLE_ROWS = 120
_MAX_TABLE_COLS = 14
# Financial reports carry several MB of statement tables; parse at most this much HTML.
_MAX_HTML_CHARS = 700_000
_HIDDEN_STYLE_RE = re.compile(r"display\s*:\s*none", re.IGNORECASE)
# Unfilled template slots such as "[CONSOLIDATION_METHOD]" (not stock lists like "[METRO]").
_PLACEHOLDER_RE = re.compile(r"^\[[A-Z]+(?:_[A-Z]+)+\]$")
_EMPTY_VALUES = frozenset({"-", "--", "—", "–", "."})
_BLOCK_TAGS = frozenset(
    {"p", "div", "li", "ul", "ol", "table", "tbody", "thead", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "section", "article"}
)
_INLINE_TABLE_CLASSES = frozenset({"taxonomy-title-panel"})
_YES_NO_RE = re.compile(r"^(Evet|Hayır)\s*\((Yes|No)\)$", re.IGNORECASE)
_ENGLISH_ENUM_SUFFIX_RE = re.compile(r"\s*\([A-Za-z][A-Za-z ,./&'-]*\)$")
# Form flags that only matter when answered "Evet" (update / correction / delayed).
_FLAG_LABEL_RE = re.compile(r"^Yapılan Açıklama (Güncelleme|Düzeltme|Ertelenmiş Bir Açıklama) m[ıi] ?\?$", re.IGNORECASE)
_SUMMARY_LABELS = {"özet bilgi"}


# Bump when the block format/parsing changes: cached content of an older version is refetched.
CONTENT_FORMAT_VERSION = 1


@dataclass
class DisclosureContent:
    index: str
    blocks: list[ContentBlock] = field(default_factory=list)
    attachments: list[dict[str, str]] = field(default_factory=list)
    truncated: bool = False
    summary: str | None = None
    publisher: str | None = None

    def to_json(self) -> dict[str, Any]:
        return {
            "v": CONTENT_FORMAT_VERSION,
            "blocks": self.blocks,
            "attachments": self.attachments,
            "truncated": self.truncated,
            "summary": self.summary,
            "publisher": self.publisher,
        }


def _is_hidden(tag: Tag) -> bool:
    style = tag.get("style")
    return isinstance(style, str) and bool(_HIDDEN_STYLE_RE.search(style))


def _prune(soup: BeautifulSoup) -> None:
    for el in soup.select("script, style, .content-en, .fa, .report-lang-header"):
        el.decompose()
    # Technical XBRL names ("oda_UpdateAnnouncementFlag|"): emptied, not removed, so the
    # data rows keep the column positions of their (colspan'd) header rows.
    for el in soup.select(".taxonomy-field-name-cell"):
        el.clear()
    for el in soup.find_all(_is_hidden):
        el.decompose()
    for comment in soup.find_all(string=lambda s: isinstance(s, Comment)):
        comment.extract()


_INLINE_WS_RE = re.compile(r"[\s ​]+")


def _text_of(node: Tag) -> str:
    """Visible text as lines: block elements and ``<br>`` end a line, an empty line (a
    ``<div><br></div>`` spacer or the end of a ``<p>``) separates paragraphs."""
    lines: list[str] = []
    buffer: list[str] = []

    def flush(*, blank: bool = False) -> None:
        text = _INLINE_WS_RE.sub(" ", "".join(buffer)).strip()
        buffer.clear()
        if text:
            lines.append(text)
        elif blank:
            lines.append("")

    def walk(el: Any) -> None:
        if isinstance(el, NavigableString):
            buffer.append(str(el))
            return
        if not isinstance(el, Tag):
            return
        if el.name == "br":
            flush(blank=True)
            return
        block = el.name in _BLOCK_TAGS
        if block:
            flush()
        for child in el.children:
            walk(child)
        if block:
            flush()
            if el.name == "p":
                lines.append("")

    walk(node)
    flush()
    out: list[str] = []
    for line in lines:
        if line or (out and out[-1] != ""):
            out.append(line)
    return _BROKEN_APOSTROPHE_RE.sub("'", "\n".join(out).strip())


def _expand_colspan(cells: Sequence[Tag], texts: Sequence[str]) -> list[str]:
    """Cell texts with ``colspan`` expanded, so rows of one table share column positions."""
    expanded: list[str] = []
    for cell, text in zip(cells, texts, strict=True):
        expanded.append(text)
        try:
            span = int(str(cell.get("colspan") or "1"))
        except ValueError:
            span = 1
        expanded.extend([""] * (min(max(span, 1), _MAX_TABLE_COLS) - 1))
    return expanded


def _is_inline_table(table: Tag) -> bool:
    return bool(_INLINE_TABLE_CLASSES.intersection(table.get("class") or []))


def _structural_tables(el: Tag) -> list[Tag]:
    return [t for t in el.find_all("table") if not _is_inline_table(t)]


def _clean_value(value: str) -> str:
    value = value.strip()
    match = _YES_NO_RE.match(value)
    if match:
        return match.group(1).capitalize()
    if value.startswith("[") and value.endswith("]") and "\n" not in value:
        value = value[1:-1].strip()  # XBRL lists: "[METRO]" / "[]"
    return value


def _clean_label(label: str) -> str:
    return re.sub(r"\s+\?", "?", clean_whitespace(label)).rstrip(":").strip()


def _heading_like(tr: Tag, cell: Tag) -> bool:
    if "abstract-row" in (tr.get("class") or []):
        return True
    return cell.select_one(".txtWhite, .taxonomy-abstract-title") is not None


def _text_like(cell: Tag) -> bool:
    return cell.select_one(".text-block-value") is not None or "taxonomy-context-value-summernote" in (cell.get("class") or [])


def parse_disclosure_body(bodies: Sequence[str]) -> tuple[list[ContentBlock], bool]:
    """KAP disclosure HTML → ordered blocks (heading / field / text / table) + truncated flag.

    Leaf rows (rows without nested layout tables) are classified by their visible cells:
    one cell → heading or text, two → a label/value field, three or more → a data-table row.
    Once a table has become a data table, all its later rows stay in it (keeping column
    positions), so sparse rows of statements and dividend tables do not leak out as text.
    """
    html = "".join(b for b in bodies if isinstance(b, str))
    truncated = len(html) > _MAX_HTML_CHARS
    soup = BeautifulSoup(html[:_MAX_HTML_CHARS], "lxml")
    _prune(soup)

    blocks: list[ContentBlock] = []
    text_chars = 0
    table_rows: dict[int, list[list[str]]] = {}

    def push(block: ContentBlock) -> None:
        nonlocal truncated
        if len(blocks) >= _MAX_BLOCKS:
            truncated = True
            return
        if blocks and block == blocks[-1]:
            return
        blocks.append(block)

    def add_table_row(table: Tag, row: list[str]) -> None:
        nonlocal truncated
        rows = table_rows.get(id(table))
        if rows is None:
            rows = table_rows[id(table)] = []
            push({"type": "table", "rows": rows})
        if len(rows) < _MAX_TABLE_ROWS:
            rows.append(row[:_MAX_TABLE_COLS])
        else:
            truncated = True

    for tr in soup.find_all("tr"):
        table = tr.find_parent("table")
        if table is None or _is_inline_table(table):
            continue  # label panels inside XBRL title cells are read through their row
        cells = tr.find_all(["td", "th"], recursive=False)
        if any(_structural_tables(cell) for cell in cells):
            continue  # layout row: its nested rows are visited on their own
        cell_texts = ["" if _PLACEHOLDER_RE.match(t) else t for t in (_text_of(c) for c in cells)]
        visible = [(c, t) for c, t in zip(cells, cell_texts, strict=True) if t]
        if not visible:
            continue
        texts = _expand_colspan(cells, cell_texts)
        if text_chars > _MAX_TEXT_CHARS:
            truncated = True
            break
        text_chars += sum(len(t) for _, t in visible)
        cell, text = visible[0]
        heading = _heading_like(tr, cell) and not _text_like(cell) and len(text) <= 160 and "\n" not in text

        if id(table) in table_rows or len(visible) >= 3 or (len(visible) == 2 and table.get("border") == "1"):
            if len(visible) == 1 and not heading and id(table) in table_rows:
                continue  # a line item without values
            add_table_row(table, [_clean_value(t) for t in texts])
        elif len(visible) == 2:
            label, value = _clean_label(visible[0][1]), _clean_value(visible[1][1])
            if visible[1][0].select_one(".taxonomy-label-field") is not None:
                # XBRL enumerations repeat the English label: "Müşteri (Customer)".
                value = _ENGLISH_ENUM_SUFFIX_RE.sub("", value) or value
            if not value or value in _EMPTY_VALUES:
                continue
            if _FLAG_LABEL_RE.match(label) and value.lower().startswith("hayır"):
                continue
            push({"type": "field", "label": label, "value": value})
        elif heading:
            push({"type": "heading", "text": text})
        else:
            push({"type": "text", "text": text})

    return _finalize_blocks(blocks), truncated


_NUMERIC_RE = re.compile(r"^[-+(]?[\d.,% ]+\)?$")


def _column_has_data(rows: list[list[str]], index: int) -> bool:
    """A column is kept when any data row fills it, or when its only value is in the first
    row but looks like data (a table without a header row) rather than a column title."""
    if any(r[index] for r in rows[1:]):
        return True
    first = rows[0][index]
    return bool(first) and (len(rows) == 1 or bool(_NUMERIC_RE.match(first)))


def _finalize_blocks(blocks: list[ContentBlock]) -> list[ContentBlock]:
    """Drop empty tables/columns and headings with nothing under them; square table rows."""
    cleaned: list[ContentBlock] = []
    for block in blocks:
        if block["type"] == "table":
            rows = [r for r in block["rows"] if any(cell for cell in r)]
            if not rows:
                continue
            width = max(len(r) for r in rows)
            rows = [r + [""] * (width - len(r)) for r in rows]
            keep = [i for i in range(width) if _column_has_data(rows, i)]
            rows = [[r[i] for i in keep] for r in rows]
            if not keep:
                continue
            if len(rows) == 1 and len(rows[0]) == 2:
                cleaned.append({"type": "field", "label": _clean_label(rows[0][0]), "value": rows[0][1]})
                continue
            block = {"type": "table", "rows": rows}
        cleaned.append(block)
    result: list[ContentBlock] = []
    for i, block in enumerate(cleaned):
        if block["type"] == "heading":
            nxt = cleaned[i + 1] if i + 1 < len(cleaned) else None
            if nxt is None or nxt["type"] == "heading":
                continue
        result.append(block)
    return result


def _split_summary(blocks: list[ContentBlock]) -> tuple[list[ContentBlock], str | None]:
    """Remove the "Özet Bilgi" field (shown as the headline) and return its value."""
    summary: str | None = None
    kept: list[ContentBlock] = []
    for block in blocks:
        if block["type"] == "field" and block["label"].lower() in _SUMMARY_LABELS:
            summary = summary or clean_kap_text(block["value"]) or None
            continue
        kept.append(block)
    return kept, summary


def _as_dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def parse_disclosure_detail(index: str, payload: Any) -> DisclosureContent:
    """Parse the ``attachment-detail`` response (a one-element list) into content blocks."""
    element = payload[0] if isinstance(payload, list) and payload else payload
    if not isinstance(element, dict):
        raise KapUnavailableError(f"unexpected KAP detail format: {type(payload).__name__}")
    disclosure = _as_dict(element.get("disclosure"))
    basic = _as_dict(disclosure.get("disclosureBasic"))
    bodies = element.get("disclosureBody") or []
    if isinstance(bodies, str):
        bodies = [bodies]
    blocks, truncated = parse_disclosure_body([b for b in bodies if isinstance(b, str)])
    blocks, form_summary = _split_summary(blocks)
    form_name = clean_whitespace(str(basic.get("title") or "")).casefold()
    if form_name:  # the form's own title repeats the headline area
        blocks = [b for b in blocks if not (b["type"] == "heading" and b["text"].casefold() == form_name)]
    attachments = [
        {"name": clean_whitespace(str(a.get("fileName") or ""))}
        for a in element.get("attachments") or []
        if isinstance(a, dict) and a.get("fileName")
    ]
    return DisclosureContent(
        index=index,
        blocks=blocks,
        attachments=attachments,
        truncated=truncated,
        summary=clean_kap_text(basic.get("summary")) or form_summary,
        publisher=clean_kap_text(basic.get("companyTitle")) or None,
    )


async def fetch_disclosure_content(index: str) -> DisclosureContent:
    """Full text of one disclosure from KAP (raises :class:`KapUnavailableError`)."""
    if not str(index).isdigit():
        raise ValueError(f"invalid KAP disclosure index: {index!r}")
    return await _fetch_disclosure_content(str(index))


# Single-flight: simultaneous first views of one disclosure share a single KAP request.
@cached(ttl_seconds=600, key_prefix="kap-content")
async def _fetch_disclosure_content(index: str) -> DisclosureContent:
    payload = await _request(
        "GET",
        KAP_DETAIL_URL.format(index=index),
        referer=KAP_DISCLOSURE_URL.format(index=index),
    )
    started = time.perf_counter()
    content = await asyncio.to_thread(parse_disclosure_detail, str(index), payload)
    logger.info(
        "kap_content_parsed",
        index=index,
        blocks=len(content.blocks),
        truncated=content.truncated,
        parse_ms=round((time.perf_counter() - started) * 1000),
    )
    return content
