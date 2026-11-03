import json
import os
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from app.auth import SESSION_COOKIE
from app.main import create_app
from app.openrouter import MODEL, OPENROUTER_URL, OpenRouterClient, OpenRouterError


def test_check_requires_sign_in(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    client = TestClient(create_app(tmp_path, tmp_path / "data"))
    assert client.post("/api/ai/check").status_code == 401


def test_check_sends_model_request_and_returns_answer(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    def respond(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == OPENROUTER_URL
        assert request.headers["Authorization"] == "Bearer test-key"
        assert request.headers["Content-Type"] == "application/json"
        assert request.method == "POST"
        assert json.loads(request.content) == {
            "model": MODEL,
            "messages": [{"role": "user", "content": "What is 2+2? Reply with only the number."}],
        }
        return httpx.Response(200, json={"choices": [{"message": {"content": " 4 "}}]})

    app = create_app(tmp_path, tmp_path / "data")
    app.state.openrouter = OpenRouterClient(httpx.MockTransport(respond))
    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE, app.state.sessions.create("user"))
    response = client.post("/api/ai/check")
    assert response.status_code == 200
    assert response.json() == {"answer": "4"}
    assert "test-key" not in response.text


def test_missing_key_is_clear(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    app = create_app(tmp_path, tmp_path / "data")
    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE, app.state.sessions.create("user"))
    response = client.post("/api/ai/check")
    assert response.status_code == 503
    assert response.json() == {"detail": "OPENROUTER_API_KEY is not configured"}


@pytest.mark.parametrize(
    ("status", "expected"),
    [(401, "OpenRouter rejected the API key (HTTP 401)"), (429, "OpenRouter request failed (HTTP 429)")],
)
def test_upstream_http_error_hides_response(
    monkeypatch: pytest.MonkeyPatch, status: int, expected: str
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    transport = httpx.MockTransport(lambda _: httpx.Response(status, text="private upstream text"))
    with pytest.raises(OpenRouterError) as error:
        OpenRouterClient(transport).ask("2+2")
    assert str(error.value) == expected
    assert "private upstream text" not in str(error.value)


@pytest.mark.parametrize(
    ("failure", "expected"),
    [(httpx.ReadTimeout("slow"), "OpenRouter request timed out"),
     (httpx.ConnectError("offline"), "Could not reach OpenRouter")],
)
def test_network_error(
    monkeypatch: pytest.MonkeyPatch, failure: httpx.RequestError, expected: str
) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")

    def fail(_: httpx.Request) -> httpx.Response:
        raise failure

    with pytest.raises(OpenRouterError, match=expected):
        OpenRouterClient(httpx.MockTransport(fail)).ask("2+2")


@pytest.mark.parametrize("payload", [{}, {"choices": [{"message": {"content": ""}}]}])
def test_invalid_or_empty_answer(monkeypatch: pytest.MonkeyPatch, payload: dict) -> None:
    monkeypatch.setenv("OPENROUTER_API_KEY", "test-key")
    transport = httpx.MockTransport(lambda _: httpx.Response(200, json=payload))
    with pytest.raises(OpenRouterError):
        OpenRouterClient(transport).ask("2+2")


def test_live_openrouter_2_plus_2() -> None:
    if os.getenv("OPENROUTER_LIVE_TEST") != "1":
        pytest.skip("Set OPENROUTER_LIVE_TEST=1 to run the live check")
    assert OpenRouterClient().ask("What is 2+2? Reply with only the number.") == "4"
