from enum import Enum


class EventType(str, Enum):
    KAP_DISCLOSURE = "KAP_DISCLOSURE"
    OFFICIAL_NEWS = "OFFICIAL_NEWS"
    OFFICIAL_IR_UPDATE = "OFFICIAL_IR_UPDATE"


class Severity(str, Enum):
    INFO = "INFO"
    WATCH = "WATCH"
    HIGH = "HIGH"


class SourceKind(str, Enum):
    KAP = "kap"
    OFFICIAL_NEWS = "official_news"
    OFFICIAL_IR = "official_ir"
    PRICE_DATA = "price_data"
    FINANCIAL_STATEMENTS = "financial_statements"


class OutboxStatus(str, Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    DONE = "done"
    FAILED = "failed"


class NotificationChannel(str, Enum):
    EMAIL = "email"


class NotificationFrequency(str, Enum):
    INSTANT = "instant"


class NotificationProvider(str, Enum):
    SMTP = "smtp"
    DRY_RUN = "dry_run"


class NotificationStatus(str, Enum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    SKIPPED = "skipped"


class PriceInterval(str, Enum):
    ONE_DAY = "1d"
    ONE_HOUR = "1h"
    FIFTEEN_MIN = "15m"


class EventCategory(str, Enum):
    """KAP disclosure topic. The DB stores the member *name* (PostgreSQL enum
    ``eventcategory``); the API serialises the Turkish *value*. New members need an
    ``ALTER TYPE eventcategory ADD VALUE`` migration (see 010)."""

    DIVIDEND = "temettü"
    CAPITAL_INCREASE = "sermaye_artırımı"
    NEW_BUSINESS = "yeni_iş"
    LEGAL = "dava_ceza"
    MANAGEMENT = "yönetim_değişimi"
    FINANCIAL_RESULTS = "finansal_sonuç"
    OTHER = "diğer"
    SHARE_BUYBACK = "pay_geri_alımı"
    MERGER_ACQUISITION = "birleşme_devralma"
    INSIDER_TRADING = "pay_alım_satım"
    DEBT_INSTRUMENT = "borçlanma_aracı"
    CREDIT_RATING = "kredi_notu"
    GENERAL_ASSEMBLY = "genel_kurul"
    MARKET_NOTICE = "piyasa_duyurusu"


# Ordering used to compare severities ("at least WATCH" etc.).
SEVERITY_RANK: dict[Severity, int] = {Severity.INFO: 0, Severity.WATCH: 1, Severity.HIGH: 2}


def _tr_lower(text: str) -> str:
    """Turkish-aware lower case ("İ" -> "i", "I" -> "ı")."""
    return text.strip().replace("İ", "i").replace("I", "ı").lower()


def parse_event_category(value: str) -> EventCategory | None:
    """Resolve an EventCategory from its API value ("temettü") or its name
    ("DIVIDEND"), both case-insensitive."""
    candidate = value.strip()
    for category in EventCategory:
        if candidate.upper() == category.name or _tr_lower(candidate) == category.value:
            return category
    return None


def parse_severity(value: str) -> Severity | None:
    """Resolve a Severity from its name/value ("HIGH"), case-insensitive."""
    candidate = value.strip().upper()
    return Severity.__members__.get(candidate)
