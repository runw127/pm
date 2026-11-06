import sqlite3
from contextlib import closing
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.board import BoardStore
from app.db import Database
from app.main import create_app
from tests.helpers import add_card, client_for, first_board

DEFAULT_IDS = ["col-backlog", "col-discovery", "col-progress", "col-review", "col-done"]


def column_ids(board: dict) -> list[str]:
    return [column["id"] for column in board["columns"]]


def test_board_routes_require_sign_in(app: FastAPI) -> None:
    client = TestClient(app)
    assert client.get("/api/boards").status_code == 401
    assert client.post("/api/boards", json={"name": "X"}).status_code == 401
    assert client.get("/api/boards/board-1").status_code == 401
    assert client.post("/api/boards/board-1/cards", json={"columnId": "c", "title": "A"}).status_code == 401


def test_first_listing_creates_default_board(tmp_path: Path, app: FastAPI) -> None:
    client = client_for(app)
    boards = client.get("/api/boards").json()
    assert [(item["name"], item["cardCount"]) for item in boards] == [("My board", 0)]
    board = first_board(client)
    assert board["name"] == "My board"
    assert column_ids(board) == DEFAULT_IDS
    assert board["cards"] == {}
    assert client.get("/api/boards").json() == boards


def test_create_rename_and_delete_boards(app: FastAPI) -> None:
    client = client_for(app)
    original = first_board(client)
    created = client.post("/api/boards", json={"name": "  Launch plan  "})
    assert created.status_code == 201
    launch = created.json()
    assert launch["name"] == "Launch plan"
    assert column_ids(launch) == DEFAULT_IDS
    add_card(client, launch["id"], "Only on launch")

    listing = client.get("/api/boards").json()
    assert [(item["name"], item["cardCount"]) for item in listing] == [
        ("My board", 0), ("Launch plan", 1)
    ]
    assert first_board(client)["cards"] == {}

    renamed = client.patch(f"/api/boards/{launch['id']}", json={"name": "Launch v2"})
    assert renamed.json()["name"] == "Launch v2"
    assert client.patch(f"/api/boards/{launch['id']}", json={"name": " "}).status_code == 422
    assert client.post("/api/boards", json={"name": "x" * 101}).status_code == 422

    remaining = client.delete(f"/api/boards/{launch['id']}").json()
    assert [item["id"] for item in remaining] == [original["id"]]
    assert client.get(f"/api/boards/{launch['id']}").status_code == 404
    last = client.delete(f"/api/boards/{original['id']}")
    assert last.status_code == 422
    assert last.json() == {"detail": "You must keep at least one board"}


def test_users_cannot_see_or_change_other_boards(app: FastAPI) -> None:
    owner = client_for(app)
    board = first_board(owner)
    card, board = add_card(owner, board["id"], "Private")
    other = client_for(app, "intruder")
    board_id = board["id"]

    assert board_id not in [item["id"] for item in other.get("/api/boards").json()]
    responses = [
        other.get(f"/api/boards/{board_id}"),
        other.patch(f"/api/boards/{board_id}", json={"name": "Mine"}),
        other.delete(f"/api/boards/{board_id}"),
        other.post(f"/api/boards/{board_id}/columns", json={"title": "X"}),
        other.patch(f"/api/boards/{board_id}/columns/col-backlog", json={"title": "X"}),
        other.post(f"/api/boards/{board_id}/cards", json={"columnId": "col-backlog", "title": "X"}),
        other.patch(f"/api/boards/{board_id}/cards/{card}", json={"title": "X"}),
        other.delete(f"/api/boards/{board_id}/cards/{card}"),
        other.post(f"/api/boards/{board_id}/cards/{card}/move", json={"toColumnId": "col-done", "toIndex": 0}),
    ]
    assert {response.status_code for response in responses} == {404}

    other_board = first_board(other)
    assert other.patch(
        f"/api/boards/{other_board['id']}/cards/{card}", json={"title": "X"}
    ).status_code == 404
    assert owner.get(f"/api/boards/{board_id}").json() == board


