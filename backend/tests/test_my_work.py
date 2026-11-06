from fastapi import FastAPI
from fastapi.testclient import TestClient

from tests.helpers import add_card, client_for, first_board


def user_id(client: TestClient) -> str:
    return client.get("/api/session").json()["id"]


def titles(client: TestClient) -> list[str]:
    return [item["title"] for item in client.get("/api/my-work").json()]


def test_lists_open_assigned_cards_across_boards_by_due_date(app: FastAPI) -> None:
    owner = client_for(app, "owner")
    member = client_for(app, "member")
    me = user_id(member)
    own_board = first_board(member)["id"]
    shared = owner.post("/api/boards", json={"name": "Team"}).json()["id"]
    owner.post(f"/api/boards/{shared}/members", json={"username": "member", "role": "editor"})

    add_card(member, own_board, "No date, low", assigneeId=me, priority="low")
    add_card(member, own_board, "No date, high", assigneeId=me, priority="high")
    later, _ = add_card(owner, shared, "Later", assigneeId=me, dueDate="2026-12-20")
    add_card(member, own_board, "Sooner", assigneeId=me, dueDate="2026-11-10", column_id="col-review")
    add_card(owner, shared, "Owner's own", assigneeId=user_id(owner), dueDate="2026-11-01")
    add_card(member, own_board, "Unassigned", dueDate="2026-11-01")
    add_card(member, own_board, "Finished", assigneeId=me, dueDate="2026-11-02", column_id="col-done")
    item = owner.post(f"/api/boards/{shared}/cards/{later}/checklist", json={"text": "Step"}).json()
    owner.post(f"/api/boards/{shared}/cards/{later}/checklist", json={"text": "Step 2"})
    owner.patch(
        f"/api/boards/{shared}/cards/{later}/checklist/{item['cards'][later]['checklist'][0]['id']}",
        json={"done": True},
    )

    work = member.get("/api/my-work").json()
    assert [entry["title"] for entry in work] == ["Sooner", "Later", "No date, high", "No date, low"]
    assert work[1] == {
        "boardId": shared, "boardName": "Team", "cardId": later, "title": "Later", "column": "Backlog",
        "priority": "medium", "dueDate": "2026-12-20", "labels": [],
        "checklistDone": 1, "checklistTotal": 2,
    }
    assert work[0]["column"] == "Review"
    assert titles(owner) == ["Owner's own"]


def test_last_column_counts_as_done_and_removal_clears_work(app: FastAPI) -> None:
    owner = client_for(app, "owner")
    member = client_for(app, "member")
    board_id = first_board(owner)["id"]
    owner.post(f"/api/boards/{board_id}/members", json={"username": "member", "role": "editor"})
    card, _ = add_card(owner, board_id, "Ship it", assigneeId=user_id(member))
    assert titles(member) == ["Ship it"]

    owner.post(f"/api/boards/{board_id}/cards/{card}/move", json={"toColumnId": "col-done", "toIndex": 0})
    assert titles(member) == []
    owner.post(f"/api/boards/{board_id}/columns/col-done/move", json={"toIndex": 0})
    assert titles(member) == ["Ship it"]

    owner.delete(f"/api/boards/{board_id}/members/{user_id(member)}")
    assert titles(member) == []


def test_my_work_requires_sign_in(app: FastAPI) -> None:
    assert TestClient(app).get("/api/my-work").status_code == 401
    assert client_for(app, "fresh").get("/api/my-work").json() == []
