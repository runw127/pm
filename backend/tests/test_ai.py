import json
import os
from datetime import date

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.openrouter import MODEL, OPENROUTER_URL, OpenRouterClient
from tests.helpers import add_card, card_id, client_for, first_board


@pytest.fixture(autouse=True)
def api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    if os.getenv("OPENROUTER_LIVE_TEST") != "1":
        monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")


def replying(app: FastAPI, response: dict | str) -> list[dict]:
    """Make the mocked model return `response`; return the captured request payloads."""
    requests = []

    def respond(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == OPENROUTER_URL
        requests.append(json.loads(request.content))
        content = response if isinstance(response, str) else json.dumps(response)
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    app.state.openrouter = OpenRouterClient(httpx.MockTransport(respond))
    return requests


def card_fields(**overrides) -> dict:
    return {"details": "", "priority": "medium", "dueDate": None, "labels": [], "assigneeId": None, **overrides}


def chat(client: TestClient, board_id: str, message: str = "Make a change", **body):
    return client.post(f"/api/boards/{board_id}/ai/chat", json={"message": message, **body})


def test_chat_requires_sign_in(app: FastAPI) -> None:
    assert TestClient(app).post("/api/boards/x/ai/chat", json={"message": "Hi"}).status_code == 401


def test_noop_reply_sends_board_message_and_bounded_history(app: FastAPI) -> None:
    requests = replying(app, {"text": "Here is your board.", "operations": []})
    client = client_for(app)
    board = first_board(client)
    history = [
        {"role": "user" if index % 2 == 0 else "assistant", "content": f"Turn {index}"}
        for index in range(12)
    ]
    response = chat(client, board["id"], "What is on my board?", history=history)

    assert response.status_code == 200
    assert response.json() == {"text": "Here is your board.", "board": board}
    payload = requests[0]
    assert payload["model"] == MODEL
    assert payload["provider"] == {"require_parameters": True}
    assert payload["response_format"]["json_schema"]["strict"] is True
    schema = payload["response_format"]["json_schema"]["schema"]
    kinds = [item["properties"]["type"]["const"] for item in schema["properties"]["operations"]["items"]["anyOf"]]
    assert kinds == [
        "add_column", "rename_column", "move_column", "add_card", "edit_card",
        "delete_card", "move_card", "archive_card", "add_checklist_item", "edit_checklist_item",
        "delete_checklist_item",
    ]
    assert payload["messages"][0]["role"] == "system"
    assert payload["messages"][1:-1] == history[-10:]
    assert json.loads(payload["messages"][-1]["content"]) == {
        "today": date.today().isoformat(), "board": board, "message": "What is on my board?"
    }


def test_one_operation_persists_with_card_fields(app: FastAPI) -> None:
    replying(app, {"text": "Added a task.", "operations": [{
        "type": "add_card", "columnId": "col-backlog", "title": "Write tests",
        **card_fields(details="Part 9", priority="high", dueDate="2026-12-24", labels=["qa"]),
    }]})
    client = client_for(app)
    board_id = first_board(client)["id"]
    response = chat(client, board_id, "Add a task")

    assert response.status_code == 200
    board = response.json()["board"]
    card = board["cards"][card_id(board, "Write tests")]
    assert card["priority"] == "high" and card["dueDate"] == "2026-12-24" and card["labels"] == ["qa"]
    assert client.get(f"/api/boards/{board_id}").json() == board


def test_multiple_operations_are_ordered_and_atomic(app: FastAPI) -> None:
    client = client_for(app)
    board_id = first_board(client)["id"]
    first, _ = add_card(client, board_id, "First", details="Old")
    second, _ = add_card(client, board_id, "Second")
    replying(app, {"text": "Updated the board.", "operations": [
        {"type": "rename_column", "columnId": "col-backlog", "title": "Ideas"},
        {"type": "edit_card", "cardId": first, "title": "Revised", **card_fields(details="New")},
        {"type": "move_card", "cardId": second, "toColumnId": "col-done", "toIndex": 0},
        {"type": "add_card", "columnId": "col-backlog", "title": "Third", **card_fields()},
        {"type": "delete_card", "cardId": first},
        {"type": "add_column", "title": "Blocked"},
        {"type": "move_column", "columnId": "col-done", "toIndex": 0},
    ]})
    response = chat(client, board_id, "Update several cards")

    assert response.status_code == 200
    board = response.json()["board"]
    assert [column["title"] for column in board["columns"]] == [
        "Done", "Ideas", "Discovery", "In Progress", "Review", "Blocked"
    ]
    assert [board["cards"][item]["title"] for item in board["columns"][1]["cardIds"]] == ["Third"]
    assert board["columns"][0]["cardIds"] == [second]
    assert first not in board["cards"]
    assert client.get(f"/api/boards/{board_id}").json() == board


def test_chat_targets_only_the_selected_board(app: FastAPI) -> None:
    replying(app, {"text": "Added.", "operations": [
        {"type": "add_card", "columnId": "col-backlog", "title": "Here", **card_fields()}
    ]})
    client = client_for(app)
    main = first_board(client)
    other = client.post("/api/boards", json={"name": "Other"}).json()
    assert chat(client, other["id"]).status_code == 200
    assert client.get(f"/api/boards/{main['id']}").json() == main
    assert len(client.get(f"/api/boards/{other['id']}").json()["cards"]) == 1


@pytest.mark.parametrize("content", [
    "not json",
    {"text": "Oops", "operations": [{"type": "change_owner", "username": "other"}]},
    {"text": "Oops", "operations": [{"type": "delete_column", "columnId": "col-backlog"}]},
    {"text": "Oops", "operations": [{"type": "add_card", "columnId": "col-backlog", "title": "No fields"}]},
    {"text": "Oops", "operations": [{"type": "add_card", "columnId": "col-backlog", "title": "X",
                                       **card_fields(priority="urgent")}]},
    {"text": "  ", "operations": []},
])
def test_malformed_model_output_does_not_change_board(app: FastAPI, content: dict | str) -> None:
    replying(app, content)
    client = client_for(app)
    before = first_board(client)
    assert chat(client, before["id"]).status_code == 502
    assert client.get(f"/api/boards/{before['id']}").json() == before


@pytest.mark.parametrize("invalid", [
    {"type": "edit_card", "cardId": "missing", "title": "X", **card_fields()},
    {"type": "rename_column", "columnId": "missing", "title": "X"},
    {"type": "add_card", "columnId": "col-backlog", "title": "  ", **card_fields()},
    {"type": "add_card", "columnId": "col-backlog", "title": "X", **card_fields(dueDate="soon")},
    {"type": "move_card", "cardId": "missing", "toColumnId": "col-done", "toIndex": 0},
    {"type": "move_column", "columnId": "col-done", "toIndex": 9},
])
def test_invalid_operation_rolls_back_prior_changes(app: FastAPI, invalid: dict) -> None:
    replying(app, {"text": "Changed the board.", "operations": [
        {"type": "add_card", "columnId": "col-backlog", "title": "Temporary", **card_fields()},
        invalid,
    ]})
    client = client_for(app)
    before = first_board(client)
    response = chat(client, before["id"])
    assert response.status_code == 502
    assert response.json() == {"detail": "AI proposed invalid board changes; no changes saved"}
    assert client.get(f"/api/boards/{before['id']}").json() == before


def test_foreign_board_and_card_cannot_be_changed(app: FastAPI) -> None:
    owner = client_for(app)
    owner_board = first_board(owner)
    foreign, owner_board = add_card(owner, owner_board["id"], "Private")
    replying(app, {"text": "Changed it.", "operations": [
        {"type": "edit_card", "cardId": foreign, "title": "Exposed", **card_fields()}
    ]})
    other = client_for(app, "second")
    assert chat(other, owner_board["id"]).status_code == 404
    assert chat(other, first_board(other)["id"]).status_code == 502
    assert owner.get(f"/api/boards/{owner_board['id']}").json() == owner_board


def test_upstream_failure_leaves_board_unchanged(app: FastAPI) -> None:
    app.state.openrouter = OpenRouterClient(httpx.MockTransport(
        lambda _: httpx.Response(429, text="private upstream text")
    ))
    client = client_for(app)
    before = first_board(client)
    response = chat(client, before["id"])
    assert response.status_code == 502
    assert response.json() == {"detail": "OpenRouter request failed (HTTP 429)"}
    assert client.get(f"/api/boards/{before['id']}").json() == before


def test_request_rejects_blank_or_excessive_input(app: FastAPI) -> None:
    requests = replying(app, {"text": "No change.", "operations": []})
    client = client_for(app)
    board_id = first_board(client)["id"]
    assert chat(client, board_id, "  ").status_code == 422
    assert chat(client, board_id, "x" * 2001).status_code == 422
    assert chat(client, board_id, history=[{"role": "user", "content": "x"}] * 21).status_code == 422
    assert chat(client, board_id, history=[{"role": "system", "content": "x"}]).status_code == 422
    assert len(requests) == 0


def test_chat_is_rate_limited_per_user(app: FastAPI) -> None:
    requests = replying(app, {"text": "No change.", "operations": []})
    client = client_for(app)
    board_id = first_board(client)["id"]
    for _ in range(10):
        assert chat(client, board_id).status_code == 200
    limited = chat(client, board_id)
    assert limited.status_code == 429
    assert limited.json() == {"detail": "Too many AI requests. Try again in a minute."}
    assert len(requests) == 10

    other = client_for(app, "other")
    assert chat(other, first_board(other)["id"]).status_code == 200

    user_id = client.get("/api/session").json()["id"]
    app.state.ai_calls[user_id] = [0.0] * 10
    assert chat(client, board_id).status_code == 200


def test_viewer_can_ask_but_not_change(app: FastAPI) -> None:
    owner = client_for(app)
    board = first_board(owner)
    viewer = client_for(app, "watcher")
    owner.post(f"/api/boards/{board['id']}/members", json={"username": "watcher", "role": "viewer"})

    requests = replying(app, {"text": "Nothing to change.", "operations": []})
    response = chat(viewer, board["id"], "Summarize")
    assert response.status_code == 200
    assert response.json()["board"]["role"] == "viewer"
    assert "view-only access" in requests[0]["messages"][0]["content"]

    replying(app, {"text": "Added.", "operations": [
        {"type": "add_card", "columnId": "col-backlog", "title": "Sneaky", **card_fields()}
    ]})
    blocked = chat(viewer, board["id"])
    assert blocked.status_code == 403
    assert owner.get(f"/api/boards/{board['id']}").json()["cards"] == {}


def test_ai_assigns_cards_to_members(app: FastAPI) -> None:
    owner = client_for(app)
    board_id = first_board(owner)["id"]
    client_for(app, "helper")
    shared = owner.post(f"/api/boards/{board_id}/members", json={"username": "helper", "role": "editor"}).json()
    helper_id = next(m["id"] for m in shared["members"] if m["username"] == "helper")
    requests = replying(app, {"text": "Assigned.", "operations": [
        {"type": "add_card", "columnId": "col-backlog", "title": "Helper task", **card_fields(assigneeId=helper_id)}
    ]})
    response = chat(owner, board_id, "Give helper a task")
    assert response.status_code == 200
    board = response.json()["board"]
    assert board["cards"][card_id(board, "Helper task")]["assigneeId"] == helper_id
    sent_board = json.loads(requests[0]["messages"][-1]["content"])["board"]
    assert [m["username"] for m in sent_board["members"]] == ["user", "helper"]


def test_live_structured_noop(app: FastAPI) -> None:
    if os.getenv("OPENROUTER_LIVE_TEST") != "1":
        pytest.skip("Set OPENROUTER_LIVE_TEST=1 to run the live check")
    app.state.openrouter = OpenRouterClient()
    client = client_for(app)
    before = first_board(client)
    response = chat(client, before["id"], "Say hello without changing any cards or columns.")
    assert response.status_code == 200, response.text
    assert response.json()["text"]
    assert response.json()["board"] == before


def test_live_adds_card_with_fields(app: FastAPI) -> None:
    if os.getenv("OPENROUTER_LIVE_TEST") != "1":
        pytest.skip("Set OPENROUTER_LIVE_TEST=1 to run the live check")
    app.state.openrouter = OpenRouterClient()
    client = client_for(app)
    board_id = first_board(client)["id"]
    response = chat(client, board_id, (
        "Add one card titled 'Live check' to the Backlog column with high priority, "
        "due date 2026-12-31, and the label qa."
    ))
    assert response.status_code == 200, response.text
    board = response.json()["board"]
    card = board["cards"][card_id(board, "Live check")]
    assert card["id"] in board["columns"][0]["cardIds"]
    assert (card["priority"], card["dueDate"], card["labels"]) == ("high", "2026-12-31", ["qa"])
