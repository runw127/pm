# Board data model (Parts 5 and 6)

This is the approved SQLite schema implemented in Part 6. The database file is `data/board.sqlite3` in the mounted data directory, so it survives container restarts. Every connection enables `PRAGMA foreign_keys = ON`.

## Tables

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE CHECK (length(trim(username)) > 0)
);

CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE columns (
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
);

CREATE TABLE cards (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  column_id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  details TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (board_id, column_id) REFERENCES columns(board_id, id)
    ON DELETE CASCADE
);

CREATE INDEX cards_in_column ON cards(board_id, column_id, position, id);
```

IDs are stable, opaque strings. Each username is unique, and `boards.user_id` permits one board per user. Column IDs repeat across boards but are unique within a board. The server generates globally unique board and card IDs. The composite card foreign key prevents a card from pointing to another board's column.

The five column slots and IDs are fixed. Titles can change; slots and IDs cannot. The database restricts slots to 0–4 and ties each ID to its slot. Part 6 will insert all five columns in one transaction when it creates a board and will expose no column create, delete, or reorder operation. SQLite constraints alone do not require all five rows to exist, so Part 6 must verify that invariant on read and after writes.

`position` is a zero-based card index within a column. Reads order columns by `slot` and cards by `position, id`. Part 6 will renumber affected columns to consecutive positions inside the same transaction after adding, deleting, moving, or reordering cards. The index supports ordered reads. There is no uniqueness constraint on `position` because renumbering multiple rows under a SQLite unique constraint would require temporary positions; the service must validate unique, consecutive positions before commit.

## Board JSON and API shape

[board.example.json](./board.example.json) is a representative response for the current frontend `BoardData` type. The response has exactly `columns` and `cards` at its root. Each column has `id`, `title`, and an ordered `cardIds` array. `cards` is keyed by card ID; each value has `id`, `title`, and `details`. An empty column has `cardIds: []`. The authenticated user is determined by the session, so no user ID is needed in the board response.

The mapping is: `users` → `boards` by `user_id`, `boards` → `columns` by `board_id`, and `columns` → `cards` by `(board_id, column_id)`. The column `slot` determines array order; each card's `position` determines its place in `cardIds`. Every card appears in exactly one column array and once in the `cards` map. The API must not accept a client-supplied user or board owner. Part 6 mutation endpoints should return the same authoritative board shape after a successful change; Part 9 can reuse it after a batch of AI operations.

Proposed mutation inputs are `rename column {columnId, title}`, `add card {columnId, title, details}`, `edit card {cardId, title, details}`, `delete card {cardId}`, and `move card {cardId, toColumnId, toIndex}`. Add appends to the chosen column; `toIndex` is a zero-based insertion position, including the end. A move within the same column also covers reordering. The server derives the user's board from the session and generates new card IDs. Part 9 can apply an ordered list of these operations in one transaction.

Part 6 routes are `GET /api/board`, `PATCH /api/board/columns/{column_id}`, `POST /api/board/cards`, `PATCH /api/board/cards/{card_id}`, `DELETE /api/board/cards/{card_id}`, and `POST /api/board/cards/{card_id}/move`. Every route requires the existing session cookie. Mutation responses contain the full updated board. Missing cards or columns return 404; invalid titles or positions return 422.

## Ownership, creation, and transactions

Part 4's 30-day, HTTP-only sessions remain in `data/sessions/`; a SQLite sessions table is not needed for this model. The existing authentication dependency supplies a username. Part 6 resolves that username to a `users.id` and selects the board through `boards.user_id`. For the MVP, only `user` can sign in. A future authentication change can add another user without changing the board schema. A second user gets a separate board, may use the same five column IDs, and cannot read or mutate the first user's board or cards.

On a user's first board request, Part 6 creates the user row if needed, then the board and all five default columns in one transaction. A missing database gets the schema first. Existing boards are returned without reseeding or overwriting edits. Generated board and card IDs must never be reused after deletion. API mutations must validate requested card and column IDs against the signed-in user's board; unknown and foreign IDs are rejected. Multi-card AI changes run in one transaction: either all validated operations and final positions commit, or none do. An empty column requires no card rows.

## Migrations

Use SQLite `PRAGMA user_version` to track the schema version. Part 6 creates version 1 on a missing database. Later schema changes should run versioned migrations in a transaction, increment `user_version` only after success, and preserve existing user boards. Do not rebuild the database on startup. Back up the mounted database before any future migration that changes stored data.
