import hashlib
import re
from datetime import datetime
from zoneinfo import ZoneInfo

from dateutil import parser as dateutil_parser


ISTANBUL_TZ = ZoneInfo("Europe/Istanbul")

TURKISH_MONTHS = {
    "ocak": 1, "şubat": 2, "mart": 3, "nisan": 4, "mayıs": 5, "haziran": 6,
    "temmuz": 7, "ağustos": 8, "eylül": 9, "ekim": 10, "kasım": 11, "aralık": 12,
}


def compute_content_hash(canonical_url: str, title: str, published_at_iso: str) -> str:
    raw = f"{canonical_url or ''}{title or ''}{published_at_iso or ''}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def compute_dedup_key(source_code: str, canonical_url: str, published_at_iso: str, title: str) -> str:
    normalized_title = (title or "").lower().strip()
    normalized_title = re.sub(r"\s+", " ", normalized_title)
    raw = f"{source_code}{canonical_url or ''}{published_at_iso or ''}{normalized_title}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def parse_date(date_str: str | None) -> datetime | None:
    if not date_str:
        return None
    date_str = date_str.strip()

    # Try Turkish month names
    for tr_month, num in TURKISH_MONTHS.items():
        if tr_month in date_str.lower():
            date_str_replaced = re.sub(
                tr_month, str(num), date_str.lower(), flags=re.IGNORECASE
            )
            try:
                dt = dateutil_parser.parse(date_str_replaced, dayfirst=True)
                return make_aware(dt)
            except (ValueError, TypeError):
                pass

    # Try common Turkish date format: DD.MM.YYYY HH:MM:SS
    for fmt in [
        "%d.%m.%Y %H:%M:%S",
        "%d.%m.%Y %H:%M",
        "%d.%m.%Y",
        "%Y-%m-%dT%H:%M:%S",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
    ]:
        try:
            dt = datetime.strptime(date_str, fmt)
            return make_aware(dt)
        except ValueError:
            continue

    # Fallback to dateutil
    try:
        dt = dateutil_parser.parse(date_str, dayfirst=True)
        return make_aware(dt)
    except (ValueError, TypeError):
        return None


def make_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=ISTANBUL_TZ)
    return dt


def strip_html(text: str | None) -> str:
    if not text:
        return ""
    clean = re.sub(r"<[^>]+>", "", text)
    clean = re.sub(r"\s+", " ", clean).strip()
    return clean


def clean_whitespace(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def truncate(text: str | None, max_len: int = 500) -> str:
    if not text:
        return ""
    if len(text) <= max_len:
        return text
    return text[:max_len] + "..."
