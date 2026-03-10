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
