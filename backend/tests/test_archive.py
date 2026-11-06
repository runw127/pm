import json
import sqlite3
from contextlib import closing
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import create_app
from app.openrouter import OpenRouterClient
from tests.helpers import add_card, client_for, first_board


def column_ids(board: dict, column: str = "col-backlog") -> list[str]:
    return next(item["cardIds"] for item in board["columns"] if item["id"] == column)


def setup(app: FastAPI) -> tuple[TestClient, str, list[str]]:
    client = client_for(app)
    board_id = first_board(client)["id"]
    cards = [add_card(client, board_id, title)[0] for title in ("One", "Two", "Three")]
    return client, board_id, cards


def test_archived_cards_leave_the_board_and_can_be_restored(app: FastAPI) -> None:
    client, board_id, (one, two, three) = setup(app)
    base = f"/api/boards/{board_id}"

    board = client.post(f"{base}/cards/{two}/archive").json()
    assert column_ids(board) == [one, three]
    assert two not in board["cards"]
    assert client.get("/api/boards").json()[0]["cardCount"] == 2
    archive = client.get(f"{base}/archive").json()
    assert [(item["id"], item["title"], item["column"]) for item in archive] == [(two, "Two", "Backlog")]
    assert archive[0]["archivedAt"]

    client.post(f"{base}/cards/{one}/archive")
    assert [item["title"] for item in client.get(f"{base}/archive").json()] == ["One", "Two"]

    board = client.post(f"{base}/cards/{two}/restore").json()
    assert column_ids(board) == [three, two]
    assert board["cards"][two]["title"] == "Two"
    assert [item["title"] for item in client.get(f"{base}/archive").json()] == ["One"]

    board = client.delete(f"{base}/cards/{one}").json()
    assert client.get(f"{base}/archive").json() == []
    assert column_ids(board) == [three, two]

    history = [entry["summary"] for entry in client.get(f"{base}/activity").json()[:4]]
    assert history == [
        'deleted card "One"', 'restored card "Two" to Backlog', 'archived card "One"', 'archived card "Two"',
    ]


def test_archived_cards_cannot_be_changed_until_restored(app: FastAPI) -> None:
    client, board_id, (one, two, _) = setup(app)
    base = f"/api/boards/{board_id}"
    client.post(f"{base}/cards/{one}/archive")

    blocked = [
        client.patch(f"{base}/cards/{one}", json={"title": "X"}),
        client.post(f"{base}/cards/{one}/move", json={"toColumnId": "col-done", "toIndex": 0}),
        client.post(f"{base}/cards/{one}/archive"),
        client.post(f"{base}/cards/{one}/checklist", json={"text": "X"}),
        client.get(f"{base}/cards/{one}/comments"),
        client.post(f"{base}/cards/{two}/restore"),
        client.post(f"{base}/cards/missing/restore"),
    ]
    assert {response.status_code for response in blocked} == {404}


def test_archive_permissions_and_my_work(app: FastAPI) -> None:
    owner = client_for(app, "owner")
    viewer = client_for(app, "viewer")
    board_id = first_board(owner)["id"]
    owner.post(f"/api/boards/{board_id}/members", json={"username": "viewer", "role": "viewer"})
    me = owner.get("/api/session").json()["id"]
    card, _ = add_card(owner, board_id, "Assigned", assigneeId=me)
    base = f"/api/boards/{board_id}"

    assert viewer.post(f"{base}/cards/{card}/archive").status_code == 403
    owner.post(f"{base}/cards/{card}/archive")
    assert owner.get("/api/my-work").json() == []
    assert [item["id"] for item in viewer.get(f"{base}/archive").json()] == [card]
    assert viewer.post(f"{base}/cards/{card}/restore").status_code == 403
    assert client_for(app, "stranger").get(f"{base}/archive").status_code == 404


def test_deleting_a_column_removes_its_archived_cards(app: FastAPI) -> None:
    client, board_id, (one, _, _) = setup(app)
    base = f"/api/boards/{board_id}"
    client.post(f"{base}/cards/{one}/archive")
    response = client.delete(f"{base}/columns/col-backlog")
    assert response.status_code == 200
    assert client.get(f"{base}/archive").json() == []
    assert client.get(f"{base}/activity").json()[0]["summary"] == 'deleted column "Backlog" and 3 card(s)'


def test_ai_archives_cards(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> None:
    client, board_id, (one, _, _) = setup(app)
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    plan = {"text": "Archived it.", "operations": [{"type": "archive_card", "cardId": one}]}
    app.state.openrouter = OpenRouterClient(httpx.MockTransport(
        lambda _: httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(plan)}}]})
    ))
    board = client.post(f"/api/boards/{board_id}/ai/chat", json={"message": "Archive One"}).json()["board"]
    assert one not in board["cards"]
    assert client.get(f"/api/boards/{board_id}/archive").json()[0]["id"] == one


def test_migrates_version_five_database(tmp_path: Path) -> None:
    client = client_for(create_app(tmp_path, tmp_path / "data"))
    board_id = first_board(client)["id"]
    card, _ = add_card(client, board_id, "Survivor")
    path = tmp_path / "data" / "board.sqlite3"
    with closing(sqlite3.connect(path)) as db:
        db.executescript("ALTER TABLE cards DROP COLUMN archived_at; PRAGMA user_version = 5;")

    migrated = client_for(create_app(tmp_path, tmp_path / "data"))
    assert card in migrated.get(f"/api/boards/{board_id}").json()["cards"]
    assert migrated.post(f"/api/boards/{board_id}/cards/{card}/archive").status_code == 200
    with closing(sqlite3.connect(path)) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 6
