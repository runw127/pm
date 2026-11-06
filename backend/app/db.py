import sqlite3
from contextlib import closing, contextmanager
from datetime import UTC, datetime
from pathlib import Path

SCHEMA_VERSION = 6

TABLES = (
    """CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(username)) > 0),
        password_hash TEXT,
        is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at REAL NOT NULL
    )""",
    """CREATE TABLE boards (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name TEXT NOT NULL CHECK (length(trim(name)) > 0),
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE columns (
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        PRIMARY KEY (board_id, id)
    )""",
    """CREATE TABLE cards (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        column_id TEXT NOT NULL,
        position INTEGER NOT NULL CHECK (position >= 0),
        title TEXT NOT NULL CHECK (length(trim(title)) > 0),
        details TEXT NOT NULL DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
        due_date TEXT,
        labels TEXT NOT NULL DEFAULT '[]',
        assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (board_id, column_id) REFERENCES columns(board_id, id) ON DELETE CASCADE
    )""",
    """CREATE TABLE board_members (
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
        PRIMARY KEY (board_id, user_id)
    )""",
    "CREATE INDEX boards_by_user ON boards(user_id, created_at)",
    "CREATE INDEX members_by_user ON board_members(user_id)",
    "CREATE INDEX sessions_by_user ON sessions(user_id)",
    "CREATE INDEX cards_in_column ON cards(board_id, column_id, position, id)",
)

# Added in version 4. Activity rows keep card_id without a foreign key so history
# survives card deletion; authors become NULL when their account is deleted.
V4_TABLES = (
    """CREATE TABLE card_comments (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        body TEXT NOT NULL CHECK (length(trim(body)) > 0),
        created_at TEXT NOT NULL
    )""",
    """CREATE TABLE activity (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
        card_id TEXT,
        user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        summary TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('user', 'ai')),
        created_at TEXT NOT NULL
    )""",
    "CREATE INDEX comments_by_card ON card_comments(card_id, created_at)",
    "CREATE INDEX activity_by_board ON activity(board_id, id)",
)
# Added in version 5. Items keep insertion order (rowid).
V5_TABLES = (
    """CREATE TABLE checklist_items (
        id TEXT PRIMARY KEY,
        card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        text TEXT NOT NULL CHECK (length(trim(text)) > 0),
        done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1))
    )""",
    "CREATE INDEX checklist_by_card ON checklist_items(card_id)",
)
TABLES = (*TABLES, *V4_TABLES, *V5_TABLES)

# Added in version 6: archived cards keep their column but leave its ordering.
V6_COLUMNS = ("ALTER TABLE cards ADD COLUMN archived_at TEXT",)

# Each older version migrates directly to the current schema.
# Version 1 had one board per user, five fixed columns, and file-based sessions.
MIGRATE_V1 = (
    "ALTER TABLE cards RENAME TO cards_v1",
    "ALTER TABLE columns RENAME TO columns_v1",
    "ALTER TABLE boards RENAME TO boards_v1",
    "ALTER TABLE users RENAME TO users_v1",
    "DROP INDEX cards_in_column",
    *TABLES,
    "INSERT INTO users (id, username, created_at) SELECT id, username, :now FROM users_v1",
    "INSERT INTO boards (id, user_id, name, created_at) SELECT id, user_id, 'My board', :now FROM boards_v1",
    "INSERT INTO columns (board_id, id, position, title) SELECT board_id, id, slot, title FROM columns_v1",
    """INSERT INTO cards (id, board_id, column_id, position, title, details, created_at, updated_at)
       SELECT id, board_id, column_id, position, title, details, :now, :now FROM cards_v1""",
    "DROP TABLE cards_v1",
    "DROP TABLE columns_v1",
    "DROP TABLE boards_v1",
    "DROP TABLE users_v1",
)

# Version 2 lacked board sharing, card assignees, comments, activity, and checklists.
MIGRATE_V2 = (
    "ALTER TABLE cards ADD COLUMN assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL",
    *(statement for statement in TABLES if "board_members" in statement),
    *V4_TABLES,
    *V5_TABLES,
    *V6_COLUMNS,
)

MIGRATIONS = {
    0: TABLES,
    1: MIGRATE_V1,
    2: MIGRATE_V2,
    3: (*V4_TABLES, *V5_TABLES, *V6_COLUMNS),
    4: (*V5_TABLES, *V6_COLUMNS),
    5: V6_COLUMNS,
    SCHEMA_VERSION: (),
}


def now(timespec: str = "seconds") -> str:
    return datetime.now(UTC).isoformat(timespec=timespec)


class Database:
    def __init__(self, path: Path) -> None:
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(path)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in MIGRATIONS:
                raise RuntimeError(f"Unsupported board database version: {version}")
            for statement in MIGRATIONS[version]:
                db.execute(statement, {"now": now()} if ":now" in statement else ())
            db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")

    @contextmanager
    def transaction(self):
        with closing(sqlite3.connect(self.path)) as db:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA foreign_keys = ON")
            with db:
                db.execute("BEGIN IMMEDIATE")
                yield db
