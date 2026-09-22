"""Google News RSS adapter'ı (Faz 2).

Hisse bazlı haber toplama: Google News'un halka açık RSS arama beslemesinden
başlık, kaynak URL, yayın tarihi ve kısa açıklama çeker (kullanım koşullarına
uygun — tam içerik indirilmez, yalnızca RSS meta verisi).

İlgililik: arama şirket adıyla yapılır (tek kelimelik, genel adlarda finans
bağlamı eklenir) ve dönen her başlık yerel olarak süzülür. Kısa/genel kodlar
("AKSA" → "Mescid-i Aksa") ancak kod biçiminde geçtiğinde (büyük harf, ör.
"(AKSA)", "AKSA'da") ya da şirket adı finans bağlamıyla birlikte geçtiğinde
eşleşir. Adını içeren başka bir şirketin haberleri (``exclude_names``, ör.
AKSA için "Aksa Enerji") elenir.
"""

from __future__ import annotations

import html
import re
import unicodedata
from collections.abc import Iterable, Sequence
from datetime import datetime, timedelta, timezone
from urllib.parse import parse_qsl, quote, urlencode, urlsplit, urlunsplit

import structlog
from bs4 import BeautifulSoup
from dateutil import parser as date_parser

from src.adapters.utils import get_http_client

logger = structlog.get_logger(__name__)

_RSS_URL = "https://news.google.com/rss/search?q={query}&hl=tr&gl=TR&ceid=TR:tr"
_TAG_RE = re.compile(r"<[^>]+>")
_MAX_AGE_DAYS = 30
_FINANCE_CONTEXT_QUERY = "(hisse OR borsa OR BIST OR KAP OR temettü OR bilanço)"

# Words that make a headline about "<Name>" plausibly about the listed company
# (matched on the folded text; prefixes may carry Turkish suffixes).
_FINANCE_PREFIXES = (
    "hisse", "borsa", "temettu", "kar payi", "bilanco", "finansal", "ceyrek", "net kar", "zarar", "ciro",
    "hasilat", "ihracat", "yatirim", "sermaye", "bedelsiz", "bedelli", "halka arz", "hedef fiyat",
    "genel kurul", "yonetim kurulu", "genel mudur", "sirket", "holding", "fabrika", "uretim", "tesis",
    "kapasite", "ihale", "sozlesme", "anlasma", "siparis", "satin al", "birlesme", "devral", "kredi",
    "tahvil", "endeks", "yatirimci", "lot ",
)
_FINANCE_WORDS = ("bist", "kap", "ceo", "pay", "kar", "kari", "karini")
_FINANCE_RE = re.compile(
    r"(?<![a-z0-9])(?:"
    + "|".join(re.escape(p) for p in _FINANCE_PREFIXES)
    + r"|(?:"
    + "|".join(_FINANCE_WORDS)
    + r")(?![a-z0-9]))"
)
# Legal-form suffixes, matched on the folded name.
_LEGAL_SUFFIX_RE = re.compile(
    r"\s+(?:t\.?\s?a\.?\s?s\.?|a\.?\s?s\.?|a\.?\s?o\.?|ltd\.?(?:\s?sti\.?)?|anonim\s+(?:sirketi|ortakligi)"
    r"|sanayii?\s+ve\s+ticaret.*|ve\s+ticaret.*|ticaret\s+ve\s+sanayii?.*)\s*$"
)
_TRACKING_PARAMS = {"oc", "ved", "usg", "fbclid", "gclid", "ref", "ref_src"}

_FOLD = {
    "ı": "i", "İ": "i", "I": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g", "ü": "u", "Ü": "u",
    "ö": "o", "Ö": "o", "ç": "c", "Ç": "c", "â": "a", "Â": "a", "î": "i", "Î": "i", "û": "u", "Û": "u",
}


def _clean(text: str | None) -> str:
    """HTML etiketlerini ve entity'leri temizler."""
    if not text:
        return ""
    return re.sub(r"\s+", " ", html.unescape(_TAG_RE.sub(" ", text))).strip()


def fold(text: str) -> str:
    """Length-preserving, case/diacritic-insensitive form of ``text`` (Turkish aware)."""
    out = []
    for ch in text:
        mapped = _FOLD.get(ch)
        if mapped is None:
            base = unicodedata.normalize("NFKD", ch)[:1]
            mapped = base.lower() if base.isascii() else "?"
        out.append(mapped)
    return "".join(out)


def company_short_name(company_name: str) -> str:
    """Name without legal-form suffixes, at most four words.

    ``"ASELSAN ELEKTRONİK SANAYİ VE TİCARET A.Ş."`` → ``"ASELSAN ELEKTRONİK"``.
    """
    name = re.sub(r"\s+", " ", (company_name or "")).strip()
    while name:
        match = _LEGAL_SUFFIX_RE.search(fold(name))
        if not match:
            break
        name = name[: match.start()].strip(" ,.-")
    return " ".join(name.split()[:4])


def build_query(ticker: str, company_name: str) -> str:
    """Google News arama sorgusu: şirket adı (genel tek kelimelik adlarda finans bağlamıyla) VEYA "KOD hisse"."""
    name = company_short_name(company_name) or ticker
    if len(name.split()) >= 2:
        return f'"{name}" OR "{ticker} hisse"'
    return f'"{name}" {_FINANCE_CONTEXT_QUERY} OR "{ticker} hisse"'


