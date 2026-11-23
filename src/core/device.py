"""Anonymous device identity: a random secret the browser generates and keeps.

There are no accounts. The browser creates a 256-bit key (43 base64url characters),
stores it with the rest of the workspace (and in its backup file) and sends it in
``X-Device-Key``. The server stores only its SHA-256, so a database leak does not
reveal keys, and a lost key cannot be recovered — restoring the backup restores it.
"""

from __future__ import annotations

import hashlib
import re
from urllib.parse import urlsplit

DEVICE_KEY_HEADER = "X-Device-Key"
_DEVICE_KEY_RE = re.compile(r"^[A-Za-z0-9_-]{43}$")

# Web Push endpoints the server may POST to. Anything else is refused, so a client
# cannot turn the worker into a request proxy (SSRF) with a forged subscription.
PUSH_SERVICE_HOST_SUFFIXES = (
    "fcm.googleapis.com",  # Chrome, Edge (Chromium), Opera, Samsung
    "android.googleapis.com",
    "push.services.mozilla.com",  # Firefox
    "push.apple.com",  # Safari / iOS (web.push.apple.com)
    "notify.windows.com",  # legacy Edge / WNS
)


class InvalidDeviceKeyError(ValueError):
    pass


def device_key_hash(raw: str | None) -> str:
    """SHA-256 hex digest of a well-formed device key; raises InvalidDeviceKeyError."""
    key = (raw or "").strip()
    if not _DEVICE_KEY_RE.match(key):
        raise InvalidDeviceKeyError("invalid device key")
    return hashlib.sha256(key.encode("ascii")).hexdigest()


def is_allowed_push_endpoint(endpoint: str) -> bool:
    """HTTPS URL on a known push service host (exact host or a subdomain of it)."""
    try:
        parts = urlsplit(endpoint)
    except ValueError:
        return False
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        return False
    if parts.port not in (None, 443):
        return False
    host = parts.hostname.lower().rstrip(".")
    return any(host == suffix or host.endswith("." + suffix) for suffix in PUSH_SERVICE_HOST_SUFFIXES)