def test_card_fields_persist_and_edit_partially(tmp_path: Path, app: FastAPI) -> None:
    client = client_for(app)
    board_id = first_board(client)["id"]
    card, board = add_card(
        client, board_id, "Plan", details="Notes", priority="high",
        dueDate="2026-12-01", labels=["Design", " ux ", "design"],
    )
    assert board["cards"][card] == {
        "id": card, "title": "Plan", "details": "Notes", "priority": "high",
        "dueDate": "2026-12-01", "labels": ["Design", "ux"], "assigneeId": None, "commentCount": 0, "checklist": [],
    }
    plain, board = add_card(client, board_id, "Plain")
    assert board["cards"][plain]["priority"] == "medium"
    assert board["cards"][plain]["dueDate"] is None

    edited = client.patch(f"/api/boards/{board_id}/cards/{card}", json={"priority": "low"}).json()
    assert edited["cards"][card]["priority"] == "low"
    assert edited["cards"][card]["title"] == "Plan"
    assert edited["cards"][card]["labels"] == ["Design", "ux"]

    cleared = client.patch(
        f"/api/boards/{board_id}/cards/{card}",
        json={"dueDate": None, "labels": [], "title": " Renamed ", "details": "New"},
    ).json()
    assert cleared["cards"][card] == {
        "id": card, "title": "Renamed", "details": "New", "priority": "low",
        "dueDate": None, "labels": [], "assigneeId": None, "commentCount": 0, "checklist": [],
    }
    assert client.patch(f"/api/boards/{board_id}/cards/{card}", json={}).json() == cleared

    restarted = client_for(create_app(tmp_path, tmp_path / "data"))
    assert restarted.get(f"/api/boards/{board_id}").json() == cleared


def test_card_moves_reorder_within_and_across_columns(app: FastAPI) -> None:
    client = client_for(app)
    board_id = first_board(client)["id"]
    first, _ = add_card(client, board_id, "First")
    second, _ = add_card(client, board_id, "Second")
    third, _ = add_card(client, board_id, "Third")

    def move(card: str, column: str, index: int) -> dict:
        response = client.post(
            f"/api/boards/{board_id}/cards/{card}/move", json={"toColumnId": column, "toIndex": index}
        )
        assert response.status_code == 200
        return response.json()

    assert move(third, "col-backlog", 0)["columns"][0]["cardIds"] == [third, first, second]
    board = move(third, "col-done", 0)
    assert board["columns"][0]["cardIds"] == [first, second]
    assert board["columns"][4]["cardIds"] == [third]
    board = move(first, "col-done", 1)
    assert board["columns"][4]["cardIds"] == [third, first]
    deleted = client.delete(f"/api/boards/{board_id}/cards/{third}").json()
    assert deleted["columns"][4]["cardIds"] == [first]
    assert third not in deleted["cards"]
    assert client.get(f"/api/boards/{board_id}").json() == deleted


def test_columns_can_be_added_renamed_moved_and_deleted(app: FastAPI) -> None:
    client = client_for(app)
    board_id = first_board(client)["id"]
    card, _ = add_card(client, board_id, "In review", column_id="col-review")

    board = client.post(f"/api/boards/{board_id}/columns", json={"title": "Blocked"}).json()
    blocked = board["columns"][-1]["id"]
    assert blocked.startswith("col-") and blocked not in DEFAULT_IDS
    assert board["columns"][-1] == {"id": blocked, "title": "Blocked", "cardIds": []}

    board = client.post(
        f"/api/boards/{board_id}/columns/{blocked}/move", json={"toIndex": 1}
    ).json()
    assert column_ids(board) == ["col-backlog", blocked, *DEFAULT_IDS[1:]]
    board = client.post(
        f"/api/boards/{board_id}/columns/col-backlog/move", json={"toIndex": 5}
    ).json()
    assert column_ids(board)[-1] == "col-backlog"

    board = client.patch(f"/api/boards/{board_id}/columns/{blocked}", json={"title": "Waiting"}).json()
    assert board["columns"][0]["title"] == "Waiting"

    board = client.delete(f"/api/boards/{board_id}/columns/col-review").json()
    assert "col-review" not in column_ids(board)
    assert card not in board["cards"]
    assert column_ids(client.get(f"/api/boards/{board_id}").json()) == column_ids(board)


def test_column_limits(app: FastAPI) -> None:
    client = client_for(app)
    board_id = first_board(client)["id"]
    for index in range(7):
        assert client.post(f"/api/boards/{board_id}/columns", json={"title": f"C{index}"}).status_code == 200
    too_many = client.post(f"/api/boards/{board_id}/columns", json={"title": "Extra"})
    assert too_many.status_code == 422
    assert too_many.json() == {"detail": "A board can have at most 12 columns"}

    board = client.get(f"/api/boards/{board_id}").json()
    for column in column_ids(board)[:-1]:
        assert client.delete(f"/api/boards/{board_id}/columns/{column}").status_code == 200
    last = column_ids(client.get(f"/api/boards/{board_id}").json())[0]
    response = client.delete(f"/api/boards/{board_id}/columns/{last}")
    assert response.status_code == 422
    assert response.json() == {"detail": "A board must have at least one column"}


