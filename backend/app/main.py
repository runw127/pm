from pathlib import Path

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.auth import SESSION_COOKIE, SESSION_SECONDS, SessionStore
from app.board import BoardError, BoardStore


class Credentials(BaseModel):
    username: str
    password: str


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


def require_user(request: Request) -> str:
    username = request.app.state.sessions.username(request.cookies.get(SESSION_COOKIE))
    if username is None:
        raise HTTPException(status_code=401, detail="Not signed in")
    return username


def create_app(frontend_dir: Path, data_dir: Path) -> FastAPI:
    app = FastAPI()
    app.state.sessions = SessionStore(data_dir / "sessions")
    app.state.boards = BoardStore(data_dir / "board.sqlite3")

    @app.exception_handler(BoardError)
    def board_error(_: Request, exc: BoardError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})

    @app.get("/api/hello")
    def hello() -> dict[str, str]:
        return {"message": "Hello from FastAPI"}

    @app.post("/api/login")
    def login(credentials: Credentials, response: Response) -> dict[str, str]:
        if credentials.username != "user" or credentials.password != "password":
            raise HTTPException(status_code=401, detail="Invalid credentials")
        token = app.state.sessions.create(credentials.username)
        response.set_cookie(
            key=SESSION_COOKIE,
            value=token,
            max_age=SESSION_SECONDS,
            httponly=True,
            samesite="strict",
        )
        return {"username": credentials.username}

    @app.get("/api/session")
    def session(username: str = Depends(require_user)) -> dict[str, str]:
        return {"username": username}

    @app.post("/api/logout", status_code=204)
    def logout(request: Request, response: Response) -> None:
        app.state.sessions.delete(request.cookies.get(SESSION_COOKIE))
        response.delete_cookie(SESSION_COOKIE, samesite="strict")

    @app.get("/api/board")
    def board(username: str = Depends(require_user)) -> dict:
        return app.state.boards.get(username)

    @app.patch("/api/board/columns/{column_id}")
    def rename_column(
        column_id: str, change: ColumnRename, username: str = Depends(require_user)
    ) -> dict:
        return app.state.boards.rename_column(username, column_id, change.title)

    @app.post("/api/board/cards")
    def add_card(card: CardCreate, username: str = Depends(require_user)) -> dict:
        return app.state.boards.add_card(username, card.column_id, card.title, card.details)

    @app.patch("/api/board/cards/{card_id}")
    def edit_card(card_id: str, change: CardEdit, username: str = Depends(require_user)) -> dict:
        return app.state.boards.edit_card(username, card_id, change.title, change.details)

    @app.delete("/api/board/cards/{card_id}")
    def delete_card(card_id: str, username: str = Depends(require_user)) -> dict:
        return app.state.boards.delete_card(username, card_id)

    @app.post("/api/board/cards/{card_id}/move")
    def move_card(card_id: str, move: CardMove, username: str = Depends(require_user)) -> dict:
        return app.state.boards.move_card(username, card_id, move.to_column_id, move.to_index)

    app.mount("/", StaticFiles(directory=frontend_dir, html=True, check_dir=False))
    return app


ROOT_DIR = Path(__file__).resolve().parents[2]
app = create_app(ROOT_DIR / "frontend-dist", ROOT_DIR / "data")
