from __future__ import annotations

import secrets

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from .config import get_settings


security = HTTPBasic(auto_error=False)


PUBLIC_PATHS = {"/api/health", "/api/auth/status"}


def require_basic_auth(request: Request, credentials: HTTPBasicCredentials | None = Depends(security)) -> None:
    if request.url.path in PUBLIC_PATHS:
        return

    settings = get_settings()
    if not settings.auth_enabled:
        return

    if credentials is None:
        raise_auth_required(settings.auth_realm)

    username_ok = secrets.compare_digest(credentials.username, settings.auth_username)
    password_ok = secrets.compare_digest(credentials.password, settings.auth_password)
    if not (username_ok and password_ok):
        raise_auth_required(settings.auth_realm)


def raise_auth_required(_realm: str) -> None:
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
    )
