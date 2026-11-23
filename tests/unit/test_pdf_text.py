"""PDF attachment text extraction (src/parsers/pdf_text.py) on small hand-built PDFs."""

import pytest

from src.parsers import pdf_text
from src.parsers.pdf_text import PdfTextError, extract_pdf_text


def make_pdf(*pages: list[str]) -> bytes:
    """A minimal valid PDF: one Helvetica text line per string, an empty page for []."""
    objects: list[bytes] = []
    page_ids = [4 + 2 * i for i in range(len(pages))]
    objects.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    kids = " ".join(f"{pid} 0 R" for pid in page_ids)
    objects.append(f"<< /Type /Pages /Kids [{kids}] /Count {len(pages)} >>".encode())
    objects.append(b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")
    for pid, lines in zip(page_ids, pages, strict=True):
        ops = ["BT", "/F1 11 Tf", "14 TL", "40 800 Td"]
        for line in lines:
            escaped = line.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")
            ops.append(f"({escaped}) Tj T*")
        ops.append("ET")
        stream = "\n".join(ops).encode("latin-1") if lines else b""
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> "
            f"/Contents {pid + 1} 0 R >>".encode()
        )
        objects.append(b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream")
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % number + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    for offset in offsets:
        out += b"%010d 00000 n \n" % offset
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref)
    return bytes(out)


def test_text_of_every_page_in_order():
    pdf = extract_pdf_text(make_pdf(["Ozel Durum Aciklamasi", "Pay alimi yapilmistir."], ["Ikinci sayfa"]))

    assert pdf.pages == 2 and pdf.pages_read == 2 and pdf.pages_with_text == 2
    assert not pdf.truncated
    assert pdf.text.index("Ozel Durum Aciklamasi") < pdf.text.index("Pay alimi") < pdf.text.index("Ikinci sayfa")


def test_a_pdf_without_a_text_layer_reports_no_text_pages():
    pdf = extract_pdf_text(make_pdf([], []))

    assert pdf.pages == 2 and pdf.pages_with_text == 0 and pdf.text == ""


def test_page_and_length_caps_mark_the_text_truncated():
    many = make_pdf(*[[f"Sayfa {n}"] for n in range(1, 6)])

    by_pages = extract_pdf_text(many, max_pages=2)
    assert by_pages.pages == 5 and by_pages.pages_read == 2 and by_pages.truncated
    assert "Sayfa 2" in by_pages.text and "Sayfa 3" not in by_pages.text

    by_chars = extract_pdf_text(make_pdf(["x" * 80], ["y" * 80]), max_chars=50)
    assert by_chars.truncated and len(by_chars.text) <= 50


@pytest.mark.parametrize("data", [b"", b"<html>not found</html>", b"%PDF-1.4\ngarbage without objects"])
def test_bytes_that_are_not_a_readable_pdf_raise(data):
    with pytest.raises(PdfTextError):
        extract_pdf_text(data)


def test_justified_prose_collapses_but_table_columns_stay_aligned():
    prose = "BU    DUYURU,   BU  DUYURUDAN    BAHSEDILEN"
    row = "20/11/2026     BAHKM        1.582.934,00       1.668.087,00"

    assert pdf_text._unjustify(prose) == "BU DUYURU, BU DUYURUDAN BAHSEDILEN"
    assert pdf_text._unjustify(row) == row


def test_tidy_drops_the_shared_left_margin_and_extra_blank_lines():
    text = "      Baslik\n\n\n\n      Govde   \n         girintili "

    assert pdf_text._tidy(text) == "Baslik\n\nGovde\n   girintili"
