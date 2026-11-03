import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.auth import SESSION_COOKIE
from app.board import BoardStore
from app.main import create_app


def signed_in_client(tmp_path: Path, username: str = "user") -> TestClient:
    app = create_app(tmp_path, tmp_path / "data")
    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE, app.state.sessions.create(username))
    return client


def add_card(client: TestClient, column_id: str, title: str) -> tuple[str, dict]:
    response = client.post(
        "/api/board/cards", json={"columnId": column_id, "title": title, "details": "Notes"}
    )
    assert response.status_code == 200
    board = response.json()
    card_id = next(card_id for card_id, card in board["cards"].items() if card["title"] == title)
    return card_id, board


def test_board_requires_login_and_creates_five_columns(tmp_path: Path) -> None:
    app = create_app(tmp_path, tmp_path / "data")
    client = TestClient(app)
    assert client.get("/api/board").status_code == 401
    assert client.post(
        "/api/board/cards", json={"columnId": "col-backlog", "title": "A"}
    ).status_code == 401

    client.cookies.set(SESSION_COOKIE, app.state.sessions.create("user"))
    board = client.get("/api/board").json()
    assert [column["id"] for column in board["columns"]] == [
        "col-backlog", "col-discovery", "col-progress", "col-review", "col-done"
    ]
    assert all(column["cardIds"] == [] for column in board["columns"])
    assert board["cards"] == {}

    with closing(sqlite3.connect(tmp_path / "data" / "board.sqlite3")) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 1
        assert db.execute("SELECT count(*) FROM columns").fetchone()[0] == 5
    assert client.get("/api/board").json() == board


def test_board_edits_and_persists_after_restart(tmp_path: Path) -> None:
    client = signed_in_client(tmp_path)
    renamed = client.patch("/api/board/columns/col-backlog", json={"title": "Ideas"})
    assert renamed.status_code == 200
    assert renamed.json()["columns"][0]["title"] == "Ideas"

    first_id, _ = add_card(client, "col-backlog", "First")
    second_id, board = add_card(client, "col-backlog", "Second")
    assert board["columns"][0]["cardIds"] == [first_id, second_id]
    edited = client.patch(
        f"/api/board/cards/{first_id}", json={"title": "Updated", "details": "New notes"}
    )
    assert edited.status_code == 200
    assert edited.json()["cards"][first_id]["details"] == "New notes"

    moved = client.post(
        f"/api/board/cards/{second_id}/move",
        json={"toColumnId": "col-discovery", "toIndex": 0},
    )
    assert moved.status_code == 200
    assert moved.json()["columns"][0]["cardIds"] == [first_id]
    assert moved.json()["columns"][1]["cardIds"] == [second_id]

    restarted = signed_in_client(tmp_path)
    assert restarted.get("/api/board").json() == moved.json()
    deleted = restarted.delete(f"/api/board/cards/{first_id}")
    assert deleted.status_code == 200
    assert first_id not in deleted.json()["cards"]
    assert deleted.json()["columns"][0]["cardIds"] == []


def test_move_reorders_cards_in_same_and_other_columns(tmp_path: Path) -> None:
    client = signed_in_client(tmp_path)
    first_id, _ = add_card(client, "col-backlog", "First")
    second_id, _ = add_card(client, "col-backlog", "Second")
    third_id, _ = add_card(client, "col-backlog", "Third")

    reordered = client.post(
        f"/api/board/cards/{third_id}/move",
        json={"toColumnId": "col-backlog", "toIndex": 0},
    ).json()
    assert reordered["columns"][0]["cardIds"] == [third_id, first_id, second_id]

    moved = client.post(
        f"/api/board/cards/{third_id}/move",
        json={"toColumnId": "col-done", "toIndex": 0},
    ).json()
    assert moved["columns"][0]["cardIds"] == [first_id, second_id]
    assert moved["columns"][4]["cardIds"] == [third_id]
    assert client.get("/api/board").json() == moved


