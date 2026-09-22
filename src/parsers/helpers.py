import hashlib
import re
from datetime import datetime
from zoneinfo import ZoneInfo

from dateutil import parser as dateutil_parser


ISTANBUL_TZ = ZoneInfo("Europe/Istanbul")

# Turkish month names, with ASCII-folded spellings as they appear in some feeds.
TURKISH_MONTHS = {
    "ocak": 1, "şubat": 2, "mart": 3, "nisan": 4, "mayıs": 5, "haziran": 6,
    "temmuz": 7, "ağustos": 8, "eylül": 9, "ekim": 10, "kasım": 11, "aralık": 12,
    "subat": 2, "mayis": 5, "agustos": 8, "eylul": 9, "kasim": 11, "aralik": 12,
}
_MONTH_RE = re.compile(
    r"(?<![a-zçğıöşü])(" + "|".join(sorted(TURKISH_MONTHS, key=len, reverse=True)) + r")(?![a-zçğıöşü])"
)

_EXPLICIT_FORMATS = (
    "%d.%m.%Y %H:%M:%S",
    "%d.%m.%Y %H:%M",
    "%d.%m.%Y",
    "%d/%m/%Y %H:%M:%S",
    "%d/%m/%Y",
    "%Y-%m-%dT%H:%M:%S",
    "%Y-%m-%dT%H:%M:%S%z",
    "%Y-%m-%d %H:%M:%S",
    "%Y-%m-%d",
)


def compute_content_hash(canonical_url: str, title: str, published_at_iso: str) -> str:
    raw = f"{canonical_url or ''}{title or ''}{published_at_iso or ''}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def compute_dedup_key(
    source_code: str, canonical_url: str, published_at_iso: str, title: str, *, scope: str = ""
) -> str:
    """Stable key for a normalized event.

    ``scope`` (e.g. the company ticker) separates otherwise identical events, such as a
    KAP disclosure that lists several companies. An empty scope yields the legacy key.
    """
    normalized_title = (title or "").lower().strip()
    normalized_title = re.sub(r"\s+", " ", normalized_title)
    raw = f"{source_code}{canonical_url or ''}{published_at_iso or ''}{normalized_title}"
    if scope:
        raw = f"{raw}|{scope}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def turkish_lower(text: str) -> str:
    """Lower-case with Turkish dotted/dotless i rules (``"ARALIK"`` → ``"aralık"``)."""
    return text.replace("I", "ı").replace("İ", "i").lower()


_ASCII_FOLD = str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU")
_NAME_WORD_RE = re.compile(r"[0-9A-Za-zÇĞİÖŞÜçğıöşü]+")


def _ascii_upper(word: str) -> str:
    return word.translate(_ASCII_FOLD).upper()


def turkish_title(word: str) -> str:
    """``"İLAÇ"`` → ``"İlaç"``, ``"IŞIKLAR"`` → ``"Işıklar"`` (Turkish casing rules)."""
    if not word:
        return word
    return word[0] + turkish_lower(word[1:])


def restore_turkish_name(short_name: str, official_title: str) -> str:
    """Put the Turkish letters back into an ASCII short company name.

    Each word of ``short_name`` (e.g. ``"Eczacibasi Ilac"`` from a market-data feed) is
    matched against the words of the official KAP title (``"ECZACIBAŞI İLAÇ, ... A.Ş."``)
    ignoring diacritics; matches take the official spelling, everything else (abbreviations
    such as ``"Hol."``, unmatched words) is kept as is. All-caps words stay all-caps.
    """
    if not short_name or not official_title:
        return short_name
    official: dict[str, str] = {}
    for word in _NAME_WORD_RE.findall(official_title):
        official.setdefault(_ascii_upper(word), word)

    def fix(match: re.Match[str]) -> str:
        word = match.group(0)
        spelled = official.get(_ascii_upper(word))
        if spelled is None:
            return word
        if word.isupper():
            return spelled.upper() if spelled.isupper() else spelled
        return turkish_title(spelled)

    return _NAME_WORD_RE.sub(fix, short_name)


def parse_date(date_str: str | None) -> datetime | None:
    """Parse KAP/Turkish/ISO date strings into an aware datetime.

    Naive values (KAP's ``GG.AA.YYYY SS:DD:ss``) are Istanbul local time, so the
    result carries the Europe/Istanbul zone — the correct instant, which the DB
    (``timestamptz``) stores as UTC. Explicit offsets are kept. Returns ``None``
    for empty or unparseable input.
    """
    if not date_str:
        return None
    text = str(date_str).strip()
    if not text:
        return None

    # Turkish month names ("9 Mart 2026", "30 ARALIK 2025 14:00")
    lowered = turkish_lower(text)
    if _MONTH_RE.search(lowered):
        numeric = _MONTH_RE.sub(lambda m: str(TURKISH_MONTHS[m.group(1)]), lowered)
        try:
            return make_aware(dateutil_parser.parse(numeric, dayfirst=True))
        except (ValueError, TypeError, OverflowError):
            pass

    for fmt in _EXPLICIT_FORMATS:
        try:
            return make_aware(datetime.strptime(text, fmt))
        except ValueError:
            continue

    try:
        return make_aware(dateutil_parser.parse(text, dayfirst=True))
    except (ValueError, TypeError, OverflowError):
        return None


def make_aware(dt: datetime) -> datetime:
    """Attach Europe/Istanbul to naive datetimes (KAP publishes local time)."""
    if dt.tzinfo is None or dt.tzinfo.utcoffset(dt) is None:
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