def test_rejects_invalid_inputs_without_changing_board(app: FastAPI) -> None:
    client = client_for(app)
    board_id = first_board(client)["id"]
    card, original = add_card(client, board_id, "First")
    base = f"/api/boards/{board_id}"
    cases = [
        (client.patch(f"{base}/columns/col-backlog", json={"title": "  "}), 422),
        (client.patch(f"{base}/columns/missing", json={"title": "Ideas"}), 404),
        (client.delete(f"{base}/columns/missing"), 404),
        (client.post(f"{base}/columns/missing/move", json={"toIndex": 0}), 404),
        (client.post(f"{base}/columns/col-done/move", json={"toIndex": 5}), 422),
        (client.post(f"{base}/columns", json={"title": " "}), 422),
        (client.post(f"{base}/cards", json={"columnId": "missing", "title": "Second"}), 404),
        (client.post(f"{base}/cards", json={"columnId": "col-backlog", "title": " "}), 422),
        (client.post(f"{base}/cards", json={"columnId": "col-backlog", "title": "X", "priority": "urgent"}), 422),
        (client.post(f"{base}/cards", json={"columnId": "col-backlog", "title": "X", "dueDate": "2026-02-30"}), 422),
        (client.post(f"{base}/cards", json={"columnId": "col-backlog", "title": "X", "dueDate": "20260201"}), 422),
        (client.post(f"{base}/cards", json={"columnId": "col-backlog", "title": "X", "labels": [" "]}), 422),
        (client.post(f"{base}/cards", json={"columnId": "col-backlog", "title": "X", "labels": ["x" * 31]}), 422),
        (client.post(f"{base}/cards", json={"columnId": "col-backlog", "title": "X", "labels": [str(i) for i in range(11)]}), 422),
        (client.post(f"{base}/cards", json={"columnId": "col-backlog", "title": "x" * 201}), 422),
        (client.post(f"{base}/cards", json={"columnId": "col-backlog", "title": "X", "details": "x" * 2001}), 422),
        (client.patch(f"{base}/cards/{card}", json={"title": ""}), 422),
        (client.patch(f"{base}/cards/{card}", json={"title": None}), 422),
        (client.patch(f"{base}/cards/{card}", json={"labels": None}), 422),
        (client.patch(f"{base}/cards/missing", json={"title": "X"}), 404),
        (client.delete(f"{base}/cards/missing"), 404),
        (client.post(f"{base}/cards/{card}/move", json={"toColumnId": "missing", "toIndex": 0}), 404),
        (client.post(f"{base}/cards/{card}/move", json={"toColumnId": "col-done", "toIndex": 2}), 422),
        (client.post(f"{base}/cards/{card}/move", json={"toColumnId": "col-done", "toIndex": -1}), 422),
    ]
    assert [response.status_code for response, _ in cases] == [status for _, status in cases]
    assert client.get(base).json() == original


def test_accepts_values_at_the_limits(app: FastAPI) -> None:
    client = client_for(app)
    board_id = first_board(client)["id"]
    response = client.post(f"/api/boards/{board_id}/cards", json={
        "columnId": "col-backlog", "title": "x" * 200, "details": "x" * 2000,
        "labels": ["y" * 30] + [str(i) for i in range(9)],
    })
    assert response.status_code == 200
    assert client.post("/api/boards", json={"name": "n" * 100}).status_code == 201


def test_failed_operation_rolls_back(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    app = create_app(tmp_path, tmp_path / "data")
    client = client_for(app)
    board_id = first_board(client)["id"]
    card, original = add_card(client, board_id, "First")
    store: BoardStore = app.state.boards
    set_positions = store._set_positions

    def fail_after_update(*args) -> None:
        set_positions(*args)
        raise RuntimeError("Simulated failure")

    monkeypatch.setattr(store, "_set_positions", fail_after_update)
    user_id = client.get("/api/session").json()["id"]
    with pytest.raises(RuntimeError, match="Simulated failure"):
        store.apply_operations(user_id, board_id, [
            {"type": "rename_column", "columnId": "col-backlog", "title": "Changed"},
            {"type": "move_card", "cardId": card, "toColumnId": "col-done", "toIndex": 0},
        ])
    monkeypatch.undo()
    assert client.get(f"/api/boards/{board_id}").json() == original


def test_unknown_operation_is_rejected(app: FastAPI) -> None:
    from app.board import BoardError

    client = client_for(app)
    board_id = first_board(client)["id"]
    user_id = client.get("/api/session").json()["id"]
    with pytest.raises(BoardError, match="Unknown board operation"):
        app.state.boards.apply_operations(user_id, board_id, [{"type": "change_owner"}])


def test_rejects_unknown_schema_version(tmp_path: Path) -> None:
    path = tmp_path / "board.sqlite3"
    with closing(sqlite3.connect(path)) as db:
        db.execute("PRAGMA user_version = 99")
    with pytest.raises(RuntimeError, match="Unsupported board database version"):
        Database(path)


def test_creates_missing_database(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "board.sqlite3"
    Database(path)
    with closing(sqlite3.connect(path)) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 6
