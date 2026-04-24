"""Rate-limit key: real client IP when behind nginx (X-Forwarded-For)."""

from slowapi.util import get_remote_address
from starlette.requests import Request


def rate_limit_client_ip(request: Request) -> str:
    xff = request.headers.get("x-forwarded-for")
    if xff:
        part = xff.split(",")[0].strip()
        if part:
            return part
    return get_remote_address(request)
