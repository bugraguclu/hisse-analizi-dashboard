"""Paylasilan slowapi limiter — app.py ve router'lar ayni ornegi kullanir."""

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address, default_limits=["60/minute"])
