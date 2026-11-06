import json
import sqlite3
from contextlib import closing
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.board import ACTIVITY_LIMIT
from app.main import create_app
from app.openrouter import OpenRouterClient
from tests.helpers import add_card, client_for, first_board


def comments_path(board_id: str, card: str) -> str:
    return f"/api/boards/{board_id}/cards/{card}/comments"


def summaries(client: TestClient, board_id: str, **params) -> list[str]:
    return [
        f'{item["username"]} {item["summary"]}'
        for item in client.get(f"/api/boards/{board_id}/activity", params=params).json()
    ]


def shared_board(app: FastAPI) -> tuple[TestClient, TestClient, str]:
    owner = client_for(app)
    viewer = client_for(app, "viewer")
    board_id = first_board(owner)["id"]
    owner.post(f"/api/boards/{board_id}/members", json={"username": "viewer", "role": "viewer"})
    return owner, viewer, board_id


def test_board_changes_are_recorded_newest_first(app: FastAPI) -> None:
    client = client_for(app)
    board_id = first_board(client)["id"]
    base = f"/api/boards/{board_id}"
    card, _ = add_card(client, board_id, "Plan")
    client.patch(f"{base}/cards/{card}", json={"title": "Plan v2"})
    client.post(f"{base}/cards/{card}/move", json={"toColumnId": "col-done", "toIndex": 0})
    client.post(f"{base}/cards/{card}/move", json={"toColumnId": "col-done", "toIndex": 0})
    board = client.post(f"{base}/columns", json={"title": "Blocked"}).json()
    blocked = board["columns"][-1]["id"]
    client.patch(f"{base}/columns/{blocked}", json={"title": "Waiting"})
    client.post(f"{base}/columns/{blocked}/move", json={"toIndex": 0})
    client.delete(f"{base}/cards/{card}")
    client.delete(f"{base}/columns/{blocked}")
    client.patch(base, json={"name": "Renamed"})

    assert summaries(client, board_id) == [
        'user renamed the board to "Renamed"',
        'user deleted column "Waiting" and 0 card(s)',
        'user deleted card "Plan v2"',
        'user moved column "Waiting" to position 1',
        'user renamed column "Blocked" to "Waiting"',
        'user added column "Blocked"',
        'user reordered card "Plan v2" in Done',
        'user moved card "Plan v2" to Done',
        'user edited card "Plan v2"',
        'user added card "Plan" to Backlog',
    ]
    card_history = client.get(f"{base}/activity", params={"card_id": card}).json()
    assert [item["action"] for item in card_history] == [
        "delete_card", "move_card", "move_card", "edit_card", "add_card"
    ]
    assert all(item["source"] == "user" and item["cardId"] == card for item in card_history)


def test_new_boards_and_sharing_are_recorded(app: FastAPI) -> None:
    owner, viewer, board_id = shared_board(app)
    created = owner.post("/api/boards", json={"name": "Launch"}).json()
    assert summaries(owner, created["id"]) == ["user created the board"]

    owner.post(f"/api/boards/{board_id}/members", json={"username": "viewer", "role": "editor"})
    viewer.post(f"/api/boards/{board_id}/leave")
    client_for(app, "third")
    owner.post(f"/api/boards/{board_id}/members", json={"username": "third", "role": "viewer"})
    third_id = client_for(app, "third").get("/api/session").json()["id"]
    owner.delete(f"/api/boards/{board_id}/members/{third_id}")
    assert summaries(owner, board_id) == [
        "user removed third from the board",
        "user gave third viewer access",
        "viewer left the board",
        "user gave viewer editor access",
        "user gave viewer viewer access",
    ]


def test_activity_is_limited_and_private(app: FastAPI) -> None:
    owner, viewer, board_id = shared_board(app)
    for index in range(ACTIVITY_LIMIT + 5):
        owner.patch(f"/api/boards/{board_id}/columns/col-backlog", json={"title": f"T{index}"})
    entries = viewer.get(f"/api/boards/{board_id}/activity").json()
    assert len(entries) == ACTIVITY_LIMIT
    assert entries[0]["summary"].endswith(f'"T{ACTIVITY_LIMIT + 4}"')
    assert client_for(app, "stranger").get(f"/api/boards/{board_id}/activity").status_code == 404


