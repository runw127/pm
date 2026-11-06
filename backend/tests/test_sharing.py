import sqlite3
from contextlib import closing
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.main import create_app
from tests.helpers import add_card, client_for, first_board


def session_id(client: TestClient) -> str:
    return client.get("/api/session").json()["id"]


def share(client: TestClient, board_id: str, username: str, role: str):
    return client.post(f"/api/boards/{board_id}/members", json={"username": username, "role": role})


def setup(app: FastAPI) -> tuple[TestClient, TestClient, TestClient, dict]:
    owner = client_for(app, "owner")
    editor = client_for(app, "editor")
    viewer = client_for(app, "viewer")
    board = first_board(owner)
    assert share(owner, board["id"], "editor", "editor").status_code == 200
    board = share(owner, board["id"], "VIEWER", "viewer").json()
    return owner, editor, viewer, board


def test_owner_shares_board_and_members_see_it(app: FastAPI) -> None:
    owner, editor, viewer, board = setup(app)
    assert board["role"] == "owner"
    assert [(m["username"], m["role"]) for m in board["members"]] == [
        ("owner", "owner"), ("editor", "editor"), ("viewer", "viewer")
    ]

    listing = editor.get("/api/boards").json()
    assert [(item["name"], item["role"], item["owner"]) for item in listing] == [
        ("My board", "owner", "editor"), ("My board", "editor", "owner")
    ]
    shared = editor.get(f"/api/boards/{board['id']}").json()
    assert shared["role"] == "editor"
    assert viewer.get(f"/api/boards/{board['id']}").json()["role"] == "viewer"
    assert client_for(app, "stranger").get(f"/api/boards/{board['id']}").status_code == 404


def test_roles_limit_what_members_can_change(app: FastAPI) -> None:
    owner, editor, viewer, board = setup(app)
    board_id = board["id"]
    card, _ = add_card(editor, board_id, "Editor card")
    assert editor.post(f"/api/boards/{board_id}/columns", json={"title": "QA"}).status_code == 200
    assert editor.patch(f"/api/boards/{board_id}/cards/{card}", json={"title": "Edited"}).status_code == 200

    forbidden = [
        viewer.post(f"/api/boards/{board_id}/cards", json={"columnId": "col-backlog", "title": "X"}),
        viewer.patch(f"/api/boards/{board_id}/cards/{card}", json={"title": "X"}),
        viewer.delete(f"/api/boards/{board_id}/cards/{card}"),
        viewer.patch(f"/api/boards/{board_id}/columns/col-backlog", json={"title": "X"}),
        editor.patch(f"/api/boards/{board_id}", json={"name": "Taken over"}),
        editor.delete(f"/api/boards/{board_id}"),
        share(editor, board_id, "viewer", "editor"),
        editor.delete(f"/api/boards/{board_id}/members/{session_id(viewer)}"),
    ]
    assert {response.status_code for response in forbidden} == {403}
    assert forbidden[0].json() == {"detail": "You have view-only access to this board"}
    assert forbidden[4].json() == {"detail": "Only the board owner can do that"}
    assert owner.get(f"/api/boards/{board_id}").json()["cards"][card]["title"] == "Edited"


def test_share_validation_and_role_change(app: FastAPI) -> None:
    owner, _, viewer, board = setup(app)
    board_id = board["id"]
    assert share(owner, board_id, "nobody", "editor").status_code == 404
    assert share(owner, board_id, "owner", "editor").status_code == 422
    assert share(owner, board_id, "viewer", "admin").status_code == 422
    assert share(client_for(app, "stranger"), board_id, "viewer", "editor").status_code == 404

    promoted = share(owner, board_id, "viewer", "editor").json()
    assert ("viewer", "editor") in [(m["username"], m["role"]) for m in promoted["members"]]
    assert len(promoted["members"]) == 3
    assert viewer.post(f"/api/boards/{board_id}/columns", json={"title": "Now allowed"}).status_code == 200


