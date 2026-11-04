import json
import os
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.auth import SESSION_COOKIE
from app.main import create_app
from app.openrouter import MODEL, OPENROUTER_URL, OpenRouterClient


def signed_in_app(tmp_path: Path, response: dict | str) -> tuple[TestClient, list[dict]]:
    requests = []

    def respond(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == OPENROUTER_URL
        requests.append(json.loads(request.content))
        content = response if isinstance(response, str) else json.dumps(response)
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    app = create_app(tmp_path, tmp_path / "data")
    app.state.openrouter = OpenRouterClient(httpx.MockTransport(respond))
    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE, app.state.sessions.create("user"))
    return client, requests


def card_id(board: dict, title: str) -> str:
    return next(card_id for card_id, card in board["cards"].items() if card["title"] == title)


def test_chat_requires_sign_in(tmp_path: Path) -> None:
    client = TestClient(create_app(tmp_path, tmp_path / "data"))
    assert client.post("/api/ai/chat", json={"message": "Hello"}).status_code == 401


def test_noop_reply_sends_board_message_and_bounded_history(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    client, requests = signed_in_app(tmp_path, {"text": "Here is your board.", "operations": []})
    board = client.get("/api/board").json()
    history = [
        {"role": "user" if index % 2 == 0 else "assistant", "content": f"Turn {index}"}
        for index in range(12)
    ]
    response = client.post("/api/ai/chat", json={"message": "What is on my board?", "history": history})

    assert response.status_code == 200
    assert response.json() == {"text": "Here is your board.", "board": board}
    assert client.get("/api/board").json() == board
    payload = requests[0]
    assert payload["model"] == MODEL
    assert payload["provider"] == {"require_parameters": True}
    assert payload["response_format"]["type"] == "json_schema"
    assert payload["response_format"]["json_schema"]["strict"] is True
    schema = payload["response_format"]["json_schema"]["schema"]
    assert set(schema["properties"]) == {"text", "operations"}
    assert len(schema["properties"]["operations"]["items"]["anyOf"]) == 5
    assert payload["messages"][0]["role"] == "system"
    assert payload["messages"][1:-1] == history[-10:]
    assert json.loads(payload["messages"][-1]["content"]) == {
        "board": board, "message": "What is on my board?"
    }


def test_one_operation_persists(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    client, _ = signed_in_app(tmp_path, {
        "text": "Added a task.",
        "operations": [{"type": "add_card", "columnId": "col-backlog",
                        "title": "Write tests", "details": "Part 9"}],
    })
    response = client.post("/api/ai/chat", json={"message": "Add a task"})

    assert response.status_code == 200
    board = response.json()["board"]
    assert response.json()["text"] == "Added a task."
    assert board["cards"][card_id(board, "Write tests")]["details"] == "Part 9"
    assert client.get("/api/board").json() == board


def test_multiple_operations_are_ordered_and_atomic(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    client, _ = signed_in_app(tmp_path, {"text": "Updated the board.", "operations": []})
    first = client.post("/api/board/cards", json={
        "columnId": "col-backlog", "title": "First", "details": "Old"
    }).json()
    second = client.post("/api/board/cards", json={
        "columnId": "col-backlog", "title": "Second", "details": ""
    }).json()
    first_id, second_id = card_id(first, "First"), card_id(second, "Second")

    operations = [
        {"type": "rename_column", "columnId": "col-backlog", "title": "Ideas"},
        {"type": "edit_card", "cardId": first_id, "title": "Revised", "details": "New"},
        {"type": "move_card", "cardId": second_id, "toColumnId": "col-done", "toIndex": 0},
        {"type": "add_card", "columnId": "col-backlog", "title": "Third", "details": ""},
        {"type": "delete_card", "cardId": first_id},
    ]
    client.app.state.openrouter = OpenRouterClient(httpx.MockTransport(
        lambda _: httpx.Response(200, json={"choices": [{"message": {
            "content": json.dumps({"text": "Updated the board.", "operations": operations})
        }}]})
    ))
    response = client.post("/api/ai/chat", json={"message": "Update several cards"})

    assert response.status_code == 200
    board = response.json()["board"]
    assert board["columns"][0]["title"] == "Ideas"
    assert [board["cards"][item]["title"] for item in board["columns"][0]["cardIds"]] == ["Third"]
    assert board["columns"][4]["cardIds"] == [second_id]
    assert first_id not in board["cards"]
    assert client.get("/api/board").json() == board


@pytest.mark.parametrize("content", [
    "not json",
    {"text": "Oops", "operations": [{"type": "change_owner", "username": "other"}]},
    {"text": "Oops", "operations": [{"type": "add_card", "columnId": "col-backlog",
                                       "title": "Missing details"}]},
    {"text": "  ", "operations": []},
])
def test_malformed_model_output_does_not_change_board(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, content: dict | str
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    client, _ = signed_in_app(tmp_path, content)
    before = client.get("/api/board").json()
    response = client.post("/api/ai/chat", json={"message": "Make a change"})
    assert response.status_code == 502
    assert client.get("/api/board").json() == before


@pytest.mark.parametrize("invalid", [
    {"type": "edit_card", "cardId": "missing", "title": "X", "details": ""},
    {"type": "rename_column", "columnId": "missing", "title": "X"},
    {"type": "add_card", "columnId": "col-backlog", "title": "  ", "details": ""},
    {"type": "move_card", "cardId": "missing", "toColumnId": "col-done", "toIndex": 0},
])
def test_invalid_operation_rolls_back_prior_changes(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, invalid: dict
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    client, _ = signed_in_app(tmp_path, {
        "text": "Changed the board.",
        "operations": [
            {"type": "add_card", "columnId": "col-backlog", "title": "Temporary", "details": ""},
            invalid,
        ],
    })
    before = client.get("/api/board").json()
    response = client.post("/api/ai/chat", json={"message": "Make changes"})
    assert response.status_code == 502
    assert response.json() == {"detail": "AI proposed invalid board changes; no changes saved"}
    assert client.get("/api/board").json() == before


def test_foreign_card_id_cannot_be_changed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    app = create_app(tmp_path, tmp_path / "data")
    first_board = app.state.boards.add_card("first", "col-backlog", "Private", "")
    foreign_id = card_id(first_board, "Private")
    plan = {"text": "Changed it.", "operations": [
        {"type": "edit_card", "cardId": foreign_id, "title": "Exposed", "details": ""}
    ]}
    app.state.openrouter = OpenRouterClient(httpx.MockTransport(
        lambda _: httpx.Response(200, json={"choices": [{"message": {
            "content": json.dumps(plan)
        }}]})
    ))
    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE, app.state.sessions.create("second"))
    assert client.post("/api/ai/chat", json={"message": "Edit a card"}).status_code == 502
    assert app.state.boards.get("first") == first_board
    assert app.state.boards.get("second")["cards"] == {}


def test_invalid_move_position_rolls_back_earlier_rename(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    app = create_app(tmp_path, tmp_path / "data")
    before = app.state.boards.add_card("user", "col-backlog", "Keep", "")
    existing_id = card_id(before, "Keep")
    plan = {"text": "Moved it.", "operations": [
        {"type": "rename_column", "columnId": "col-backlog", "title": "Changed"},
        {"type": "move_card", "cardId": existing_id,
         "toColumnId": "col-done", "toIndex": 2},
    ]}
    app.state.openrouter = OpenRouterClient(httpx.MockTransport(
        lambda _: httpx.Response(200, json={"choices": [{"message": {
            "content": json.dumps(plan)
        }}]})
    ))
    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE, app.state.sessions.create("user"))
    assert client.post("/api/ai/chat", json={"message": "Move card"}).status_code == 502
    assert app.state.boards.get("user") == before


def test_upstream_failure_leaves_board_unchanged(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    app = create_app(tmp_path, tmp_path / "data")
    app.state.openrouter = OpenRouterClient(httpx.MockTransport(
        lambda _: httpx.Response(429, text="private upstream text")
    ))
    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE, app.state.sessions.create("user"))
    before = client.get("/api/board").json()
    response = client.post("/api/ai/chat", json={"message": "Add a task"})
    assert response.status_code == 502
    assert response.json() == {"detail": "OpenRouter request failed (HTTP 429)"}
    assert client.get("/api/board").json() == before


def test_request_rejects_blank_or_excessive_input(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    client, requests = signed_in_app(tmp_path, {"text": "No change.", "operations": []})
    assert client.post("/api/ai/chat", json={"message": "  "}).status_code == 422
    assert client.post("/api/ai/chat", json={"message": "x" * 2001}).status_code == 422
    assert client.post("/api/ai/chat", json={
        "message": "Hello", "history": [{"role": "user", "content": "x"}] * 21
    }).status_code == 422
    assert len(requests) == 0


def test_chat_is_rate_limited_per_user(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    client, requests = signed_in_app(tmp_path, {"text": "No change.", "operations": []})
    for _ in range(10):
        assert client.post("/api/ai/chat", json={"message": "Hello"}).status_code == 200
    limited = client.post("/api/ai/chat", json={"message": "Hello"})
    assert limited.status_code == 429
    assert limited.json() == {"detail": "Too many AI requests. Try again in a minute."}
    assert len(requests) == 10

    client.app.state.ai_calls["user"] = [0.0] * 10
    assert client.post("/api/ai/chat", json={"message": "Hello"}).status_code == 200


def test_live_structured_noop(tmp_path: Path) -> None:
    if os.getenv("OPENROUTER_LIVE_TEST") != "1":
        pytest.skip("Set OPENROUTER_LIVE_TEST=1 to run the live check")
    app = create_app(tmp_path, tmp_path / "data")
    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE, app.state.sessions.create("user"))
    before = client.get("/api/board").json()
    response = client.post("/api/ai/chat", json={
        "message": "Say hello without changing any cards or columns."
    })
    assert response.status_code == 200, response.text
    assert response.json()["text"]
    assert response.json()["board"] == before
