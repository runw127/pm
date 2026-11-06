import sqlite3
from contextlib import closing
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import create_app
from app.users import SESSION_COOKIE, hash_password, verify_password
from tests.helpers import client_for


def login(client: TestClient, username: str = "user", password: str = "password"):
    return client.post("/api/login", json={"username": username, "password": password})


def test_hello(app: FastAPI) -> None:
    response = TestClient(app).get("/api/hello")
    assert response.json() == {"message": "Hello from FastAPI"}


def test_exported_site_and_asset(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<h1>Kanban Studio</h1>")
    (tmp_path / "_next").mkdir()
    (tmp_path / "_next" / "app.js").write_text("console.log('board')")
    client = TestClient(create_app(tmp_path, tmp_path / "data"))
    assert "Kanban Studio" in client.get("/").text
    assert "console.log" in client.get("/_next/app.js").text


def test_password_hashing() -> None:
    stored = hash_password("secret-password")
    assert stored.startswith("scrypt$") and "secret-password" not in stored
    assert verify_password("secret-password", stored)
    assert not verify_password("wrong", stored)
    assert not verify_password("anything", None)
    assert hash_password("same") != hash_password("same")


def test_default_admin_login_session_and_logout(tmp_path: Path, app: FastAPI) -> None:
    client = TestClient(app)
    assert client.get("/api/session").status_code == 401
    assert login(client, password="wrong").status_code == 401
    assert login(client, username="nobody").status_code == 401
    assert login(client, password="x" * 129).status_code == 422

    response = login(client)
    assert response.status_code == 200
    assert response.json()["username"] == "user"
    assert response.json()["isAdmin"] is True
    cookie = response.headers["set-cookie"].lower()
    assert "httponly" in cookie and "max-age=" in cookie and "samesite=strict" in cookie
    assert client.get("/api/session").json()["username"] == "user"

    token = client.cookies.get(SESSION_COOKIE)
    restarted = TestClient(create_app(tmp_path, tmp_path / "data"))
    restarted.cookies.set(SESSION_COOKIE, token)
    assert restarted.get("/api/session").json()["username"] == "user"

    assert client.post("/api/logout").status_code == 204
    assert client.get("/api/session").status_code == 401
    restarted.cookies.set(SESSION_COOKIE, token)
    assert restarted.get("/api/session").status_code == 401


def test_invalid_and_expired_session(app: FastAPI) -> None:
    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE, "invalid")
    assert client.get("/api/session").status_code == 401

    user = app.state.users.authenticate("user", "password")
    token = app.state.users.create_session(user.id)
    with app.state.users.database.transaction() as db:
        db.execute("UPDATE sessions SET expires_at = 0")
    client.cookies.set(SESSION_COOKIE, token)
    assert client.get("/api/session").status_code == 401
    with app.state.users.database.transaction() as db:
        assert db.execute("SELECT count(*) FROM sessions").fetchone()[0] == 0


def test_register_signs_in_new_member(app: FastAPI) -> None:
    client = TestClient(app)
    response = client.post("/api/register", json={"username": "Alice", "password": "alice-pass"})
    assert response.status_code == 201
    assert response.json()["username"] == "Alice"
    assert response.json()["isAdmin"] is False
    assert client.get("/api/session").json()["username"] == "Alice"

    other = TestClient(app)
    assert login(other, "alice", "alice-pass").status_code == 200


def test_register_validation(app: FastAPI) -> None:
    client = TestClient(app)
    client.post("/api/register", json={"username": "taken", "password": "password1"})
    cases = [
        ({"username": "ab", "password": "password1"}, 422),
        ({"username": "has space", "password": "password1"}, 422),
        ({"username": "x" * 33, "password": "password1"}, 422),
        ({"username": "short-pass", "password": "1234567"}, 422),
        ({"username": "TAKEN", "password": "password1"}, 409),
        ({"username": "user", "password": "password1"}, 409),
    ]
    for body, status in cases:
        response = TestClient(app).post("/api/register", json=body)
        assert response.status_code == status, body
        assert SESSION_COOKIE not in response.cookies


def test_change_password_keeps_current_session_only(app: FastAPI) -> None:
    current = client_for(app, "member")
    other_device = client_for(app, "member")
    assert current.post("/api/account/password", json={
        "currentPassword": "wrong-pass", "newPassword": "new-password"
    }).status_code == 403
    assert current.post("/api/account/password", json={
        "currentPassword": "password123", "newPassword": "short"
    }).status_code == 422
    assert current.post("/api/account/password", json={
        "currentPassword": "password123", "newPassword": "new-password"
    }).status_code == 204

    assert current.get("/api/session").status_code == 200
    assert other_device.get("/api/session").status_code == 401
    assert login(TestClient(app), "member", "password123").status_code == 401
    assert login(TestClient(app), "member", "new-password").status_code == 200


def test_delete_account_removes_data_and_sessions(app: FastAPI) -> None:
    member = client_for(app, "member")
    board_id = member.get("/api/boards").json()[0]["id"]
    assert member.request("DELETE", "/api/account", json={"password": "wrong-pass"}).status_code == 403
    assert member.request("DELETE", "/api/account", json={"password": "password123"}).status_code == 204
    assert member.get("/api/session").status_code == 401
    assert login(TestClient(app), "member", "password123").status_code == 401
    with app.state.users.database.transaction() as db:
        assert db.execute("SELECT count(*) FROM boards WHERE id = ?", (board_id,)).fetchone()[0] == 0


