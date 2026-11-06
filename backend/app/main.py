import os
import time
from pathlib import Path
from typing import Annotated, Literal

from fastapi import APIRouter, Cookie, Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ConfigDict, Field

from app.ai import AIError, AIRequest, generate_reply
from app.board import BoardError, BoardStore
from app.db import Database
from app.openrouter import OpenRouterClient, OpenRouterError
from app.users import (
    PASSWORD_MAX_LENGTH,
    SESSION_COOKIE,
    SESSION_SECONDS,
    CurrentUser,
    UserError,
    UserStore,
)

AI_REQUESTS_PER_MINUTE = 10


class Body(BaseModel):
    model_config = ConfigDict(populate_by_name=True)


class Credentials(Body):
    username: str = Field(max_length=100)
    password: str = Field(max_length=PASSWORD_MAX_LENGTH)


class PasswordChange(Body):
    current_password: str = Field(alias="currentPassword", max_length=PASSWORD_MAX_LENGTH)
    new_password: str = Field(alias="newPassword", max_length=PASSWORD_MAX_LENGTH)


class PasswordConfirm(Body):
    password: str = Field(max_length=PASSWORD_MAX_LENGTH)


class AdminChange(Body):
    is_admin: bool = Field(alias="isAdmin")


class BoardName(Body):
    name: str


class Share(Body):
    username: str = Field(max_length=100)
    role: Literal["editor", "viewer"]


class Comment(Body):
    body: str


class Title(Body):
    title: str


class Position(Body):
    to_index: int = Field(alias="toIndex", ge=0)


class CardCreate(Body):
    column_id: str = Field(alias="columnId")
    title: str
    details: str = ""
    priority: Literal["low", "medium", "high"] = "medium"
    due_date: str | None = Field(default=None, alias="dueDate")
    labels: list[str] = Field(default_factory=list)
    assignee_id: str | None = Field(default=None, alias="assigneeId")


class CardEdit(Body):
    title: str | None = None
    details: str | None = None
    priority: Literal["low", "medium", "high"] | None = None
    due_date: str | None = Field(default=None, alias="dueDate")
    labels: list[str] | None = None
    assignee_id: str | None = Field(default=None, alias="assigneeId")


NULLABLE_CARD_FIELDS = {"dueDate", "assigneeId"}


class ChecklistItem(Body):
    text: str


class ChecklistEdit(Body):
    text: str | None = None
    done: bool | None = None


class CardMove(Position):
    to_column_id: str = Field(alias="toColumnId")


def get_users(request: Request) -> UserStore:
    return request.app.state.users


def get_boards(request: Request) -> BoardStore:
    return request.app.state.boards


def get_openrouter(request: Request) -> OpenRouterClient:
    return request.app.state.openrouter


Users = Annotated[UserStore, Depends(get_users)]
Boards = Annotated[BoardStore, Depends(get_boards)]
OpenRouter = Annotated[OpenRouterClient, Depends(get_openrouter)]
SessionToken = Annotated[str | None, Cookie(alias=SESSION_COOKIE)]


def require_user(users: Users, token: SessionToken = None) -> CurrentUser:
    user = users.session_user(token)
    if user is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return user


User = Annotated[CurrentUser, Depends(require_user)]


def require_admin(user: User) -> CurrentUser:
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


Admin = Annotated[CurrentUser, Depends(require_admin)]


def limit_ai(request: Request, user: User) -> CurrentUser:
    now = time.monotonic()
    calls = request.app.state.ai_calls
    recent = [at for at in calls.get(user.id, []) if now - at < 60]
    if len(recent) >= AI_REQUESTS_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Too many AI requests. Try again in a minute.")
    calls[user.id] = [*recent, now]
    return user


AIUser = Annotated[CurrentUser, Depends(limit_ai)]

api = APIRouter(prefix="/api")


def start_session(response: Response, users: UserStore, user: CurrentUser) -> dict:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=users.create_session(user.id),
        max_age=SESSION_SECONDS,
        httponly=True,
        samesite="strict",
    )
    return user.public()


@api.get("/hello")
def hello() -> dict[str, str]:
    return {"message": "Hello from FastAPI"}


# Accounts


@api.post("/register", status_code=201)
def register(credentials: Credentials, response: Response, users: Users) -> dict:
    user = users.register(credentials.username, credentials.password)
    return start_session(response, users, user)


@api.post("/login")
def login(credentials: Credentials, response: Response, users: Users) -> dict:
    user = users.authenticate(credentials.username, credentials.password)
    return start_session(response, users, user)


@api.get("/session")
def session(user: User) -> dict:
    return user.public()


@api.post("/logout", status_code=204)
def logout(response: Response, users: Users, token: SessionToken = None) -> None:
    users.delete_session(token)
    response.delete_cookie(SESSION_COOKIE, samesite="strict")