def test_assignees_must_be_members_and_are_cleared_on_removal(app: FastAPI) -> None:
    owner, editor, _, board = setup(app)
    board_id = board["id"]
    editor_id = session_id(editor)
    stranger_id = session_id(client_for(app, "stranger"))

    card, created = add_card(owner, board_id, "Assigned", assigneeId=editor_id)
    assert created["cards"][card]["assigneeId"] == editor_id
    rejected = owner.patch(f"/api/boards/{board_id}/cards/{card}", json={"assigneeId": stranger_id})
    assert rejected.status_code == 422
    assert rejected.json() == {"detail": "Assignee must be a board member"}
    assert owner.post(f"/api/boards/{board_id}/cards", json={
        "columnId": "col-backlog", "title": "X", "assigneeId": stranger_id,
    }).status_code == 422

    removed = owner.delete(f"/api/boards/{board_id}/members/{editor_id}").json()
    assert removed["cards"][card]["assigneeId"] is None
    assert editor_id not in [m["id"] for m in removed["members"]]
    assert editor.get(f"/api/boards/{board_id}").status_code == 404
    assert owner.delete(f"/api/boards/{board_id}/members/{editor_id}").status_code == 404

    own, _ = add_card(owner, board_id, "Mine", assigneeId=session_id(owner))
    cleared = owner.patch(f"/api/boards/{board_id}/cards/{own}", json={"assigneeId": None}).json()
    assert cleared["cards"][own]["assigneeId"] is None


def test_members_can_leave_but_owners_cannot(app: FastAPI) -> None:
    owner, editor, viewer, board = setup(app)
    board_id = board["id"]
    card, _ = add_card(owner, board_id, "For viewer", assigneeId=session_id(viewer))
    remaining = viewer.post(f"/api/boards/{board_id}/leave").json()
    assert board_id not in [item["id"] for item in remaining]
    assert owner.get(f"/api/boards/{board_id}").json()["cards"][card]["assigneeId"] is None

    response = owner.post(f"/api/boards/{board_id}/leave")
    assert response.status_code == 422
    assert response.json() == {"detail": "Owners cannot leave their own board"}
    assert client_for(app, "stranger").post(f"/api/boards/{board_id}/leave").status_code == 404


def test_deleting_accounts_cleans_up_sharing(app: FastAPI) -> None:
    owner, editor, _, board = setup(app)
    board_id = board["id"]
    card, _ = add_card(owner, board_id, "Assigned", assigneeId=session_id(editor))
    assert editor.request("DELETE", "/api/account", json={"password": "password123"}).status_code == 204
    after = owner.get(f"/api/boards/{board_id}").json()
    assert after["cards"][card]["assigneeId"] is None
    assert "editor" not in [m["username"] for m in after["members"]]

    viewer = client_for(app, "viewer")
    owner.request("DELETE", "/api/account", json={"password": "password123"})
    assert board_id not in [item["id"] for item in viewer.get("/api/boards").json()]


V2_SCHEMA = """
CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT, is_admin INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at REAL NOT NULL);
CREATE TABLE boards (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE columns (board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE, id TEXT NOT NULL,
    position INTEGER NOT NULL, title TEXT NOT NULL, PRIMARY KEY (board_id, id));
CREATE TABLE cards (id TEXT PRIMARY KEY, board_id TEXT NOT NULL, column_id TEXT NOT NULL,
    position INTEGER NOT NULL, title TEXT NOT NULL, details TEXT NOT NULL DEFAULT '',
    priority TEXT NOT NULL DEFAULT 'medium', due_date TEXT, labels TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
    FOREIGN KEY (board_id, column_id) REFERENCES columns(board_id, id) ON DELETE CASCADE);
INSERT INTO users VALUES ('u1', 'user', NULL, 1, 't');
INSERT INTO boards VALUES ('b1', 'u1', 'Kept board', 't');
INSERT INTO columns VALUES ('b1', 'col-a', 0, 'Todo');
INSERT INTO cards VALUES ('c1', 'b1', 'col-a', 0, 'Kept card', '', 'high', NULL, '["x"]', 't', 't');
PRAGMA user_version = 2;
"""


def test_migrates_version_two_database(tmp_path: Path) -> None:
    path = tmp_path / "data" / "board.sqlite3"
    path.parent.mkdir()
    with closing(sqlite3.connect(path)) as db:
        db.executescript(V2_SCHEMA)
    app = create_app(tmp_path, tmp_path / "data")
    board = client_for(app).get("/api/boards/b1").json()
    assert board["name"] == "Kept board"
    assert board["cards"]["c1"]["assigneeId"] is None
    assert board["cards"]["c1"]["labels"] == ["x"]
    assert board["members"] == [{"id": "u1", "username": "user", "role": "owner"}]
    with closing(sqlite3.connect(path)) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 6