def canonical_url(url: str) -> str:
    """Stable article URL: lower-case scheme/host, no fragment, no tracking parameters."""
    parts = urlsplit((url or "").strip())
    if not parts.scheme or not parts.netloc:
        return (url or "").strip()
    query = [
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if k.lower() not in _TRACKING_PARAMS and not k.lower().startswith("utm_")
    ]
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), parts.path, urlencode(query), ""))


def _mask(text: str, folded: str, phrase: str) -> tuple[str, str]:
    """Blank every word-bounded occurrence of ``phrase`` (folded) in both strings."""
    target = fold(phrase).strip()
    if not target:
        return text, folded
    pattern = re.compile(rf"(?<![a-z0-9]){re.escape(target)}(?![a-z0-9])")
    spans = [m.span() for m in pattern.finditer(folded)]
    if not spans:
        return text, folded
    chars, fchars = list(text), list(folded)
    for start, end in spans:
        for i in range(start, end):
            chars[i] = " "
            fchars[i] = " "
    return "".join(chars), "".join(fchars)


def is_relevant(
    title: str,
    snippet: str,
    ticker: str,
    company_name: str,
    exclude_names: Iterable[str] = (),
) -> bool:
    """Is the headline about this listed company? (see module docstring)."""
    text = f"{title} \n {snippet}"
    folded = fold(text)
    for other in exclude_names:
        text, folded = _mask(text, folded, other)

    code = re.escape(ticker.upper())
    if re.search(rf"(?<![A-Za-zÇĞİÖŞÜçğıöşü0-9]){code}(?![A-Za-zÇĞİÖŞÜçğıöşü0-9])", text):
        return True

    name = fold(company_short_name(company_name)).strip()
    if not name or not re.search(rf"(?<![a-z0-9]){re.escape(name)}(?![a-z0-9])", folded):
        return False
    if len(name.split()) >= 2:
        return True
    return bool(_FINANCE_RE.search(f"{folded} "))


def _published_at(text: str | None) -> datetime | None:
    if not text:
        return None
    try:
        parsed: datetime = date_parser.parse(text)
    except (ValueError, TypeError, OverflowError):
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)  # RSS pubDate is GMT
    return parsed.astimezone(timezone.utc)


def parse_feed(
    xml_text: str,
    ticker: str,
    company_name: str,
    *,
    exclude_names: Sequence[str] = (),
    limit: int = 20,
    now: datetime | None = None,
    max_age_days: int = _MAX_AGE_DAYS,
) -> list[dict]:
    """Relevant, recent, de-duplicated items (newest first) from a Google News RSS document."""
    try:
        soup = BeautifulSoup(xml_text, "xml")
    except Exception:
        soup = BeautifulSoup(xml_text, "html.parser")

    now = now or datetime.now(timezone.utc)
    oldest = now - timedelta(days=max_age_days)
    candidates: list[dict] = []
    for item in soup.find_all("item"):
        title = _clean(item.title.get_text() if item.title else None)
        link = canonical_url(item.link.get_text() if item.link else "")
        if not title or not link:
            continue

        source_tag = item.find("source")
        source_name = _clean(source_tag.get_text()) if source_tag else ""
        # Google News başlıkları genelde " - Kaynak" ekiyle gelir; ayıkla
        if source_name and title.endswith(f" - {source_name}"):
            title = title[: -len(f" - {source_name}")].strip()

        published_at = _published_at(item.pubDate.get_text() if item.pubDate else None)
        if published_at is None or published_at < oldest or published_at > now + timedelta(days=1):
            continue  # undated/implausible items are skipped, never stamped "now"

        snippet = _clean(item.description.get_text() if item.description else None)
        if not is_relevant(title, snippet, ticker, company_name, exclude_names):
            continue
        candidates.append(
            {
                "title": title[:512],
                "url": link[:1024],
                "snippet": snippet[:1000],
                "source_name": source_name[:200],
                "published_at": published_at,
            }
        )

    # The same story is often syndicated under several URLs: keep the earliest copy.
    seen_urls: set[str] = set()
    seen_titles: set[str] = set()
    items: list[dict] = []
    for candidate in sorted(candidates, key=lambda c: c["published_at"]):
        title_key = re.sub(r"[^a-z0-9]+", " ", fold(candidate["title"])).strip()
        if candidate["url"] in seen_urls or title_key in seen_titles:
            continue
        seen_urls.add(candidate["url"])
        seen_titles.add(title_key)
        items.append(candidate)
    items.sort(key=lambda i: i["published_at"], reverse=True)
    return items[:limit]


async def fetch_news(
    ticker: str,
    company_name: str,
    limit: int = 20,
    exclude_names: Sequence[str] = (),
) -> list[dict]:
    """Bir hisse için ilgili Google News RSS sonuçlarını döndürür (yeniden eskiye).

    Dönen kayıt: {title, url, snippet, source_name, published_at (UTC)}
    """
    url = _RSS_URL.format(query=quote(build_query(ticker, company_name)))
    try:
        resp = await get_http_client().get(url)
        resp.raise_for_status()
    except Exception as e:
        logger.warning("news_rss_fetch_error", ticker=ticker, error=f"{type(e).__name__}: {e}")
        return []
    return parse_feed(resp.text, ticker, company_name, exclude_names=exclude_names, limit=limit)