def test_members_comment_and_delete_permissions(app: FastAPI) -> None:
    owner, viewer, board_id = shared_board(app)
    card, _ = add_card(owner, board_id, "Discuss")
    path = comments_path(board_id, card)

    assert owner.get(path).json() == []
    created = viewer.post(path, json={"body": "  Looks good  "})
    assert created.status_code == 201
    first = created.json()[0]
    assert (first["username"], first["body"]) == ("viewer", "Looks good")
    thread = owner.post(path, json={"body": "Thanks"}).json()
    assert [item["body"] for item in thread] == ["Looks good", "Thanks"]
    assert owner.get(f"/api/boards/{board_id}").json()["cards"][card]["commentCount"] == 2
    assert summaries(owner, board_id)[0] == 'user commented on "Discuss"'

    owner_comment = thread[1]["id"]
    denied = viewer.delete(f"{path}/{owner_comment}")
    assert denied.status_code == 403
    assert denied.json() == {"detail": "You can only delete your own comments"}
    assert [item["body"] for item in viewer.delete(f"{path}/{first['id']}").json()] == ["Thanks"]
    second = viewer.post(path, json={"body": "Again"}).json()[-1]["id"]
    assert [item["body"] for item in owner.delete(f"{path}/{second}").json()] == ["Thanks"]

    assert owner.delete(f"{path}/missing").status_code == 404
    assert owner.post(path, json={"body": "  "}).status_code == 422
    assert owner.post(path, json={"body": "x" * 2001}).status_code == 422
    assert owner.get(comments_path(board_id, "missing")).status_code == 404
    stranger = client_for(app, "stranger")
    assert stranger.get(path).status_code == 404
    assert stranger.post(path, json={"body": "Hi"}).status_code == 404


def test_history_outlives_cards_and_accounts(app: FastAPI) -> None:
    owner, _, board_id = shared_board(app)
    editor = client_for(app, "editor")
    owner.post(f"/api/boards/{board_id}/members", json={"username": "editor", "role": "editor"})
    card, _ = add_card(editor, board_id, "Temporary")
    editor.post(comments_path(board_id, card), json={"body": "Mine"})
    other, _ = add_card(owner, board_id, "Keeps comments")
    editor.post(comments_path(board_id, other), json={"body": "Still here"})

    owner.delete(f"/api/boards/{board_id}/cards/{card}")
    editor.request("DELETE", "/api/account", json={"password": "password123"})

    entries = owner.get(f"/api/boards/{board_id}/activity").json()
    assert entries[0]["summary"] == 'deleted card "Temporary"'
    assert any(item["username"] is None and item["action"] == "add_card" for item in entries)
    remaining = owner.get(comments_path(board_id, other)).json()
    assert [(item["username"], item["body"]) for item in remaining] == [(None, "Still here")]
    with app.state.users.database.transaction() as db:
        assert db.execute("SELECT count(*) FROM card_comments WHERE card_id = ?", (card,)).fetchone()[0] == 0


def test_ai_changes_are_attributed_to_the_assistant(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    plan = {"text": "Done.", "operations": [{
        "type": "add_card", "columnId": "col-backlog", "title": "From AI", "details": "",
        "priority": "medium", "dueDate": None, "labels": [], "assigneeId": None,
    }]}
    app.state.openrouter = OpenRouterClient(httpx.MockTransport(
        lambda _: httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(plan)}}]})
    ))
    client = client_for(app)
    board_id = first_board(client)["id"]
    assert client.post(f"/api/boards/{board_id}/ai/chat", json={"message": "Add"}).status_code == 200
    entry = client.get(f"/api/boards/{board_id}/activity").json()[0]
    assert (entry["source"], entry["username"], entry["summary"]) == (
        "ai", "user", 'added card "From AI" to Backlog'
    )


def test_migrates_version_three_database(tmp_path: Path) -> None:
    app = create_app(tmp_path, tmp_path / "data")
    client = client_for(app)
    board_id = first_board(client)["id"]
    card, _ = add_card(client, board_id, "Survivor")
    path = tmp_path / "data" / "board.sqlite3"
    with closing(sqlite3.connect(path)) as db:
        db.executescript("""
            DROP TABLE card_comments; DROP TABLE activity; DROP TABLE checklist_items;
            ALTER TABLE cards DROP COLUMN archived_at;
            PRAGMA user_version = 3;
        """)

    migrated = client_for(create_app(tmp_path, tmp_path / "data"))
    assert migrated.get(f"/api/boards/{board_id}").json()["cards"][card]["commentCount"] == 0
    assert migrated.get(f"/api/boards/{board_id}/activity").json() == []
    assert migrated.post(comments_path(board_id, card), json={"body": "Works"}).status_code == 201
    with closing(sqlite3.connect(path)) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 6