def test_rejects_invalid_inputs_without_changing_board(tmp_path: Path) -> None:
    client = signed_in_client(tmp_path)
    card_id, original = add_card(client, "col-backlog", "First")
    requests = [
        client.patch("/api/board/columns/col-backlog", json={"title": "  "}),
        client.patch("/api/board/columns/missing", json={"title": "Ideas"}),
        client.post("/api/board/cards", json={"columnId": "missing", "title": "Second"}),
        client.post("/api/board/cards", json={"columnId": "col-backlog", "title": " "}),
        client.patch(f"/api/board/cards/{card_id}", json={"title": "", "details": "X"}),
        client.patch("/api/board/cards/missing", json={"title": "X", "details": "X"}),
        client.delete("/api/board/cards/missing"),
        client.post(f"/api/board/cards/{card_id}/move", json={"toColumnId": "missing", "toIndex": 0}),
        client.post(f"/api/board/cards/{card_id}/move", json={"toColumnId": "col-done", "toIndex": 2}),
        client.post(f"/api/board/cards/{card_id}/move", json={"toColumnId": "col-done", "toIndex": -1}),
    ]
    assert [response.status_code for response in requests] == [
        422, 404, 404, 422, 422, 404, 404, 404, 422, 422
    ]
    assert client.get("/api/board").json() == original


def test_second_user_cannot_change_first_users_card(tmp_path: Path) -> None:
    first = signed_in_client(tmp_path)
    card_id, first_board = add_card(first, "col-backlog", "Private")
    second = signed_in_client(tmp_path, "second-user")
    assert second.get("/api/board").json()["cards"] == {}
    assert second.patch(
        f"/api/board/cards/{card_id}", json={"title": "Changed", "details": ""}
    ).status_code == 404
    assert second.delete(f"/api/board/cards/{card_id}").status_code == 404
    assert second.post(
        f"/api/board/cards/{card_id}/move",
        json={"toColumnId": "col-done", "toIndex": 0},
    ).status_code == 404
    assert first.get("/api/board").json() == first_board


def test_failed_move_rolls_back_column_and_positions(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    store = BoardStore(tmp_path / "board.sqlite3")
    original = store.add_card("user", "col-backlog", "First", "")
    card_id = next(iter(original["cards"]))
    set_positions = store._set_positions

    def fail_after_first_update(db: sqlite3.Connection, board_id: str, card_ids: list[str]) -> None:
        set_positions(db, board_id, card_ids)
        raise RuntimeError("Simulated failure")

    monkeypatch.setattr(store, "_set_positions", fail_after_first_update)
    with pytest.raises(RuntimeError, match="Simulated failure"):
        store.move_card("user", card_id, "col-done", 0)
    assert BoardStore(tmp_path / "board.sqlite3").get("user") == original


def test_rejects_unknown_schema_version(tmp_path: Path) -> None:
    path = tmp_path / "board.sqlite3"
    with closing(sqlite3.connect(path)) as db:
        db.execute("PRAGMA user_version = 2")
    with pytest.raises(RuntimeError, match="Unsupported board database version"):
        BoardStore(path)


def test_detects_incomplete_board_and_nonconsecutive_positions(tmp_path: Path) -> None:
    path = tmp_path / "board.sqlite3"
    store = BoardStore(path)
    store.get("user")
    with closing(sqlite3.connect(path)) as db:
        db.execute("DELETE FROM columns WHERE id = 'col-done'")
        db.commit()
    with pytest.raises(RuntimeError, match="five fixed columns"):
        store.get("user")

    other = BoardStore(tmp_path / "other.sqlite3")
    board = other.add_card("user", "col-backlog", "First", "")
    card_id = next(iter(board["cards"]))
    with closing(sqlite3.connect(other.path)) as db:
        db.execute("UPDATE cards SET position = 3 WHERE id = ?", (card_id,))
        db.commit()
    with pytest.raises(RuntimeError, match="consecutive"):
        other.get("user")
