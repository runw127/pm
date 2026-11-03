import hashlib
import json
import secrets
import time
from pathlib import Path

SESSION_COOKIE = "pm_session"
SESSION_SECONDS = 30 * 24 * 60 * 60


class SessionStore:
    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.directory.mkdir(parents=True, exist_ok=True)

    def _path(self, token: str) -> Path:
        return self.directory / hashlib.sha256(token.encode()).hexdigest()

    def create(self, username: str) -> str:
        token = secrets.token_urlsafe(32)
        self._path(token).write_text(
            json.dumps({"username": username, "expires_at": time.time() + SESSION_SECONDS})
        )
        return token

    def username(self, token: str | None) -> str | None:
        if not token:
            return None
        path = self._path(token)
        if not path.exists():
            return None
        session = json.loads(path.read_text())
        if session["expires_at"] <= time.time():
            path.unlink()
            return None
        return session["username"]

    def delete(self, token: str | None) -> None:
        if token:
            self._path(token).unlink(missing_ok=True)
