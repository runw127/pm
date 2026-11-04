import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.auth import SESSION_COOKIE
from app.main import create_app


def test_hello(tmp_path: Path) -> None:
    client = TestClient(create_app(tmp_path, tmp_path / "data"))
    response = client.get("/api/hello")
    assert response.status_code == 200
    assert response.json() == {"message": "Hello from FastAPI"}


def test_exported_site_and_asset(tmp_path: Path) -> None:
    (tmp_path / "index.html").write_text("<h1>Kanban Studio</h1>")
    (tmp_path / "_next").mkdir()
    (tmp_path / "_next" / "app.js").write_text("console.log('board')")
    client = TestClient(create_app(tmp_path, tmp_path / "data"))

    page = client.get("/")
    asset = client.get("/_next/app.js")

    assert page.status_code == 200
    assert "Kanban Studio" in page.text
    assert asset.status_code == 200
    assert "console.log" in asset.text


def test_login_session_and_logout(tmp_path: Path) -> None:
    client = TestClient(create_app(tmp_path, tmp_path / "data"))
    assert client.get("/api/session").status_code == 401
    assert client.post(
        "/api/login", json={"username": "user", "password": "wrong"}
    ).status_code == 401
    assert client.get("/api/session").status_code == 401
    assert client.post(
        "/api/login", json={"username": "user", "password": "x" * 101}
    ).status_code == 422

    login = client.post(
        "/api/login", json={"username": "user", "password": "password"}
    )
    assert login.status_code == 200
    assert login.json() == {"username": "user"}
    assert "httponly" in login.headers["set-cookie"].lower()
    assert "max-age=" in login.headers["set-cookie"].lower()
    assert client.get("/api/session").json() == {"username": "user"}

    token = client.cookies.get(SESSION_COOKIE)
    restarted = TestClient(create_app(tmp_path, tmp_path / "data"))
    restarted.cookies.set(SESSION_COOKIE, token)
    assert restarted.get("/api/session").json() == {"username": "user"}

    assert client.post("/api/logout").status_code == 204
    assert client.get("/api/session").status_code == 401
    restarted.cookies.set(SESSION_COOKIE, token)
    assert restarted.get("/api/session").status_code == 401


def test_invalid_and_expired_session(tmp_path: Path) -> None:
    application = create_app(tmp_path, tmp_path / "data")
    client = TestClient(application)
    client.cookies.set(SESSION_COOKIE, "invalid")
    assert client.get("/api/session").status_code == 401

    token = application.state.sessions.create("user")
    path = application.state.sessions._path(token)
    path.write_text(json.dumps({"username": "user", "expires_at": 0}))
    client.cookies.set(SESSION_COOKIE, token)
    assert client.get("/api/session").status_code == 401
    assert not path.exists()
