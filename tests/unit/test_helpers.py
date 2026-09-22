"""Unit tests for parsers/helpers.py — fixture-bağımsız."""
from zoneinfo import ZoneInfo

import pytest

from src.parsers.helpers import (
    compute_content_hash,
    compute_dedup_key,
    restore_turkish_name,
    turkish_title,
    parse_date,
    strip_html,
    clean_whitespace,
    truncate,
)

ISTANBUL = ZoneInfo("Europe/Istanbul")


class TestContentHash:
    def test_deterministic(self):
        h1 = compute_content_hash("https://example.com", "Test Title", "2024-01-01T00:00:00")
        h2 = compute_content_hash("https://example.com", "Test Title", "2024-01-01T00:00:00")
        assert h1 == h2

    def test_different_inputs(self):
        h1 = compute_content_hash("https://a.com", "Title A", "2024-01-01")
        h2 = compute_content_hash("https://b.com", "Title B", "2024-01-02")
        assert h1 != h2

    def test_sha256_length(self):
        h = compute_content_hash("url", "title", "date")
        assert len(h) == 64

    def test_empty_inputs(self):
        h = compute_content_hash("", "", "")
        assert len(h) == 64


class TestDedupKey:
    def test_normalized_title(self):
        k1 = compute_dedup_key("kap", "https://url", "2024-01-01", "  Test   Title  ")
        k2 = compute_dedup_key("kap", "https://url", "2024-01-01", "test title")
        assert k1 == k2

    def test_case_insensitive(self):
        k1 = compute_dedup_key("kap", "url", "date", "HELLO WORLD")
        k2 = compute_dedup_key("kap", "url", "date", "hello world")
        assert k1 == k2

    def test_different_source(self):
        k1 = compute_dedup_key("kap", "url", "date", "title")
        k2 = compute_dedup_key("anadoluefes_news", "url", "date", "title")
        assert k1 != k2

    def test_scope_separates_multi_company_disclosures(self):
        legacy = compute_dedup_key("kap", "url", "date", "title")
        assert compute_dedup_key("kap", "url", "date", "title", scope="") == legacy
        kchol = compute_dedup_key("kap", "url", "date", "title", scope="KCHOL")
        arclk = compute_dedup_key("kap", "url", "date", "title", scope="ARCLK")
        assert len({legacy, kchol, arclk}) == 3


class TestParseDate:
    def test_turkish_dotted_format(self):
        dt = parse_date("09.03.2026 17:21:15")
        assert dt is not None
        assert dt.year == 2026
        assert dt.month == 3
        assert dt.day == 9
        assert dt.hour == 17
        assert dt.minute == 21

    def test_iso_format(self):
        dt = parse_date("2024-01-15T10:30:00")
        assert dt is not None
        assert dt.year == 2024
        assert dt.month == 1

    def test_date_only(self):
        dt = parse_date("2024-06-15")
        assert dt is not None
        assert dt.year == 2024
        assert dt.month == 6

    def test_dotted_date_only(self):
        dt = parse_date("15.06.2024")
        assert dt is not None
        assert dt.year == 2024
        assert dt.month == 6
        assert dt.day == 15

    def test_none_input(self):
        assert parse_date(None) is None

    def test_empty_input(self):
        assert parse_date("") is None

    def test_garbage_input(self):
        assert parse_date("not a date") is None

    def test_timezone_aware(self):
        dt = parse_date("09.03.2026 17:21:15")
        assert dt is not None
        assert dt.tzinfo is not None


class TestStripHtml:
    def test_basic_tags(self):
        assert strip_html("<p>Hello</p>") == "Hello"

    def test_nested_tags(self):
        assert strip_html("<div><p>Hello <b>World</b></p></div>") == "Hello World"

    def test_none(self):
        assert strip_html(None) == ""

    def test_empty(self):
        assert strip_html("") == ""

    def test_preserves_text(self):
        assert strip_html("No tags here") == "No tags here"


class TestCleanWhitespace:
    def test_multiple_spaces(self):
        assert clean_whitespace("hello   world") == "hello world"

    def test_tabs_and_newlines(self):
        assert clean_whitespace("hello\t\n\rworld") == "hello world"

    def test_leading_trailing(self):
        assert clean_whitespace("  hello  ") == "hello"

    def test_none(self):
        assert clean_whitespace(None) == ""


class TestTruncate:
    def test_short_text(self):
        assert truncate("hello", 10) == "hello"

    def test_long_text(self):
        result = truncate("a" * 600, 500)
        assert len(result) == 503  # 500 + "..."
        assert result.endswith("...")

    def test_none(self):
        assert truncate(None) == ""


class TestParseDateTurkish:
    def test_uppercase_turkish_month_with_dotless_i(self):
        dt = parse_date("30 ARALIK 2025 14:00")
        assert dt is not None
        assert (dt.year, dt.month, dt.day, dt.hour) == (2025, 12, 30, 14)

    def test_ascii_folded_month_name(self):
        dt = parse_date("9 Subat 2026")
        assert dt is not None and (dt.month, dt.day) == (2, 9)

    def test_kap_local_time_is_istanbul_instant(self):
        dt = parse_date("22.09.2026 11:16:04")
        assert dt is not None
        assert dt.tzinfo == ISTANBUL
        assert dt.utcoffset().total_seconds() == 3 * 3600  # 08:16:04 UTC

    def test_explicit_offset_is_kept(self):
        dt = parse_date("2026-09-22T08:16:04+00:00")
        assert dt is not None and dt.utcoffset().total_seconds() == 0


class TestRestoreTurkishName:
    @pytest.mark.parametrize(
        ("short", "official", "expected"),
        [
            ("Eczacibasi Ilac", "ECZACIBAŞI İLAÇ, SINAİ VE FİNANSAL YATIRIMLAR SANAYİ VE TİCARET A.Ş.", "Eczacıbaşı İlaç"),
            ("Isiklar Enerji Yapi Hol.", "IŞIKLAR ENERJİ YAPI HOLDİNG A.Ş.", "Işıklar Enerji Yapı Hol."),
            ("BIM Magazalar", "BİM BİRLEŞİK MAĞAZALAR A.Ş.", "BİM Mağazalar"),
            ("Tukas", "TUKAŞ GIDA SANAYİ VE TİCARET A.Ş.", "Tukaş"),
        ],
    )
    def test_restores_letters_from_official_title(self, short, official, expected):
        assert restore_turkish_name(short, official) == expected

    def test_unmatched_words_and_missing_title_are_kept(self):
        assert restore_turkish_name("Sisecam", "TÜRKİYE ŞİŞE VE CAM FABRİKALARI A.Ş.") == "Sisecam"
        assert restore_turkish_name("Eczacibasi Ilac", "") == "Eczacibasi Ilac"

    def test_turkish_title_casing(self):
        assert turkish_title("İLAÇ") == "İlaç"
        assert turkish_title("IŞIKLAR") == "Işıklar"