@api.post("/account/password", status_code=204)
def change_password(
    change: PasswordChange, user: User, users: Users, token: SessionToken = None
) -> None:
    users.change_password(user.id, change.current_password, change.new_password, token)


@api.delete("/account", status_code=204)
def delete_account(confirm: PasswordConfirm, response: Response, user: User, users: Users) -> None:
    users.delete_account(user, confirm.password)
    response.delete_cookie(SESSION_COOKIE, samesite="strict")


# Admin


@api.get("/admin/users")
def list_users(_: Admin, users: Users) -> list[dict]:
    return users.list_users()


@api.patch("/admin/users/{user_id}")
def set_admin(user_id: str, change: AdminChange, _: Admin, users: Users) -> list[dict]:
    return users.set_admin(user_id, change.is_admin)


@api.post("/admin/users/{user_id}/password", status_code=204)
def reset_password(user_id: str, change: PasswordConfirm, _: Admin, users: Users) -> None:
    users.reset_password(user_id, change.password)


@api.delete("/admin/users/{user_id}")
def remove_user(user_id: str, admin: Admin, users: Users) -> list[dict]:
    if user_id == admin.id:
        raise HTTPException(status_code=422, detail="Delete your own account from account settings")
    return users.remove_user(user_id)


# Boards


@api.get("/my-work")
def my_work(user: User, boards: Boards) -> list[dict]:
    return boards.my_work(user.id)


@api.get("/boards")
def list_boards(user: User, boards: Boards) -> list[dict]:
    return boards.list_boards(user.id)


@api.post("/boards", status_code=201)
def create_board(body: BoardName, user: User, boards: Boards) -> dict:
    return boards.create_board(user.id, body.name)


@api.get("/boards/{board_id}")
def get_board(board_id: str, user: User, boards: Boards) -> dict:
    return boards.get(user.id, board_id)


@api.patch("/boards/{board_id}")
def rename_board(board_id: str, body: BoardName, user: User, boards: Boards) -> dict:
    return boards.rename_board(user.id, board_id, body.name)


@api.delete("/boards/{board_id}")
def delete_board(board_id: str, user: User, boards: Boards) -> list[dict]:
    return boards.delete_board(user.id, board_id)


@api.post("/boards/{board_id}/members")
def share_board(board_id: str, body: Share, user: User, boards: Boards) -> dict:
    return boards.share(user.id, board_id, body.username, body.role)


@api.delete("/boards/{board_id}/members/{member_id}")
def remove_member(board_id: str, member_id: str, user: User, boards: Boards) -> dict:
    return boards.remove_member(user.id, board_id, member_id)


@api.post("/boards/{board_id}/leave")
def leave_board(board_id: str, user: User, boards: Boards) -> list[dict]:
    return boards.leave(user.id, board_id)


@api.get("/boards/{board_id}/activity")
def board_activity(board_id: str, user: User, boards: Boards, card_id: str | None = None) -> list[dict]:
    return boards.activity(user.id, board_id, card_id)


@api.get("/boards/{board_id}/cards/{card_id}/comments")
def list_comments(board_id: str, card_id: str, user: User, boards: Boards) -> list[dict]:
    return boards.comments(user.id, board_id, card_id)


@api.post("/boards/{board_id}/cards/{card_id}/comments", status_code=201)
def add_comment(board_id: str, card_id: str, body: Comment, user: User, boards: Boards) -> list[dict]:
    return boards.add_comment(user.id, board_id, card_id, body.body)


@api.delete("/boards/{board_id}/cards/{card_id}/comments/{comment_id}")
def delete_comment(
    board_id: str, card_id: str, comment_id: str, user: User, boards: Boards
) -> list[dict]:
    return boards.delete_comment(user.id, board_id, card_id, comment_id)


def operate(boards: BoardStore, user: CurrentUser, board_id: str, **operation) -> dict:
    return boards.apply_operations(user.id, board_id, [operation])


@api.post("/boards/{board_id}/columns")
def add_column(board_id: str, body: Title, user: User, boards: Boards) -> dict:
    return operate(boards, user, board_id, type="add_column", title=body.title)


@api.patch("/boards/{board_id}/columns/{column_id}")
def rename_column(board_id: str, column_id: str, body: Title, user: User, boards: Boards) -> dict:
    return operate(
        boards, user, board_id, type="rename_column", columnId=column_id, title=body.title
    )


@api.delete("/boards/{board_id}/columns/{column_id}")
def delete_column(board_id: str, column_id: str, user: User, boards: Boards) -> dict:
    return operate(boards, user, board_id, type="delete_column", columnId=column_id)


