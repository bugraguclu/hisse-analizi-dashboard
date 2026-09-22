"""Request context middleware (pure ASGI, streaming-safe).

* Accepts a well-formed incoming ``X-Request-ID`` or generates one, exposes it as
  ``request.state.request_id``, binds it to the structlog context and echoes it in
  the response headers.
* Logs one ``http_request`` line per request (method, path, status, duration) —
  health checks are skipped to keep logs quiet.
* Converts any unhandled exception into a generic Turkish ``500 {"detail": ...}``
  response: stack traces and exception text are logged, never sent to the client.
"""

import json
import re
import time
import uuid

import structlog
from starlette.datastructures import MutableHeaders
from starlette.requests import Request
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from src.api.limiter import client_ip_key

logger = structlog.get_logger("src.api.request")

REQUEST_ID_HEADER = "X-Request-ID"
INTERNAL_ERROR_DETAIL = "Beklenmeyen bir sunucu hatası oluştu. Lütfen daha sonra tekrar deneyin."

_REQUEST_ID_RE = re.compile(r"[A-Za-z0-9._:-]{1,128}")
_QUIET_PATHS = frozenset({"/health", "/health/ready"})


def resolve_request_id(incoming: str | None) -> str:
    """Reuse a sane caller-provided id (tracing across the proxy), else generate one."""
    if incoming and _REQUEST_ID_RE.fullmatch(incoming):  # fullmatch: "$" would allow a trailing "\n"
        return incoming
    return uuid.uuid4().hex


class RequestContextMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        incoming = None
        for name, value in scope.get("headers", []):
            if name == b"x-request-id":
                incoming = value.decode("latin-1")
                break
        request_id = resolve_request_id(incoming)
        scope.setdefault("state", {})["request_id"] = request_id

        method = scope.get("method", "")
        path = scope.get("path", "")
        started = time.perf_counter()
        status_code = 500
        response_started = False

        async def send_wrapper(message: Message) -> None:
            nonlocal status_code, response_started
            if message["type"] == "http.response.start":
                response_started = True
                status_code = message["status"]
                MutableHeaders(scope=message)[REQUEST_ID_HEADER] = request_id
            await send(message)

        structlog.contextvars.bind_contextvars(request_id=request_id)
        try:
            await self.app(scope, receive, send_wrapper)
        except Exception:
            logger.exception("unhandled_exception", method=method, path=path)
            if response_started:
                raise  # headers already sent; the server can only drop the connection
            status_code = 500
            await self._send_internal_error(send, request_id)
        finally:
            if path not in _QUIET_PATHS:
                self._log(scope, method, path, status_code, started)
            structlog.contextvars.unbind_contextvars("request_id")

    @staticmethod
    async def _send_internal_error(send: Send, request_id: str) -> None:
        body = json.dumps({"detail": INTERNAL_ERROR_DETAIL}, ensure_ascii=False).encode("utf-8")
        await send(
            {
                "type": "http.response.start",
                "status": 500,
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body)).encode("latin-1")),
                    (REQUEST_ID_HEADER.lower().encode("latin-1"), request_id.encode("latin-1")),
                ],
            }
        )
        await send({"type": "http.response.body", "body": body})

    @staticmethod
    def _log(scope: Scope, method: str, path: str, status_code: int, started: float) -> None:
        duration_ms = round((time.perf_counter() - started) * 1000, 1)
        try:
            client: str | None = client_ip_key(Request(scope))
        except Exception:
            client = None
        log = logger.warning if status_code >= 500 else logger.info
        log("http_request", method=method, path=path, status=status_code, duration_ms=duration_ms, client=client)
