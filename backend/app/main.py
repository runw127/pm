import time
from pathlib import Path
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.ai import AIError, AIRequest, generate_reply
from app.auth import SESSION_COOKIE, SESSION_SECONDS, SessionStore
from app.board import BoardError, BoardStore
from app.openrouter import OpenRouterClient, OpenRouterError

AI_REQUESTS_PER_MINUTE = 10


class Credentials(BaseModel):
    username: str = Field(max_length=100)
    password: str = Field(max_length=100)


class ColumnRename(BaseModel):
    title: str


class CardCreate(BaseModel):
    column_id: str = Field(alias="columnId")
    title: str
    details: str = ""


class CardEdit(BaseModel):
    title: str
    details: str


class CardMove(BaseModel):
    to_column_id: str = Field(alias="toColumnId")
    to_index: int = Field(alias="toIndex", ge=0)


def get_sessions(request: Request) -> SessionStore:
    return request.app.state.sessions


def get_boards(request: Request) -> BoardStore:
    return request.app.state.boards


def get_openrouter(request: Request) -> OpenRouterClient:
    return request.app.state.openrouter


Sessions = Annotated[SessionStore, Depends(get_sessions)]
Boards = Annotated[BoardStore, Depends(get_boards)]
OpenRouter = Annotated[OpenRouterClient, Depends(get_openrouter)]
SessionToken = Annotated[str | None, Cookie(alias=SESSION_COOKIE)]


def require_user(sessions: Sessions, token: SessionToken = None) -> str:
    username = sessions.username(token)
    if username is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return username


User = Annotated[str, Depends(require_user)]


def limit_ai(request: Request, username: User) -> str:
    now = time.monotonic()
    calls = request.app.state.ai_calls
    recent = [at for at in calls.get(username, []) if now - at < 60]
    if len(recent) >= AI_REQUESTS_PER_MINUTE:
        raise HTTPException(status_code=429, detail="Too many AI requests. Try again in a minute.")
    calls[username] = [*recent, now]
    return username


AIUser = Annotated[str, Depends(limit_ai)]

api = APIRouter(prefix="/api")


@api.get("/hello")
def hello() -> dict[str, str]:
    return {"message": "Hello from FastAPI"}


@api.post("/login")
def login(credentials: Credentials, response: Response, sessions: Sessions) -> dict[str, str]:
    if credentials.username != "user" or credentials.password != "password":
        raise HTTPException(status_code=401, detail="Invalid credentials")
    response.set_cookie(
        key=SESSION_COOKIE,
        value=sessions.create(credentials.username),
        max_age=SESSION_SECONDS,
        httponly=True,
        samesite="strict",
    )
    return {"username": credentials.username}


@api.get("/session")
def session(username: User) -> dict[str, str]:
    return {"username": username}


@api.post("/logout", status_code=204)
def logout(response: Response, sessions: Sessions, token: SessionToken = None) -> None:
    sessions.delete(token)
    response.delete_cookie(SESSION_COOKIE, samesite="strict")


@api.get("/board")
def board(username: User, boards: Boards) -> dict:
    return boards.get(username)


@api.patch("/board/columns/{column_id}")
def rename_column(column_id: str, change: ColumnRename, username: User, boards: Boards) -> dict:
    return boards.rename_column(username, column_id, change.title)


@api.post("/board/cards")
def add_card(card: CardCreate, username: User, boards: Boards) -> dict:
    return boards.add_card(username, card.column_id, card.title, card.details)


@api.patch("/board/cards/{card_id}")
def edit_card(card_id: str, change: CardEdit, username: User, boards: Boards) -> dict:
    return boards.edit_card(username, card_id, change.title, change.details)


@api.delete("/board/cards/{card_id}")
def delete_card(card_id: str, username: User, boards: Boards) -> dict:
    return boards.delete_card(username, card_id)


@api.post("/board/cards/{card_id}/move")
def move_card(card_id: str, move: CardMove, username: User, boards: Boards) -> dict:
    return boards.move_card(username, card_id, move.to_column_id, move.to_index)


@api.post("/ai/check")
def check_openrouter(_: AIUser, openrouter: OpenRouter) -> dict[str, str]:
    return {"answer": openrouter.ask("What is 2+2? Reply with only the number.")}


@api.post("/ai/chat")
def ai_chat(chat: AIRequest, username: AIUser, boards: Boards, openrouter: OpenRouter) -> dict:
    return generate_reply(username, chat, boards, openrouter)


def app_error(_: Request, exc: BoardError | OpenRouterError | AIError) -> JSONResponse:
    return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})


def create_app(frontend_dir: Path, data_dir: Path) -> FastAPI:
    app = FastAPI()
    app.state.sessions = SessionStore(data_dir / "sessions")
    app.state.boards = BoardStore(data_dir / "board.sqlite3")
    app.state.openrouter = OpenRouterClient()
    app.state.ai_calls = {}
    for error in (BoardError, OpenRouterError, AIError):
        app.add_exception_handler(error, app_error)
    app.include_router(api)
    app.mount("/", StaticFiles(directory=frontend_dir, html=True, check_dir=False))
    return app


ROOT_DIR = Path(__file__).resolve().parents[2]
app = create_app(ROOT_DIR / "frontend-dist", ROOT_DIR / "data")