@api.post("/boards/{board_id}/columns/{column_id}/move")
def move_column(
    board_id: str, column_id: str, body: Position, user: User, boards: Boards
) -> dict:
    return operate(
        boards, user, board_id, type="move_column", columnId=column_id, toIndex=body.to_index
    )


@api.post("/boards/{board_id}/cards")
def add_card(board_id: str, card: CardCreate, user: User, boards: Boards) -> dict:
    return operate(boards, user, board_id, type="add_card", **card.model_dump(by_alias=True))


@api.patch("/boards/{board_id}/cards/{card_id}")
def edit_card(board_id: str, card_id: str, change: CardEdit, user: User, boards: Boards) -> dict:
    fields = change.model_dump(by_alias=True, exclude_unset=True)
    if any(value is None for key, value in fields.items() if key not in NULLABLE_CARD_FIELDS):
        raise HTTPException(status_code=422, detail="Only dueDate and assigneeId can be null")
    return operate(boards, user, board_id, type="edit_card", cardId=card_id, **fields)


@api.delete("/boards/{board_id}/cards/{card_id}")
def delete_card(board_id: str, card_id: str, user: User, boards: Boards) -> dict:
    return operate(boards, user, board_id, type="delete_card", cardId=card_id)


@api.get("/boards/{board_id}/archive")
def archived_cards(board_id: str, user: User, boards: Boards) -> list[dict]:
    return boards.archived(user.id, board_id)


@api.post("/boards/{board_id}/cards/{card_id}/archive")
def archive_card(board_id: str, card_id: str, user: User, boards: Boards) -> dict:
    return operate(boards, user, board_id, type="archive_card", cardId=card_id)


@api.post("/boards/{board_id}/cards/{card_id}/restore")
def restore_card(board_id: str, card_id: str, user: User, boards: Boards) -> dict:
    return operate(boards, user, board_id, type="restore_card", cardId=card_id)


@api.post("/boards/{board_id}/cards/{card_id}/move")
def move_card(board_id: str, card_id: str, move: CardMove, user: User, boards: Boards) -> dict:
    return operate(
        boards, user, board_id, type="move_card", cardId=card_id,
        toColumnId=move.to_column_id, toIndex=move.to_index,
    )


@api.post("/boards/{board_id}/cards/{card_id}/checklist")
def add_checklist_item(
    board_id: str, card_id: str, item: ChecklistItem, user: User, boards: Boards
) -> dict:
    return operate(boards, user, board_id, type="add_checklist_item", cardId=card_id, text=item.text)


@api.patch("/boards/{board_id}/cards/{card_id}/checklist/{item_id}")
def edit_checklist_item(
    board_id: str, card_id: str, item_id: str, change: ChecklistEdit, user: User, boards: Boards
) -> dict:
    fields = change.model_dump(exclude_none=True)
    return operate(
        boards, user, board_id, type="edit_checklist_item", cardId=card_id, itemId=item_id, **fields
    )


@api.delete("/boards/{board_id}/cards/{card_id}/checklist/{item_id}")
def delete_checklist_item(
    board_id: str, card_id: str, item_id: str, user: User, boards: Boards
) -> dict:
    return operate(
        boards, user, board_id, type="delete_checklist_item", cardId=card_id, itemId=item_id
    )


# AI


@api.post("/ai/check")
def check_openrouter(_: AIUser, openrouter: OpenRouter) -> dict[str, str]:
    return {"answer": openrouter.ask("What is 2+2? Reply with only the number.")}


@api.post("/boards/{board_id}/ai/chat")
def ai_chat(
    board_id: str, chat: AIRequest, user: AIUser, boards: Boards, openrouter: OpenRouter
) -> dict:
    return generate_reply(user.id, board_id, chat, boards, openrouter)


def app_error(_: Request, exc: BoardError | UserError | OpenRouterError | AIError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})


def create_app(frontend_dir: Path, data_dir: Path) -> FastAPI:
    app = FastAPI()
    database = Database(data_dir / "board.sqlite3")
    app.state.users = UserStore(database)
    app.state.boards = BoardStore(database)
    app.state.openrouter = OpenRouterClient()
    app.state.ai_calls = {}
    for error in (BoardError, UserError, OpenRouterError, AIError):
        app.add_exception_handler(error, app_error)
    app.include_router(api)
    app.mount("/", StaticFiles(directory=frontend_dir, html=True, check_dir=False))
    return app


ROOT_DIR = Path(__file__).resolve().parents[2]


def default_app() -> FastAPI:
    """Factory used by uvicorn (`--factory`), so importing this module touches no data.

    `PM_FRONTEND_DIR` and `PM_DATA_DIR` override the default paths (used by browser tests).
    """
    return create_app(
        Path(os.getenv("PM_FRONTEND_DIR", ROOT_DIR / "frontend-dist")),
        Path(os.getenv("PM_DATA_DIR", ROOT_DIR / "data")),
    )
