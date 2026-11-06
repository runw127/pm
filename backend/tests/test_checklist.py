import json
import sqlite3
from contextlib import closing
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.board import CHECKLIST_MAX_ITEMS
from app.main import create_app
from app.openrouter import OpenRouterClient
from tests.helpers import add_card, client_for, first_board


def checklist_path(board_id: str, card: str, item: str = "") -> str:
    return f"/api/boards/{board_id}/cards/{card}/checklist" + (f"/{item}" if item else "")


def checklist(response: httpx.Response, card: str) -> list[dict]:
    assert response.status_code == 200, response.text
    return response.json()["cards"][card]["checklist"]


def setup(app: FastAPI) -> tuple[TestClient, str, str]:
    client = client_for(app)
    board_id = first_board(client)["id"]
    card, _ = add_card(client, board_id, "Release")
    return client, board_id, card


def test_items_are_added_toggled_renamed_and_removed(app: FastAPI) -> None:
    client, board_id, card = setup(app)
    path = checklist_path(board_id, card)

    assert client.get(f"/api/boards/{board_id}").json()["cards"][card]["checklist"] == []
    client.post(path, json={"text": "  Write notes  "})
    items = checklist(client.post(path, json={"text": "Tag build"}), card)
    assert [(item["text"], item["done"]) for item in items] == [("Write notes", False), ("Tag build", False)]
    first, second = (item["id"] for item in items)

    items = checklist(client.patch(checklist_path(board_id, card, first), json={"done": True}), card)
    assert [item["done"] for item in items] == [True, False]
    items = checklist(client.patch(checklist_path(board_id, card, first), json={"text": "Publish notes"}), card)
    assert items[0] == {"id": first, "text": "Publish notes", "done": True}
    client.patch(checklist_path(board_id, card, first), json={"done": False})
    items = checklist(client.delete(checklist_path(board_id, card, second)), card)
    assert [item["id"] for item in items] == [first]

    history = client.get(f"/api/boards/{board_id}/activity", params={"card_id": card}).json()
    assert [entry["summary"] for entry in history[:6]] == [
        'removed "Tag build" from the checklist on "Release"',
        'unchecked "Publish notes" on "Release"',
        'renamed checklist item "Write notes" to "Publish notes" on "Release"',
        'checked "Write notes" on "Release"',
        'added "Tag build" to the checklist on "Release"',
        'added "Write notes" to the checklist on "Release"',
    ]


def test_checklist_validation_and_limits(app: FastAPI) -> None:
    client, board_id, card = setup(app)
    path = checklist_path(board_id, card)
    assert client.post(path, json={"text": "  "}).status_code == 422
    assert client.post(path, json={"text": "x" * 201}).status_code == 422
    assert client.post(checklist_path(board_id, "missing"), json={"text": "A"}).status_code == 404
    assert client.patch(checklist_path(board_id, card, "missing"), json={"done": True}).status_code == 404
    assert client.delete(checklist_path(board_id, card, "missing")).status_code == 404

    for index in range(CHECKLIST_MAX_ITEMS):
        client.post(path, json={"text": f"Step {index}"})
    full = client.post(path, json={"text": "One more"})
    assert full.status_code == 422
    assert full.json() == {"detail": f"A checklist can have at most {CHECKLIST_MAX_ITEMS} items"}

    item = client.get(f"/api/boards/{board_id}").json()["cards"][card]["checklist"][0]["id"]
    assert client.patch(checklist_path(board_id, card, item), json={"text": " "}).status_code == 422
    other, _ = add_card(client, board_id, "Other")
    assert client.patch(checklist_path(board_id, other, item), json={"done": True}).status_code == 404


def test_viewers_cannot_change_checklists_and_strangers_cannot_see_them(app: FastAPI) -> None:
    client, board_id, card = setup(app)
    item = checklist(client.post(checklist_path(board_id, card), json={"text": "Check"}), card)[0]["id"]
    viewer = client_for(app, "viewer")
    client.post(f"/api/boards/{board_id}/members", json={"username": "viewer", "role": "viewer"})

    assert viewer.get(f"/api/boards/{board_id}").json()["cards"][card]["checklist"][0]["text"] == "Check"
    assert viewer.post(checklist_path(board_id, card), json={"text": "No"}).status_code == 403
    assert viewer.patch(checklist_path(board_id, card, item), json={"done": True}).status_code == 403
    assert viewer.delete(checklist_path(board_id, card, item)).status_code == 403
    stranger = client_for(app, "stranger")
    assert stranger.patch(checklist_path(board_id, card, item), json={"done": True}).status_code == 404


def test_deleting_a_card_deletes_its_checklist(app: FastAPI) -> None:
    client, board_id, card = setup(app)
    client.post(checklist_path(board_id, card), json={"text": "Gone soon"})
    client.delete(f"/api/boards/{board_id}/cards/{card}")
    with app.state.users.database.transaction() as db:
        assert db.execute("SELECT count(*) FROM checklist_items").fetchone()[0] == 0


def test_ai_can_manage_checklists(app: FastAPI, monkeypatch: pytest.MonkeyPatch) -> None:
    client, board_id, card = setup(app)
    item = checklist(client.post(checklist_path(board_id, card), json={"text": "Draft"}), card)[0]["id"]
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    plan = {"text": "Updated the checklist.", "operations": [
        {"type": "edit_checklist_item", "cardId": card, "itemId": item, "text": "Draft", "done": True},
        {"type": "add_checklist_item", "cardId": card, "text": "Review"},
    ]}
    app.state.openrouter = OpenRouterClient(httpx.MockTransport(
        lambda _: httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(plan)}}]})
    ))
    response = client.post(f"/api/boards/{board_id}/ai/chat", json={"message": "Tick draft, add review"})
    items = response.json()["board"]["cards"][card]["checklist"]
    assert [(entry["text"], entry["done"]) for entry in items] == [("Draft", True), ("Review", False)]
    assert client.get(f"/api/boards/{board_id}/activity").json()[0]["source"] == "ai"

    plan["operations"] = [{"type": "delete_checklist_item", "cardId": card, "itemId": "missing"}]
    rejected = client.post(f"/api/boards/{board_id}/ai/chat", json={"message": "Remove it"})
    assert rejected.status_code == 502
    assert len(client.get(f"/api/boards/{board_id}").json()["cards"][card]["checklist"]) == 2


def test_migrates_version_four_database(tmp_path: Path) -> None:
    client = client_for(create_app(tmp_path, tmp_path / "data"))
    board_id = first_board(client)["id"]
    card, _ = add_card(client, board_id, "Survivor")
    path = tmp_path / "data" / "board.sqlite3"
    with closing(sqlite3.connect(path)) as db:
        db.executescript("DROP TABLE checklist_items; ALTER TABLE cards DROP COLUMN archived_at; PRAGMA user_version = 4;")

    migrated = client_for(create_app(tmp_path, tmp_path / "data"))
    assert migrated.get(f"/api/boards/{board_id}").json()["cards"][card]["checklist"] == []
    assert len(checklist(migrated.post(checklist_path(board_id, card), json={"text": "Works"}), card)) == 1
    with closing(sqlite3.connect(path)) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 6
