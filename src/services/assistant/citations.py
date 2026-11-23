"""Source registry: every data lookup registers what it read; the model cites ``[n]``."""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from typing import Literal

SourceKind = Literal["page", "kap", "methodology", "news", "external"]

#: ``[3]`` or ``[2, 5]`` / ``[2][5]`` citation markers in the answer text.
_MARKER_RE = re.compile(r"\[(\d{1,3}(?:\s*,\s*\d{1,3})*)\]")
# Same-origin paths (not "//host" or "/\host", which browsers treat as another origin)
# or absolute https links.
_SAFE_URL_RE = re.compile(r"^(/(?![/\\])[^\s\\]*|https://[^\s/\\][^\s\\]*)$")


@dataclass(frozen=True)
class Citation:
    id: int
    title: str
    url: str
    kind: SourceKind

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def safe_url(url: str | None) -> str | None:
    """Internal paths and https links only (no javascript:, data:, http:…)."""
    if not url:
        return None
    url = url.strip()
    return url if len(url) <= 500 and _SAFE_URL_RE.match(url) else None


class CitationRegistry:
    """Numbers sources in the order they are first seen (the same URL keeps its number)."""

    def __init__(self, limit: int = 40) -> None:
        self._items: list[Citation] = []
        self._by_url: dict[str, Citation] = {}
        self._limit = limit

    def add(self, title: str, url: str | None, kind: SourceKind) -> int | None:
        clean = safe_url(url)
        if clean is None:
            return None
        existing = self._by_url.get(clean)
        if existing is not None:
            return existing.id
        if len(self._items) >= self._limit:
            return None
        citation = Citation(id=len(self._items) + 1, title=(title or clean).strip()[:160], url=clean, kind=kind)
        self._items.append(citation)
        self._by_url[clean] = citation
        return citation.id

    def __len__(self) -> int:
        return len(self._items)

    @property
    def items(self) -> list[Citation]:
        return list(self._items)

    def cited_ids(self, text: str) -> list[int]:
        """Known ids referenced in ``text``, in first-use order."""
        known = {item.id for item in self._items}
        seen: list[int] = []
        for match in _MARKER_RE.finditer(text):
            for part in match.group(1).split(","):
                number = int(part)
                if number in known and number not in seen:
                    seen.append(number)
        return seen

    def payload(self, text: str) -> list[dict[str, object]]:
        """Every registered source, cited ones first (``cited`` flag for the UI)."""
        cited = self.cited_ids(text)
        order = {cid: index for index, cid in enumerate(cited)}
        ranked = sorted(self._items, key=lambda c: (c.id not in order, order.get(c.id, 0), c.id))
        return [{**c.as_dict(), "cited": c.id in order} for c in ranked]
