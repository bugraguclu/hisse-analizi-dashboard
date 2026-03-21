"""Tests for notification subject sanitization."""

from src.services.notification_service import _sanitize_header


class TestSanitizeHeader:
    def test_removes_newlines(self):
        assert _sanitize_header("Hello\nWorld") == "Hello World"

    def test_removes_carriage_return(self):
        assert _sanitize_header("Hello\r\nWorld") == "Hello World"

    def test_strips_whitespace(self):
        assert _sanitize_header("  Hello  ") == "Hello"

    def test_normal_string(self):
        assert _sanitize_header("[THYAO][KAP] Yeni olay") == "[THYAO][KAP] Yeni olay"

    def test_injection_attempt(self):
        evil = "Subject\r\nBcc: attacker@evil.com"
        result = _sanitize_header(evil)
        assert "\r" not in result
        assert "\n" not in result
