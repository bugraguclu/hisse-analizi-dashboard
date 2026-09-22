"""Client identification for rate limiting behind the Next.js proxy."""

import pytest
from starlette.requests import Request

from src.api import limiter as limiter_module
from src.api.limiter import client_ip_key, parse_trusted_networks, resolve_client_ip

DEFAULT_TRUSTED = parse_trusted_networks("127.0.0.1,::1,172.16.0.0/12,10.0.0.0/8,192.168.0.0/16")


def resolve(peer, *xff):
    return resolve_client_ip(peer, list(xff), DEFAULT_TRUSTED)


class TestResolveClientIp:
    def test_direct_client_without_proxy(self):
        assert resolve("203.0.113.7") == "203.0.113.7"

    def test_untrusted_peer_cannot_spoof_forwarded_for(self):
        assert resolve("203.0.113.7", "1.2.3.4") == "203.0.113.7"

    def test_trusted_proxy_forwards_client(self):
        assert resolve("127.0.0.1", "203.0.113.7") == "203.0.113.7"

    def test_leftmost_client_supplied_entry_is_not_trusted(self):
        # client sent "X-Forwarded-For: 1.2.3.4"; the proxy appended the real address
        assert resolve("172.18.0.3", "1.2.3.4, 203.0.113.7") == "203.0.113.7"

    def test_skips_trusted_hops_from_the_right(self):
        assert resolve("127.0.0.1", "1.2.3.4, 203.0.113.7, 10.0.0.5, 192.168.1.2") == "203.0.113.7"

    def test_multiple_headers_are_combined_in_order(self):
        assert resolve("127.0.0.1", "1.2.3.4", "203.0.113.7") == "203.0.113.7"

    def test_different_clients_behind_the_proxy_get_different_keys(self):
        """The original bug: every browser request shared the proxy's bucket."""
        assert resolve("::1", "203.0.113.7") != resolve("::1", "198.51.100.9")

    def test_trusted_peer_without_header_is_the_client(self):
        assert resolve("127.0.0.1") == "127.0.0.1"

    def test_all_hops_trusted_uses_originating_address(self):
        assert resolve("127.0.0.1", "192.168.1.20, 10.0.0.5") == "192.168.1.20"

    def test_uvicorn_already_resolved_client(self):
        # uvicorn --proxy-headers replaced request.client with the forwarded address
        assert resolve("203.0.113.7", "203.0.113.7") == "203.0.113.7"

    @pytest.mark.parametrize(
        ("hop", "expected"),
        [
            ("203.0.113.7:51234", "203.0.113.7"),
            ("[2001:db8::7]:443", "2001:db8::7"),
            ("2001:db8::7", "2001:db8::7"),
            ("::ffff:203.0.113.7", "203.0.113.7"),
        ],
    )
    def test_address_formats(self, hop, expected):
        assert resolve("127.0.0.1", hop) == expected

    def test_ipv4_mapped_trusted_peer(self):
        assert resolve("::ffff:127.0.0.1", "203.0.113.7") == "203.0.113.7"

    def test_garbage_entry_is_isolated_and_truncated(self):
        key = resolve("127.0.0.1", "x" * 500)
        assert key == "x" * 64

    def test_missing_peer(self):
        assert resolve(None, "203.0.113.7") == "unknown"


def _request(client, *xff):
    headers = [(b"x-forwarded-for", value.encode()) for value in xff]
    return Request({"type": "http", "headers": headers, "client": client})


def test_client_ip_key_reads_request(monkeypatch):
    monkeypatch.setattr(limiter_module.settings, "trusted_proxies", "127.0.0.1")
    assert client_ip_key(_request(("127.0.0.1", 5000), "1.2.3.4, 203.0.113.7")) == "203.0.113.7"
    # a peer outside TRUSTED_PROXIES is never allowed to forward
    assert client_ip_key(_request(("172.18.0.3", 5000), "203.0.113.7")) == "172.18.0.3"


def test_client_ip_key_without_client_info():
    assert client_ip_key(_request(None)) == "unknown"