def test_last_admin_cannot_delete_account_or_be_demoted(app: FastAPI) -> None:
    admin = client_for(app)
    admin_id = admin.get("/api/session").json()["id"]
    response = admin.request("DELETE", "/api/account", json={"password": "password"})
    assert response.status_code == 422
    assert response.json() == {"detail": "At least one admin is required"}
    assert admin.patch(f"/api/admin/users/{admin_id}", json={"isAdmin": False}).status_code == 422


def test_admin_manages_users(app: FastAPI) -> None:
    admin = client_for(app)
    member = client_for(app, "member")
    member_id = member.get("/api/session").json()["id"]
    member.get("/api/boards")

    assert TestClient(app).get("/api/admin/users").status_code == 401
    assert member.get("/api/admin/users").status_code == 403
    assert member.delete(f"/api/admin/users/{member_id}").status_code == 403

    users = admin.get("/api/admin/users").json()
    assert [(item["username"], item["isAdmin"]) for item in users] == [
        ("user", True), ("member", False)
    ]
    assert users[1]["boardCount"] == 1

    promoted = admin.patch(f"/api/admin/users/{member_id}", json={"isAdmin": True})
    assert promoted.json()[1]["isAdmin"] is True
    assert member.get("/api/session").json()["isAdmin"] is True
    assert member.get("/api/admin/users").status_code == 200
    admin.patch(f"/api/admin/users/{member_id}", json={"isAdmin": False})

    assert admin.post(f"/api/admin/users/{member_id}/password", json={"password": "short"}).status_code == 422
    assert admin.post(f"/api/admin/users/{member_id}/password", json={"password": "reset-pass"}).status_code == 204
    assert member.get("/api/session").status_code == 401
    assert login(TestClient(app), "member", "reset-pass").status_code == 200

    admin_id = admin.get("/api/session").json()["id"]
    assert admin.delete(f"/api/admin/users/{admin_id}").status_code == 422
    assert admin.delete("/api/admin/users/missing").status_code == 404
    assert admin.patch("/api/admin/users/missing", json={"isAdmin": True}).status_code == 404
    assert admin.post("/api/admin/users/missing/password", json={"password": "reset-pass"}).status_code == 404
    remaining = admin.delete(f"/api/admin/users/{member_id}").json()
    assert [item["username"] for item in remaining] == ["user"]


def test_default_admin_is_seeded_once(tmp_path: Path) -> None:
    app = create_app(tmp_path, tmp_path / "data")
    client = client_for(app)
    client.post("/api/account/password", json={
        "currentPassword": "password", "newPassword": "changed-pass"
    })
    restarted = create_app(tmp_path, tmp_path / "data")
    assert login(TestClient(restarted), "user", "password").status_code == 401
    assert login(TestClient(restarted), "user", "changed-pass").status_code == 200


def test_migrates_version_one_database(tmp_path: Path) -> None:
    path = tmp_path / "data" / "board.sqlite3"
    path.parent.mkdir()
    with closing(sqlite3.connect(path)) as db:
        db.executescript("""
            CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE);
            CREATE TABLE boards (id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE);
            CREATE TABLE columns (board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
                id TEXT NOT NULL, slot INTEGER NOT NULL, title TEXT NOT NULL,
                PRIMARY KEY (board_id, id));
            CREATE TABLE cards (id TEXT PRIMARY KEY, board_id TEXT NOT NULL,
                column_id TEXT NOT NULL, position INTEGER NOT NULL, title TEXT NOT NULL,
                details TEXT NOT NULL DEFAULT '',
                FOREIGN KEY (board_id, column_id) REFERENCES columns(board_id, id));
            CREATE INDEX cards_in_column ON cards(board_id, column_id, position, id);
            INSERT INTO users VALUES ('user-1', 'user');
            INSERT INTO boards VALUES ('board-1', 'user-1');
            INSERT INTO columns VALUES ('board-1', 'col-backlog', 0, 'Ideas'),
                                       ('board-1', 'col-done', 4, 'Shipped');
            INSERT INTO cards VALUES ('card-1', 'board-1', 'col-backlog', 0, 'Kept', 'Notes');
            PRAGMA user_version = 1;
        """)

    app = create_app(tmp_path, tmp_path / "data")
    client = TestClient(app)
    assert login(client).status_code == 200
    assert client.get("/api/boards").json()[0]["name"] == "My board"
    board = client.get("/api/boards/board-1").json()
    assert [(column["id"], column["title"]) for column in board["columns"]] == [
        ("col-backlog", "Ideas"), ("col-done", "Shipped")
    ]
    assert board["cards"]["card-1"] == {
        "id": "card-1", "title": "Kept", "details": "Notes",
        "priority": "medium", "dueDate": None, "labels": [], "assigneeId": None, "commentCount": 0, "checklist": [],
    }
    with closing(sqlite3.connect(path)) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 6
        tables = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        assert tables >= {"users", "sessions", "boards", "columns", "cards", "board_members",
                          "card_comments", "activity"}


def test_default_app_uses_root_data_dir(tmp_path: Path, monkeypatch) -> None:
    import app.main

    monkeypatch.setattr(app.main, "ROOT_DIR", tmp_path)
    app.main.default_app()
    assert (tmp_path / "data" / "board.sqlite3").exists()


def test_default_app_honors_path_overrides(tmp_path: Path, monkeypatch) -> None:
    import app.main

    monkeypatch.setenv("PM_DATA_DIR", str(tmp_path / "custom"))
    monkeypatch.setenv("PM_FRONTEND_DIR", str(tmp_path))
    (tmp_path / "index.html").write_text("custom site")
    client = TestClient(app.main.default_app())
    assert client.get("/").text == "custom site"
    assert (tmp_path / "custom" / "board.sqlite3").exists()
