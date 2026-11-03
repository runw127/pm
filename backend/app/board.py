import sqlite3
from contextlib import closing, contextmanager
from pathlib import Path
from uuid import uuid4


DEFAULT_COLUMNS = (
    ("col-backlog", "Backlog"),
    ("col-discovery", "Discovery"),
    ("col-progress", "In Progress"),
    ("col-review", "Review"),
    ("col-done", "Done"),
)

SCHEMA = (
    """CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE CHECK (length(trim(username)) > 0)
    )""",
    """CREATE TABLE boards (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
    )""",
    """CREATE TABLE columns (
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        slot INTEGER NOT NULL CHECK (slot BETWEEN 0 AND 4),
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        PRIMARY KEY (board_id, id),
        UNIQUE (board_id, slot),
        CHECK (
            (slot = 0 AND id = 'col-backlog') OR
            (slot = 1 AND id = 'col-discovery') OR
            (slot = 2 AND id = 'col-progress') OR
            (slot = 3 AND id = 'col-review') OR
            (slot = 4 AND id = 'col-done')
        )
    )""",
    """CREATE TABLE cards (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        column_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        details TEXT NOT NULL DEFAULT '',
        FOREIGN KEY (board_id, column_id) REFERENCES columns(board_id, id)
            ON DELETE CASCADE
    )""",
    "CREATE INDEX cards_in_column ON cards(board_id, column_id, position, id)",
)


class BoardError(Exception):
    status_code = 422


class BoardNotFound(BoardError):
    status_code = 404


def _title(value: str) -> str:
    title = value.strip()
    if not title:
        raise BoardError("Title cannot be empty")
    return title


class BoardStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with self._transaction() as db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version == 0:
                for statement in SCHEMA:
                    db.execute(statement)
                db.execute("PRAGMA user_version = 1")
            elif version != 1:
                raise RuntimeError(f"Unsupported board database version: {version}")

    @contextmanager
    def _transaction(self):
        with closing(sqlite3.connect(self.path)) as db:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys = ON")
            with db:
                db.execute("BEGIN IMMEDIATE")
                yield db

    def _board_id(self, db: sqlite3.Connection, username: str) -> str:
        row = db.execute(
            """SELECT boards.id FROM boards
               JOIN users ON users.id = boards.user_id
               WHERE users.username = ?""",
            (username,),
        ).fetchone()
        if row:
            return row["id"]

        user = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
        user_id = user["id"] if user else f"user-{uuid4().hex}"
        if not user:
            db.execute("INSERT INTO users (id, username) VALUES (?, ?)", (user_id, username))
        board_id = f"board-{uuid4().hex}"
        db.execute("INSERT INTO boards (id, user_id) VALUES (?, ?)", (board_id, user_id))
        db.executemany(
            "INSERT INTO columns (board_id, id, slot, title) VALUES (?, ?, ?, ?)",
            [(board_id, column_id, slot, title) for slot, (column_id, title) in enumerate(DEFAULT_COLUMNS)],
        )
        return board_id

    def _column(self, db: sqlite3.Connection, board_id: str, column_id: str) -> None:
        row = db.execute(
            "SELECT 1 FROM columns WHERE board_id = ? AND id = ?", (board_id, column_id)
        ).fetchone()
        if not row:
            raise BoardNotFound("Column not found")

    def _card(self, db: sqlite3.Connection, board_id: str, card_id: str) -> sqlite3.Row:
        row = db.execute(
            "SELECT * FROM cards WHERE board_id = ? AND id = ?", (board_id, card_id)
        ).fetchone()
        if not row:
            raise BoardNotFound("Card not found")
        return row

    def _card_ids(self, db: sqlite3.Connection, board_id: str, column_id: str) -> list[str]:
        rows = db.execute(
            """SELECT id FROM cards WHERE board_id = ? AND column_id = ?
               ORDER BY position, id""",
            (board_id, column_id),
        ).fetchall()
        return [row["id"] for row in rows]

    def _set_positions(self, db: sqlite3.Connection, board_id: str, card_ids: list[str]) -> None:
        db.executemany(
            "UPDATE cards SET position = ? WHERE board_id = ? AND id = ?",
            [(position, board_id, card_id) for position, card_id in enumerate(card_ids)],
        )

    def _snapshot(self, db: sqlite3.Connection, board_id: str) -> dict:
        rows = db.execute(
            "SELECT id, slot, title FROM columns WHERE board_id = ? ORDER BY slot", (board_id,)
        ).fetchall()
        if len(rows) != 5 or any(
            row["slot"] != slot or row["id"] != DEFAULT_COLUMNS[slot][0]
            for slot, row in enumerate(rows)
        ):
            raise RuntimeError("Board must have five fixed columns")

        columns = []
        cards = {}
        for row in rows:
            card_rows = db.execute(
                """SELECT id, position, title, details FROM cards
                   WHERE board_id = ? AND column_id = ? ORDER BY position, id""",
                (board_id, row["id"]),
            ).fetchall()
            if any(card["position"] != position for position, card in enumerate(card_rows)):
                raise RuntimeError("Card positions must be consecutive")
            columns.append(
                {"id": row["id"], "title": row["title"],
                 "cardIds": [card["id"] for card in card_rows]}
            )
            for card in card_rows:
                cards[card["id"]] = {
                    "id": card["id"], "title": card["title"], "details": card["details"]
                }
        return {"columns": columns, "cards": cards}

    def get(self, username: str) -> dict:
        with self._transaction() as db:
            return self._snapshot(db, self._board_id(db, username))

    def rename_column(self, username: str, column_id: str, title: str) -> dict:
        title = _title(title)
        with self._transaction() as db:
            board_id = self._board_id(db, username)
            self._column(db, board_id, column_id)
            db.execute(
                "UPDATE columns SET title = ? WHERE board_id = ? AND id = ?",
                (title, board_id, column_id),
            )
            return self._snapshot(db, board_id)

    def add_card(self, username: str, column_id: str, title: str, details: str) -> dict:
        title = _title(title)
        with self._transaction() as db:
            board_id = self._board_id(db, username)
            self._column(db, board_id, column_id)
            position = len(self._card_ids(db, board_id, column_id))
            db.execute(
                """INSERT INTO cards (id, board_id, column_id, position, title, details)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (f"card-{uuid4().hex}", board_id, column_id, position, title, details),
            )
            return self._snapshot(db, board_id)

    def edit_card(self, username: str, card_id: str, title: str, details: str) -> dict:
        title = _title(title)
        with self._transaction() as db:
            board_id = self._board_id(db, username)
            self._card(db, board_id, card_id)
            db.execute(
                "UPDATE cards SET title = ?, details = ? WHERE board_id = ? AND id = ?",
                (title, details, board_id, card_id),
            )
            return self._snapshot(db, board_id)

    def delete_card(self, username: str, card_id: str) -> dict:
        with self._transaction() as db:
            board_id = self._board_id(db, username)
            card = self._card(db, board_id, card_id)
            column_id = card["column_id"]
            db.execute("DELETE FROM cards WHERE board_id = ? AND id = ?", (board_id, card_id))
            self._set_positions(db, board_id, self._card_ids(db, board_id, column_id))
            return self._snapshot(db, board_id)

    def move_card(self, username: str, card_id: str, to_column_id: str, to_index: int) -> dict:
        with self._transaction() as db:
            board_id = self._board_id(db, username)
            card = self._card(db, board_id, card_id)
            self._column(db, board_id, to_column_id)
            from_column_id = card["column_id"]
            from_ids = self._card_ids(db, board_id, from_column_id)
            from_ids.remove(card_id)
            to_ids = (
                from_ids if from_column_id == to_column_id
                else self._card_ids(db, board_id, to_column_id)
            )
            if to_index < 0 or to_index > len(to_ids):
                raise BoardError("Invalid card position")
            to_ids.insert(to_index, card_id)
            db.execute(
                "UPDATE cards SET column_id = ? WHERE board_id = ? AND id = ?",
                (to_column_id, board_id, card_id),
            )
            self._set_positions(db, board_id, from_ids)
            if to_ids is not from_ids:
                self._set_positions(db, board_id, to_ids)
            return self._snapshot(db, board_id)
