import json
import re
import sqlite3
from datetime import date
from uuid import uuid4

from app.db import Database, now

TITLE_MAX_LENGTH = 200
DETAILS_MAX_LENGTH = 2000
BOARD_NAME_MAX_LENGTH = 100
LABEL_MAX_LENGTH = 30
MAX_LABELS = 10
MAX_COLUMNS = 12
PRIORITIES = ("low", "medium", "high")
MEMBER_ROLES = ("editor", "viewer")
WRITE_ROLES = ("owner", "editor")
DEFAULT_BOARD_NAME = "My board"
DEFAULT_COLUMNS = (
    ("col-backlog", "Backlog"),
    ("col-discovery", "Discovery"),
    ("col-progress", "In Progress"),
    ("col-review", "Review"),
    ("col-done", "Done"),
)
COMMENT_MAX_LENGTH = 2000
CHECKLIST_MAX_ITEMS = 30
ACTIVITY_LIMIT = 50
# (card_id or None, activity summary) returned by each board operation.
Logged = tuple[str | None, str]
DATE_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}")


class BoardError(Exception):
    status_code = 422


class BoardNotFound(BoardError):
    status_code = 404


class BoardForbidden(BoardError):
    status_code = 403


def _text(value: str, label: str, limit: int) -> str:
    text = value.strip()
    if not text:
        raise BoardError(f"{label} cannot be empty")
    if len(text) > limit:
        raise BoardError(f"{label} cannot exceed {limit} characters")
    return text


def _title(value: str) -> str:
    return _text(value, "Title", TITLE_MAX_LENGTH)


def _details(value: str) -> str:
    if len(value) > DETAILS_MAX_LENGTH:
        raise BoardError(f"Details cannot exceed {DETAILS_MAX_LENGTH} characters")
    return value


def _priority(value: str) -> str:
    if value not in PRIORITIES:
        raise BoardError("Priority must be low, medium, or high")
    return value


def _due_date(value: str | None) -> str | None:
    if value is None or value == "":
        return None
    try:
        if not DATE_PATTERN.fullmatch(value):
            raise ValueError
        return date.fromisoformat(value).isoformat()
    except ValueError:
        raise BoardError("Due date must be a valid YYYY-MM-DD date") from None


def _labels(values: list[str]) -> str:
    labels = []
    for value in values:
        label = _text(value, "Label", LABEL_MAX_LENGTH)
        if label.lower() not in (existing.lower() for existing in labels):
            labels.append(label)
    if len(labels) > MAX_LABELS:
        raise BoardError(f"A card can have at most {MAX_LABELS} labels")
    return json.dumps(labels)


CARD_FIELDS = {
    "title": ("title", _title),
    "details": ("details", _details),
    "priority": ("priority", _priority),
    "dueDate": ("due_date", _due_date),
    "labels": ("labels", _labels),
}


class BoardStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    # Boards

    def list_boards(self, user_id: str) -> list[dict]:
        with self.database.transaction() as db:
            return self._summaries(db, user_id)

    def _summaries(self, db: sqlite3.Connection, user_id: str) -> list[dict]:
        """Owned boards first, then boards shared with the user, each by creation time."""
        if not db.execute("SELECT 1 FROM boards WHERE user_id = ?", (user_id,)).fetchone():
            self._create_board(db, user_id, DEFAULT_BOARD_NAME)
        rows = db.execute(
            """SELECT boards.id, boards.name, boards.created_at, owner.username AS owner,
                      CASE WHEN boards.user_id = :user THEN 'owner' ELSE member.role END AS role,
                      (SELECT count(*) FROM cards WHERE cards.board_id = boards.id AND archived_at IS NULL) AS cards
               FROM boards
               JOIN users AS owner ON owner.id = boards.user_id
               LEFT JOIN board_members AS member
                 ON member.board_id = boards.id AND member.user_id = :user
               WHERE boards.user_id = :user OR member.user_id IS NOT NULL
               ORDER BY boards.user_id != :user, boards.created_at, boards.rowid""",
            {"user": user_id},
        ).fetchall()
        return [
            {"id": row["id"], "name": row["name"], "createdAt": row["created_at"],
             "cardCount": row["cards"], "role": row["role"], "owner": row["owner"]}
            for row in rows
        ]

    def create_board(self, user_id: str, name: str) -> dict:
        with self.database.transaction() as db:
            board_id = self._create_board(db, user_id, name)
            self._log(db, board_id, user_id, "create_board", "created the board")
            return self._snapshot(db, board_id, "owner")

    def _create_board(self, db: sqlite3.Connection, user_id: str, name: str) -> str:
        board_id = f"board-{uuid4().hex}"
        db.execute(
            "INSERT INTO boards (id, user_id, name, created_at) VALUES (?, ?, ?, ?)",
            (board_id, user_id, _text(name, "Board name", BOARD_NAME_MAX_LENGTH), now()),
        )
        db.executemany(
            "INSERT INTO columns (board_id, id, position, title) VALUES (?, ?, ?, ?)",
            [(board_id, column_id, position, title)
             for position, (column_id, title) in enumerate(DEFAULT_COLUMNS)],
        )
        return board_id

    def rename_board(self, user_id: str, board_id: str, name: str) -> dict:
        with self.database.transaction() as db:
            self._require(db, user_id, board_id, ("owner",))
            name = _text(name, "Board name", BOARD_NAME_MAX_LENGTH)
            db.execute("UPDATE boards SET name = ? WHERE id = ?", (name, board_id))
            self._log(db, board_id, user_id, "rename_board", f'renamed the board to "{name}"')
            return self._snapshot(db, board_id, "owner")

    def delete_board(self, user_id: str, board_id: str) -> list[dict]:
        with self.database.transaction() as db:
            self._require(db, user_id, board_id, ("owner",))
            count = db.execute(
                "SELECT count(*) FROM boards WHERE user_id = ?", (user_id,)
            ).fetchone()[0]
            if count == 1:
                raise BoardError("You must keep at least one board")
            db.execute("DELETE FROM boards WHERE id = ?", (board_id,))
            return self._summaries(db, user_id)

    def get(self, user_id: str, board_id: str) -> dict:
        with self.database.transaction() as db:
            return self._snapshot(db, board_id, self._access(db, user_id, board_id))

    def apply_operations(
        self, user_id: str, board_id: str, operations: list[dict], source: str = "user"
    ) -> dict:
        with self.database.transaction() as db:
            role = self._require(db, user_id, board_id, WRITE_ROLES)
            for operation in operations:
                handler = getattr(self, f"_op_{operation['type']}", None)
                if handler is None:
                    raise BoardError("Unknown board operation")
                card_id, summary = handler(db, board_id, operation)
                self._log(db, board_id, user_id, operation["type"], summary, source, card_id)
            return self._snapshot(db, board_id, role)

    # My work

    def my_work(self, user_id: str) -> list[dict]:
        """Open cards assigned to the user on any board, soonest due first.

        Cards in a board's last column count as done and are left out, as in the board stats.
        Assignees are always board members, so no separate access check is needed.
        """
        with self.database.transaction() as db:
            rows = db.execute(
                """SELECT cards.id, cards.title, cards.priority, cards.due_date, cards.labels,
                          boards.id AS board_id, boards.name AS board_name, columns.title AS column_title,
                          (SELECT count(*) FROM checklist_items WHERE card_id = cards.id) AS items,
                          (SELECT count(*) FROM checklist_items WHERE card_id = cards.id AND done) AS done_items
                   FROM cards
                   JOIN boards ON boards.id = cards.board_id
                   JOIN columns ON columns.board_id = cards.board_id AND columns.id = cards.column_id
                   WHERE cards.assignee_id = :user AND cards.archived_at IS NULL
                     AND columns.position < (SELECT max(position) FROM columns AS last
                                             WHERE last.board_id = cards.board_id)
                   ORDER BY cards.due_date IS NULL, cards.due_date,
                            CASE cards.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                            boards.name COLLATE NOCASE, cards.title COLLATE NOCASE""",
                {"user": user_id},
            ).fetchall()
        return [
            {"boardId": row["board_id"], "boardName": row["board_name"], "cardId": row["id"],
             "title": row["title"], "column": row["column_title"], "priority": row["priority"],
             "dueDate": row["due_date"], "labels": json.loads(row["labels"]),
             "checklistDone": row["done_items"], "checklistTotal": row["items"]}
            for row in rows
        ]

    # Comments and activity

    def comments(self, user_id: str, board_id: str, card_id: str) -> list[dict]:
        with self.database.transaction() as db:
            self._access(db, user_id, board_id)
            self._card(db, board_id, card_id)
            return self._comments(db, card_id)

    def add_comment(self, user_id: str, board_id: str, card_id: str, body: str) -> list[dict]:
        """Any member, including viewers, may comment."""
        body = _text(body, "Comment", COMMENT_MAX_LENGTH)
        with self.database.transaction() as db:
            self._access(db, user_id, board_id)
            card = self._card(db, board_id, card_id)
            db.execute(
                "INSERT INTO card_comments (id, card_id, user_id, body, created_at) VALUES (?, ?, ?, ?, ?)",
                (f"comment-{uuid4().hex}", card_id, user_id, body, now()),
            )
            self._log(db, board_id, user_id, "comment", f'commented on "{card["title"]}"', card_id=card_id)
            return self._comments(db, card_id)

    def delete_comment(self, user_id: str, board_id: str, card_id: str, comment_id: str) -> list[dict]:
        """Authors delete their own comments; the board owner may delete any."""
        with self.database.transaction() as db:
            role = self._access(db, user_id, board_id)
            self._card(db, board_id, card_id)
            row = db.execute(
                "SELECT user_id FROM card_comments WHERE id = ? AND card_id = ?", (comment_id, card_id)
            ).fetchone()
            if not row:
                raise BoardNotFound("Comment not found")
            if row["user_id"] != user_id and role != "owner":
                raise BoardForbidden("You can only delete your own comments")
            db.execute("DELETE FROM card_comments WHERE id = ?", (comment_id,))
            return self._comments(db, card_id)

    def activity(self, user_id: str, board_id: str, card_id: str | None = None) -> list[dict]:
        """Newest first; limited to the latest entries, optionally for one card."""
        with self.database.transaction() as db:
            self._access(db, user_id, board_id)
            rows = db.execute(
                """SELECT activity.*, users.username FROM activity
                   LEFT JOIN users ON users.id = activity.user_id
                   WHERE board_id = :board AND (:card IS NULL OR card_id = :card)
                   ORDER BY activity.id DESC LIMIT :limit""",
                {"board": board_id, "card": card_id, "limit": ACTIVITY_LIMIT},
            ).fetchall()
        return [
            {"id": row["id"], "cardId": row["card_id"], "username": row["username"],
             "action": row["action"], "summary": row["summary"], "source": row["source"],
             "createdAt": row["created_at"]}
            for row in rows
        ]

    def archived(self, user_id: str, board_id: str) -> list[dict]:
        """Archived cards, most recently archived first (any member)."""
        with self.database.transaction() as db:
            self._access(db, user_id, board_id)
            rows = db.execute(
                """SELECT cards.id, cards.title, cards.archived_at, columns.title AS column_title
                   FROM cards JOIN columns
                     ON columns.board_id = cards.board_id AND columns.id = cards.column_id
                   WHERE cards.board_id = ? AND cards.archived_at IS NOT NULL
                   ORDER BY cards.archived_at DESC""",
                (board_id,),
            ).fetchall()
        return [
            {"id": row["id"], "title": row["title"], "column": row["column_title"],
             "archivedAt": row["archived_at"]}
            for row in rows
        ]

    def _comments(self, db: sqlite3.Connection, card_id: str) -> list[dict]:
        rows = db.execute(
            """SELECT card_comments.*, users.username FROM card_comments
               LEFT JOIN users ON users.id = card_comments.user_id
               WHERE card_id = ? ORDER BY card_comments.created_at, card_comments.rowid""",
            (card_id,),
        ).fetchall()
        return [
            {"id": row["id"], "userId": row["user_id"], "username": row["username"],
             "body": row["body"], "createdAt": row["created_at"]}
            for row in rows
        ]

    def _log(
        self, db: sqlite3.Connection, board_id: str, user_id: str, action: str, summary: str,
        source: str = "user", card_id: str | None = None,
    ) -> None:
        db.execute(
            """INSERT INTO activity (board_id, card_id, user_id, action, summary, source, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)""",
            (board_id, card_id, user_id, action, summary, source, now()),
        )

    # Sharing

    def share(self, user_id: str, board_id: str, username: str, role: str) -> dict:
        """Add a member or change their role; only the owner may do this."""
        if role not in MEMBER_ROLES:
            raise BoardError("Role must be editor or viewer")
        with self.database.transaction() as db:
            self._require(db, user_id, board_id, ("owner",))
            member = db.execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()
            if not member:
                raise BoardNotFound("User not found")
            if member["id"] == user_id:
                raise BoardError("The owner already has full access")
            db.execute(
                """INSERT INTO board_members (board_id, user_id, role) VALUES (?, ?, ?)
                   ON CONFLICT (board_id, user_id) DO UPDATE SET role = excluded.role""",
                (board_id, member["id"], role),
            )
            self._log(db, board_id, user_id, "share", f"gave {username} {role} access")
            return self._snapshot(db, board_id, "owner")

    def remove_member(self, user_id: str, board_id: str, member_id: str) -> dict:
        with self.database.transaction() as db:
            self._require(db, user_id, board_id, ("owner",))
            username = self._drop_member(db, board_id, member_id)
            self._log(db, board_id, user_id, "remove_member", f"removed {username} from the board")
            return self._snapshot(db, board_id, "owner")

    def leave(self, user_id: str, board_id: str) -> list[dict]:
        with self.database.transaction() as db:
            if self._access(db, user_id, board_id) == "owner":
                raise BoardError("Owners cannot leave their own board")
            self._drop_member(db, board_id, user_id)
            self._log(db, board_id, user_id, "leave", "left the board")
            return self._summaries(db, user_id)

    def _drop_member(self, db: sqlite3.Connection, board_id: str, member_id: str) -> str:
        row = db.execute(
            """SELECT users.username FROM board_members JOIN users ON users.id = board_members.user_id
               WHERE board_id = ? AND user_id = ?""",
            (board_id, member_id),
        ).fetchone()
        if not row:
            raise BoardNotFound("Member not found")
        db.execute("DELETE FROM board_members WHERE board_id = ? AND user_id = ?", (board_id, member_id))
        db.execute(
            "UPDATE cards SET assignee_id = NULL WHERE board_id = ? AND assignee_id = ?",
            (board_id, member_id),
        )
        return row["username"]

    # Helpers

    def _access(self, db: sqlite3.Connection, user_id: str, board_id: str) -> str:
        """Return the user's role on the board; boards they cannot see do not exist."""
        row = db.execute(
            """SELECT CASE WHEN boards.user_id = :user THEN 'owner' ELSE member.role END AS role
               FROM boards LEFT JOIN board_members AS member
                 ON member.board_id = boards.id AND member.user_id = :user
               WHERE boards.id = :board""",
            {"user": user_id, "board": board_id},
        ).fetchone()
        if not row or row["role"] is None:
            raise BoardNotFound("Board not found")
        return row["role"]

    def _require(self, db: sqlite3.Connection, user_id: str, board_id: str, roles: tuple) -> str:
        role = self._access(db, user_id, board_id)
        if role not in roles:
            raise BoardForbidden(
                "Only the board owner can do that" if roles == ("owner",)
                else "You have view-only access to this board"
            )
        return role

    def _members(self, db: sqlite3.Connection, board_id: str) -> list[dict]:
        owner = db.execute(
            """SELECT users.id, users.username, 'owner' AS role FROM boards
               JOIN users ON users.id = boards.user_id WHERE boards.id = ?""",
            (board_id,),
        ).fetchall()
        members = db.execute(
            """SELECT users.id, users.username, board_members.role FROM board_members
               JOIN users ON users.id = board_members.user_id
               WHERE board_members.board_id = ? ORDER BY users.username COLLATE NOCASE""",
            (board_id,),
        ).fetchall()
        return [{"id": row["id"], "username": row["username"], "role": row["role"]}
                for row in [*owner, *members]]

    def _assignee(self, db: sqlite3.Connection, board_id: str, user_id: str | None) -> str | None:
        if user_id is None or user_id == "":
            return None
        if user_id not in (member["id"] for member in self._members(db, board_id)):
            raise BoardError("Assignee must be a board member")
        return user_id

    def _column_ids(self, db: sqlite3.Connection, board_id: str) -> list[str]:
        rows = db.execute(
            "SELECT id FROM columns WHERE board_id = ? ORDER BY position, id", (board_id,)
        ).fetchall()
        return [row["id"] for row in rows]

    def _column(self, db: sqlite3.Connection, board_id: str, column_id: str) -> str:
        """Return the column's title."""
        row = db.execute(
            "SELECT title FROM columns WHERE board_id = ? AND id = ?", (board_id, column_id)
        ).fetchone()
        if not row:
            raise BoardNotFound("Column not found")
        return row["title"]

    def _card(
        self, db: sqlite3.Connection, board_id: str, card_id: str, archived: bool | None = False
    ) -> sqlite3.Row:
        """Find an active card, an archived one (`archived=True`), or either (`None`)."""
        row = db.execute(
            """SELECT * FROM cards WHERE board_id = ? AND id = ?
               AND (? IS NULL OR (archived_at IS NOT NULL) = ?)""",
            (board_id, card_id, archived, archived),
        ).fetchone()
        if not row:
            raise BoardNotFound("Card not found")
        return row

    def _card_ids(self, db: sqlite3.Connection, board_id: str, column_id: str) -> list[str]:
        rows = db.execute(
            """SELECT id FROM cards WHERE board_id = ? AND column_id = ? AND archived_at IS NULL
               ORDER BY position, id""",
            (board_id, column_id),
        ).fetchall()
        return [row["id"] for row in rows]

    def _set_positions(self, db: sqlite3.Connection, table: str, board_id: str, ids: list[str]) -> None:
        db.executemany(
            f"UPDATE {table} SET position = ? WHERE board_id = ? AND id = ?",
            [(position, board_id, item_id) for position, item_id in enumerate(ids)],
        )

    def _snapshot(self, db: sqlite3.Connection, board_id: str, role: str) -> dict:
        board = db.execute("SELECT id, name FROM boards WHERE id = ?", (board_id,)).fetchone()
        columns = db.execute(
            "SELECT id, title FROM columns WHERE board_id = ? ORDER BY position, id", (board_id,)
        ).fetchall()
        cards = db.execute(
            """SELECT cards.*, (SELECT count(*) FROM card_comments WHERE card_id = cards.id) AS comments
               FROM cards WHERE board_id = ? AND archived_at IS NULL ORDER BY position, id""",
            (board_id,),
        ).fetchall()
        checklists: dict[str, list[dict]] = {card["id"]: [] for card in cards}
        for item in db.execute(
            """SELECT checklist_items.* FROM checklist_items
               JOIN cards ON cards.id = checklist_items.card_id
               WHERE cards.board_id = ? ORDER BY checklist_items.rowid""",
            (board_id,),
        ):
            checklists[item["card_id"]].append(
                {"id": item["id"], "text": item["text"], "done": bool(item["done"])}
            )
        return {
            "id": board["id"],
            "name": board["name"],
            "role": role,
            "members": self._members(db, board_id),
            "columns": [
                {"id": column["id"], "title": column["title"],
                 "cardIds": [card["id"] for card in cards if card["column_id"] == column["id"]]}
                for column in columns
            ],
            "cards": {
                card["id"]: {
                    "id": card["id"], "title": card["title"], "details": card["details"],
                    "priority": card["priority"], "dueDate": card["due_date"],
                    "labels": json.loads(card["labels"]), "assigneeId": card["assignee_id"],
                    "commentCount": card["comments"], "checklist": checklists[card["id"]],
                }
                for card in cards
            },
        }

    # Operations: each returns (card_id or None, activity summary).

    def _op_add_column(self, db: sqlite3.Connection, board_id: str, op: dict) -> Logged:
        title = _title(op["title"])
        position = len(self._column_ids(db, board_id))
        if position >= MAX_COLUMNS:
            raise BoardError(f"A board can have at most {MAX_COLUMNS} columns")
        db.execute(
            "INSERT INTO columns (board_id, id, position, title) VALUES (?, ?, ?, ?)",
            (board_id, f"col-{uuid4().hex}", position, title),
        )
        return None, f'added column "{title}"'

    def _op_rename_column(self, db: sqlite3.Connection, board_id: str, op: dict) -> Logged:
        title = _title(op["title"])
        old = self._column(db, board_id, op["columnId"])
        db.execute(
            "UPDATE columns SET title = ? WHERE board_id = ? AND id = ?",
            (title, board_id, op["columnId"]),
        )
        return None, f'renamed column "{old}" to "{title}"'

    def _op_delete_column(self, db: sqlite3.Connection, board_id: str, op: dict) -> Logged:
        column_id = op["columnId"]
        title = self._column(db, board_id, column_id)
        remaining = [item for item in self._column_ids(db, board_id) if item != column_id]
        if not remaining:
            raise BoardError("A board must have at least one column")
        count = db.execute(
            "DELETE FROM cards WHERE board_id = ? AND column_id = ?", (board_id, column_id)
        ).rowcount
        db.execute("DELETE FROM columns WHERE board_id = ? AND id = ?", (board_id, column_id))
        self._set_positions(db, "columns", board_id, remaining)
        return None, f'deleted column "{title}" and {count} card(s)'

    def _op_move_column(self, db: sqlite3.Connection, board_id: str, op: dict) -> Logged:
        column_id = op["columnId"]
        title = self._column(db, board_id, column_id)
        ids = [item for item in self._column_ids(db, board_id) if item != column_id]
        if not 0 <= op["toIndex"] <= len(ids):
            raise BoardError("Invalid column position")
        ids.insert(op["toIndex"], column_id)
        self._set_positions(db, "columns", board_id, ids)
        return None, f'moved column "{title}" to position {op["toIndex"] + 1}'

    def _op_add_card(self, db: sqlite3.Connection, board_id: str, op: dict) -> Logged:
        column_id = op["columnId"]
        title = _title(op["title"])
        column = self._column(db, board_id, column_id)
        timestamp = now()
        card_id = f"card-{uuid4().hex}"
        db.execute(
            """INSERT INTO cards (id, board_id, column_id, position, title, details, priority,
                                  due_date, labels, assignee_id, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (card_id, board_id, column_id,
             len(self._card_ids(db, board_id, column_id)), title,
             _details(op.get("details", "")), _priority(op.get("priority", "medium")),
             _due_date(op.get("dueDate")), _labels(op.get("labels", [])),
             self._assignee(db, board_id, op.get("assigneeId")), timestamp, timestamp),
        )
        return card_id, f'added card "{title}" to {column}'

    def _op_edit_card(self, db: sqlite3.Connection, board_id: str, op: dict) -> Logged:
        changes = {
            column: validate(op[field])
            for field, (column, validate) in CARD_FIELDS.items() if field in op
        }
        if "assigneeId" in op:
            changes["assignee_id"] = self._assignee(db, board_id, op["assigneeId"])
        card = self._card(db, board_id, op["cardId"])
        if changes:
            assignments = ", ".join(f"{column} = ?" for column in changes)
            db.execute(
                f"UPDATE cards SET {assignments}, updated_at = ? WHERE board_id = ? AND id = ?",
                (*changes.values(), now(), board_id, op["cardId"]),
            )
        return card["id"], f'edited card "{changes.get("title", card["title"])}"'

    def _op_delete_card(self, db: sqlite3.Connection, board_id: str, op: dict) -> Logged:
        """Delete permanently; works on active and archived cards."""
        card = self._card(db, board_id, op["cardId"], archived=None)
        db.execute("DELETE FROM cards WHERE board_id = ? AND id = ?", (board_id, card["id"]))
        self._set_positions(db, "cards", board_id, self._card_ids(db, board_id, card["column_id"]))
        return card["id"], f'deleted card "{card["title"]}"'

    def _op_move_card(self, db: sqlite3.Connection, board_id: str, op: dict) -> Logged:
        card_id = op["cardId"]
        to_column_id = op["toColumnId"]
        card = self._card(db, board_id, card_id)
        column = self._column(db, board_id, to_column_id)
        from_column_id = card["column_id"]
        from_ids = self._card_ids(db, board_id, from_column_id)
        from_ids.remove(card_id)
        same = from_column_id == to_column_id
        to_ids = from_ids if same else self._card_ids(db, board_id, to_column_id)
        if not 0 <= op["toIndex"] <= len(to_ids):
            raise BoardError("Invalid card position")
        to_ids.insert(op["toIndex"], card_id)
        db.execute(
            "UPDATE cards SET column_id = ? WHERE board_id = ? AND id = ?",
            (to_column_id, board_id, card_id),
        )
        self._set_positions(db, "cards", board_id, from_ids)
        if not same:
            self._set_positions(db, "cards", board_id, to_ids)
        verb = "reordered" if same else "moved"
        return card_id, f'{verb} card "{card["title"]}" {"in" if same else "to"} {column}'

    # Checklist operations

    def _checklist_item(self, db: sqlite3.Connection, card_id: str, item_id: str) -> sqlite3.Row:
        row = db.execute(
            "SELECT * FROM checklist_items WHERE id = ? AND card_id = ?", (item_id, card_id)
        ).fetchone()
        if not row:
            raise BoardNotFound("Checklist item not found")
        return row

    def _op_add_checklist_item(self, db: sqlite3.Connection, board_id: str, op: dict) -> Logged:
        card = self._card(db, board_id, op["cardId"])
        text = _text(op["text"], "Checklist item", TITLE_MAX_LENGTH)
        count = db.execute(
            "SELECT count(*) FROM checklist_items WHERE card_id = ?", (card["id"],)
        ).fetchone()[0]
        if count >= CHECKLIST_MAX_ITEMS:
            raise BoardError(f"A checklist can have at most {CHECKLIST_MAX_ITEMS} items")
        db.execute(
            "INSERT INTO checklist_items (id, card_id, text) VALUES (?, ?, ?)",
            (f"item-{uuid4().hex}", card["id"], text),
        )
        return card["id"], f'added "{text}" to the checklist on "{card["title"]}"'

    def _op_edit_checklist_item(self, db: sqlite3.Connection, board_id: str, op: dict) -> Logged:
        """Change an item's text and/or done state; omitted fields stay as they are."""
        card = self._card(db, board_id, op["cardId"])
        item = self._checklist_item(db, card["id"], op["itemId"])
        text = _text(op["text"], "Checklist item", TITLE_MAX_LENGTH) if "text" in op else item["text"]
        done = bool(op["done"]) if "done" in op else bool(item["done"])
        db.execute(
            "UPDATE checklist_items SET text = ?, done = ? WHERE id = ?", (text, int(done), item["id"])
        )
        if text != item["text"]:
            summary = f'renamed checklist item "{item["text"]}" to "{text}" on "{card["title"]}"'
        else:
            summary = f'{"checked" if done else "unchecked"} "{text}" on "{card["title"]}"'
        return card["id"], summary

    def _op_delete_checklist_item(self, db: sqlite3.Connection, board_id: str, op: dict) -> Logged:
        card = self._card(db, board_id, op["cardId"])
        item = self._checklist_item(db, card["id"], op["itemId"])
        db.execute("DELETE FROM checklist_items WHERE id = ?", (item["id"],))
        return card["id"], f'removed "{item["text"]}" from the checklist on "{card["title"]}"'

    # Archive operations

    def _op_archive_card(self, db: sqlite3.Connection, board_id: str, op: dict) -> Logged:
        card = self._card(db, board_id, op["cardId"])
        # Microseconds keep cards archived within the same second in archive order.
        db.execute(
            "UPDATE cards SET archived_at = ? WHERE id = ?", (now("microseconds"), card["id"])
        )
        self._set_positions(db, "cards", board_id, self._card_ids(db, board_id, card["column_id"]))
        return card["id"], f'archived card "{card["title"]}"'

    def _op_restore_card(self, db: sqlite3.Connection, board_id: str, op: dict) -> Logged:
        """Return an archived card to the end of its column."""
        card = self._card(db, board_id, op["cardId"], archived=True)
        position = len(self._card_ids(db, board_id, card["column_id"]))
        db.execute(
            "UPDATE cards SET archived_at = NULL, position = ? WHERE id = ?", (position, card["id"])
        )
        column = self._column(db, board_id, card["column_id"])
        return card["id"], f'restored card "{card["title"]}" to {column}'
