import hashlib
import hmac
import re
import secrets
import time
from dataclasses import dataclass
from uuid import uuid4

from app.db import Database, now

SESSION_COOKIE = "pm_session"
SESSION_SECONDS = 30 * 24 * 60 * 60
USERNAME_PATTERN = re.compile(r"[A-Za-z0-9_.-]{3,32}")
PASSWORD_MIN_LENGTH = 8
PASSWORD_MAX_LENGTH = 128
DEFAULT_USERNAME = "user"
DEFAULT_PASSWORD = "password"
SCRYPT = {"n": 2**14, "r": 8, "p": 1}


class UserError(Exception):
    status_code = 422


class UserNotFound(UserError):
    status_code = 404


class UserConflict(UserError):
    status_code = 409


class AuthError(UserError):
    status_code = 401


class WrongPassword(UserError):
    """A signed-in user's password confirmation failed; 403 so it never looks like expiry."""

    status_code = 403


@dataclass(frozen=True)
class CurrentUser:
    id: str
    username: str
    is_admin: bool

    def public(self) -> dict:
        return {"id": self.id, "username": self.username, "isAdmin": self.is_admin}


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, **SCRYPT)
    return f"scrypt${salt.hex()}${digest.hex()}"


def verify_password(password: str, stored: str | None) -> bool:
    if not stored:
        return False
    _, salt, digest = stored.split("$")
    candidate = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), **SCRYPT)
    return hmac.compare_digest(candidate.hex(), digest)


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _username(value: str) -> str:
    if not USERNAME_PATTERN.fullmatch(value):
        raise UserError("Username must be 3-32 letters, numbers, dots, dashes, or underscores")
    return value


def _password(value: str) -> str:
    if not PASSWORD_MIN_LENGTH <= len(value) <= PASSWORD_MAX_LENGTH:
        raise UserError(
            f"Password must be {PASSWORD_MIN_LENGTH}-{PASSWORD_MAX_LENGTH} characters"
        )
    return value


def _user(row) -> CurrentUser:
    return CurrentUser(row["id"], row["username"], bool(row["is_admin"]))


class UserStore:
    def __init__(self, database: Database) -> None:
        self.database = database
        with database.transaction() as db:
            if not db.execute("SELECT 1 FROM users WHERE password_hash IS NOT NULL").fetchone():
                self._seed_default(db)

    def _seed_default(self, db) -> None:
        row = db.execute("SELECT id FROM users WHERE username = ?", (DEFAULT_USERNAME,)).fetchone()
        password_hash = hash_password(DEFAULT_PASSWORD)
        if row:
            db.execute(
                "UPDATE users SET password_hash = ?, is_admin = 1 WHERE id = ?",
                (password_hash, row["id"]),
            )
        else:
            db.execute(
                """INSERT INTO users (id, username, password_hash, is_admin, created_at)
                   VALUES (?, ?, ?, 1, ?)""",
                (f"user-{uuid4().hex}", DEFAULT_USERNAME, password_hash, now()),
            )

    def register(self, username: str, password: str) -> CurrentUser:
        username = _username(username)
        password_hash = hash_password(_password(password))
        with self.database.transaction() as db:
            if db.execute("SELECT 1 FROM users WHERE username = ?", (username,)).fetchone():
                raise UserConflict("Username is already taken")
            user_id = f"user-{uuid4().hex}"
            db.execute(
                """INSERT INTO users (id, username, password_hash, is_admin, created_at)
                   VALUES (?, ?, ?, 0, ?)""",
                (user_id, username, password_hash, now()),
            )
        return CurrentUser(user_id, username, False)

    def authenticate(self, username: str, password: str) -> CurrentUser:
        with self.database.transaction() as db:
            row = db.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
        if not row or not verify_password(password, row["password_hash"]):
            raise AuthError("Invalid credentials")
        return _user(row)

    def create_session(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        with self.database.transaction() as db:
            db.execute("DELETE FROM sessions WHERE expires_at <= ?", (time.time(),))
            db.execute(
                "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                (_token_hash(token), user_id, time.time() + SESSION_SECONDS),
            )
        return token

    def session_user(self, token: str | None) -> CurrentUser | None:
        if not token:
            return None
        with self.database.transaction() as db:
            row = db.execute(
                """SELECT users.*, sessions.expires_at FROM sessions
                   JOIN users ON users.id = sessions.user_id WHERE token_hash = ?""",
                (_token_hash(token),),
            ).fetchone()
            if row and row["expires_at"] <= time.time():
                db.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))
                return None
        return _user(row) if row else None

    def delete_session(self, token: str | None) -> None:
        if token:
            with self.database.transaction() as db:
                db.execute("DELETE FROM sessions WHERE token_hash = ?", (_token_hash(token),))

    def change_password(self, user_id: str, current: str, new: str, keep_token: str | None) -> None:
        password_hash = hash_password(_password(new))
        with self.database.transaction() as db:
            row = db.execute("SELECT password_hash FROM users WHERE id = ?", (user_id,)).fetchone()
            if not verify_password(current, row["password_hash"]):
                raise WrongPassword("Current password is incorrect")
            db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
            db.execute(
                "DELETE FROM sessions WHERE user_id = ? AND token_hash != ?",
                (user_id, _token_hash(keep_token or "")),
            )

    def delete_account(self, user: CurrentUser, password: str) -> None:
        with self.database.transaction() as db:
            row = db.execute("SELECT password_hash FROM users WHERE id = ?", (user.id,)).fetchone()
            if not verify_password(password, row["password_hash"]):
                raise WrongPassword("Password is incorrect")
            self._delete(db, user.id)

    def list_users(self) -> list[dict]:
        with self.database.transaction() as db:
            rows = db.execute(
                """SELECT users.id, username, is_admin, users.created_at, count(boards.id) AS boards
                   FROM users LEFT JOIN boards ON boards.user_id = users.id
                   GROUP BY users.id ORDER BY users.created_at, users.rowid"""
            ).fetchall()
        return [
            {"id": row["id"], "username": row["username"], "isAdmin": bool(row["is_admin"]),
             "createdAt": row["created_at"], "boardCount": row["boards"]}
            for row in rows
        ]

    def set_admin(self, user_id: str, is_admin: bool) -> list[dict]:
        with self.database.transaction() as db:
            self._existing(db, user_id)
            if not is_admin:
                self._guard_last_admin(db, user_id)
            db.execute("UPDATE users SET is_admin = ? WHERE id = ?", (int(is_admin), user_id))
        return self.list_users()

    def reset_password(self, user_id: str, password: str) -> None:
        password_hash = hash_password(_password(password))
        with self.database.transaction() as db:
            self._existing(db, user_id)
            db.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
            db.execute("DELETE FROM sessions WHERE user_id = ?", (user_id,))

    def remove_user(self, user_id: str) -> list[dict]:
        with self.database.transaction() as db:
            self._existing(db, user_id)
            self._delete(db, user_id)
        return self.list_users()

    def _existing(self, db, user_id: str) -> None:
        if not db.execute("SELECT 1 FROM users WHERE id = ?", (user_id,)).fetchone():
            raise UserNotFound("User not found")

    def _guard_last_admin(self, db, user_id: str) -> None:
        admins = [row["id"] for row in db.execute("SELECT id FROM users WHERE is_admin = 1")]
        if admins == [user_id]:
            raise UserError("At least one admin is required")

    def _delete(self, db, user_id: str) -> None:
        self._guard_last_admin(db, user_id)
        db.execute("DELETE FROM users WHERE id = ?", (user_id,))
