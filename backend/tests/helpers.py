from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.users import SESSION_COOKIE, AuthError


def client_for(app: FastAPI, username: str = "user") -> TestClient:
    """Return a client signed in as `username`, registering the account if needed.

    The seeded admin `user` has password `password`; other accounts use `password123`.
    """
    users = app.state.users
    password = "password" if username == "user" else "password123"
    try:
        user = users.authenticate(username, password)
    except AuthError:
        user = users.register(username, password)
    client = TestClient(app)
    client.cookies.set(SESSION_COOKIE, users.create_session(user.id))
    return client


def first_board(client: TestClient) -> dict:
    board_id = client.get("/api/boards").json()[0]["id"]
    return client.get(f"/api/boards/{board_id}").json()


def card_id(board: dict, title: str) -> str:
    return next(item for item, card in board["cards"].items() if card["title"] == title)


def add_card(client: TestClient, board_id: str, title: str, column_id: str = "col-backlog", **fields) -> tuple[str, dict]:
    response = client.post(
        f"/api/boards/{board_id}/cards", json={"columnId": column_id, "title": title, **fields}
    )
    assert response.status_code == 200, response.text
    board = response.json()
    return card_id(board, title), board
