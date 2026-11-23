"""Plain text of a PDF (KAP disclosure attachments).

Many disclosures carry their whole content in a PDF attachment ("açıklama ekte yer
almaktadır"); without the attachment text the site shows only a file name. pypdf's layout
mode keeps table columns aligned, so MKK ownership tables and similar grids stay readable
in a monospace block.

Attachments are untrusted input: the caller caps the download size, and this module caps
the page count and the output length. A PDF that is only scanned images yields no text
(``pages_with_text == 0``); reading those needs OCR / a vision model and is out of scope.
"""

from __future__ import annotations

import io
import re
from dataclasses import dataclass
from typing import TYPE_CHECKING

import structlog

if TYPE_CHECKING:
    from pypdf import PageObject

logger = structlog.get_logger(__name__)

PDF_MAGIC = b"%PDF-"

_TRAILING_SPACE_RE = re.compile(r"[ \t]+$", re.MULTILINE)  # NBSPs are plain spaces by then
_BLANK_LINES_RE = re.compile(r"\n{3,}")
# Layout mode reproduces justified prose ("BU    DUYURU,    BU"). A line whose widest
# inner gap is short is prose: its gaps collapse to one space. Table rows keep their
# alignment because at least one column gap is wide.
_INNER_GAP_RE = re.compile(r"(?<=\S) {2,}(?=\S)")
_COLUMN_GAP = 6


class PdfTextError(ValueError):
    """The bytes are not a PDF pypdf can open (corrupt, encrypted, not a PDF)."""


@dataclass(frozen=True)
class PdfText:
    text: str
    pages: int
    pages_read: int
    pages_with_text: int
    truncated: bool


def _dedent(text: str) -> str:
    """Remove the left margin shared by every non-blank line (layout mode pads to the page)."""
    lines = text.split("\n")
    indents = [len(line) - len(line.lstrip(" ")) for line in lines if line.strip()]
    margin = min(indents, default=0)
    return "\n".join(line[margin:] for line in lines) if margin else text


def _unjustify(line: str) -> str:
    gaps = _INNER_GAP_RE.findall(line)
    if not gaps or max(len(gap) for gap in gaps) >= _COLUMN_GAP:
        return line
    return _INNER_GAP_RE.sub(" ", line)


def _tidy(text: str) -> str:
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "").replace("\u00a0", " ")
    text = _TRAILING_SPACE_RE.sub("", text)
    text = "\n".join(_unjustify(line) for line in text.split("\n"))
    text = _BLANK_LINES_RE.sub("\n\n", text)
    return _dedent(text).strip("\n")


def _page_text(page: PageObject) -> str:
    try:
        return page.extract_text(extraction_mode="layout") or ""
    except Exception:  # layout mode fails on some odd fonts; plain mode still reads them
        return page.extract_text() or ""


def extract_pdf_text(data: bytes, *, max_pages: int = 20, max_chars: int = 30_000) -> PdfText:
    """Text of the first ``max_pages`` pages, pages separated by a blank line.

    Raises :class:`PdfTextError` when the PDF cannot be opened at all; a page that fails to
    extract is skipped (logged) so one bad page does not hide the rest.
    """
    if not data.startswith(PDF_MAGIC):
        raise PdfTextError("not a PDF")
    from pypdf import PdfReader  # imported lazily: only content views need it

    try:
        reader = PdfReader(io.BytesIO(data))
        if reader.is_encrypted:
            reader.decrypt("")  # KAP PDFs are sometimes "encrypted" with an empty owner password
        page_count = len(reader.pages)
    except Exception as e:
        raise PdfTextError(f"{type(e).__name__}: {e}"[:200]) from e

    parts: list[str] = []
    total = 0
    pages_read = 0
    pages_with_text = 0
    truncated = page_count > max_pages
    for number in range(min(page_count, max_pages)):
        try:
            text = _tidy(_page_text(reader.pages[number]))
        except Exception as e:
            logger.info("pdf_page_unreadable", page=number + 1, error=f"{type(e).__name__}: {e}"[:200])
            text = ""
        pages_read += 1
        if not text.strip():
            continue
        pages_with_text += 1
        if total + len(text) > max_chars:
            parts.append(text[: max(max_chars - total, 0)].rstrip())
            truncated = True
            break
        parts.append(text)
        total += len(text) + 2
    return PdfText(
        text="\n\n".join(p for p in parts if p),
        pages=page_count,
        pages_read=pages_read,
        pages_with_text=pages_with_text,
        truncated=truncated,
    )
