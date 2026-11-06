# Data model (schema version 6)

SQLite file: `data/board.sqlite3` in the mounted data directory, so it survives container restarts. `app/db.py` creates the schema on a missing database and migrates older versions; every connection enables `PRAGMA foreign_keys = ON`.

## Tables

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE CHECK (length(trim(username)) > 0),
  password_hash TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at REAL NOT NULL
);

CREATE TABLE boards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  created_at TEXT NOT NULL
);

CREATE TABLE columns (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  position INTEGER NOT NULL CHECK (position >= 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  PRIMARY KEY (board_id, id)
);

CREATE TABLE cards (
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
);

CREATE TABLE board_members (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  PRIMARY KEY (board_id, user_id)
);

CREATE INDEX boards_by_user ON boards(user_id, created_at);

CREATE INDEX members_by_user ON board_members(user_id);

CREATE INDEX sessions_by_user ON sessions(user_id);

CREATE INDEX cards_in_column ON cards(board_id, column_id, position, id);

CREATE TABLE card_comments (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL CHECK (length(trim(body)) > 0),
  created_at TEXT NOT NULL
);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  card_id TEXT,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  summary TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('user', 'ai')),
  created_at TEXT NOT NULL
);

CREATE INDEX comments_by_card ON card_comments(card_id, created_at);

CREATE INDEX activity_by_board ON activity(board_id, id);

CREATE TABLE checklist_items (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
  text TEXT NOT NULL CHECK (length(trim(text)) > 0),
  done INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1))
);

CREATE INDEX checklist_by_card ON checklist_items(card_id);
```

- **users**: usernames are unique case-insensitively. `password_hash` is `scrypt$<salt hex>$<digest hex>`; a null hash means the account cannot sign in (only possible for rows migrated from version 1). `is_admin` grants the `/api/admin` routes.
- **sessions**: opaque 30-day tokens sent in the HTTP-only `pm_session` cookie. Only the token's SHA-256 is stored. Deleting a user cascades to their sessions, boards, columns, and cards.
- **boards**: a user owns any number of boards, ordered by creation time. A user always keeps at least one: the first board listing creates `My board` when none exists, and deleting the last board is rejected.
- **columns**: `position` orders columns. New boards start with five columns (`col-backlog`, `col-discovery`, `col-progress`, `col-review`, `col-done`); later columns get generated `col-<hex>` IDs. Column IDs are unique within a board, not globally. A board has 1-12 columns.
- **board_members**: shares a board with another user as `editor` (edit cards and columns) or `viewer` (read only). The owner is `boards.user_id` and is never stored here.
- **cards**: `position` orders cards within a column. `priority` is `low`, `medium` (default), or `high`; `due_date` is `YYYY-MM-DD` or null; `labels` is a JSON array of up to 10 unique (case-insensitive) labels of at most 30 characters. `assignee_id` must be the owner or a member of the board; it is cleared when that person leaves, is removed, or deletes their account. The composite foreign key keeps a card on its own board. `archived_at` (microsecond UTC timestamp) marks an archived card: it leaves the snapshot, column ordering, board card counts, and My work, and can only be restored or deleted. Restoring appends it to its column; deleting a column also deletes its archived cards.

- **card_comments**: comments of up to 2,000 characters. Any board member, viewers included, may comment. Authors delete their own comments, and the owner may delete any. Comments are removed with their card; the author becomes null (shown as "Deleted user") if the account is deleted.
- **activity**: one row per change: card and column operations, board creation and rename, sharing changes, leaving, and comments. Each row has the acting user, `source` (`user` or `ai`), and a readable `summary` such as `moved card "Plan" to Done`. `card_id` has no foreign key, so history survives card deletion.
- **checklist_items**: up to 30 items of at most 200 characters per card, kept in insertion order. Owners and editors add, check, rename, and remove items (viewers get 403); each change is logged, for example `checked "Tag build" on "Release"`. Items are removed with their card.

Positions are renumbered to consecutive values in the same transaction after every add, delete, or move. There is no uniqueness constraint on positions, because renumbering under one would need temporary values.

## Board JSON

[board.example.json](./board.example.json) is a representative `GET /api/boards/{boardId}` response:

- `id` and `name` identify the board; `role` is the signed-in user's role (`owner`, `editor`, or `viewer`).
- `members` lists `{id, username, role}`, with the owner first.
- `columns` is ordered by `position`; each column has `id`, `title`, and ordered `cardIds`.
- `cards` is keyed by card ID; each card has `id`, `title`, `details`, `priority`, `dueDate`, `labels`, `assigneeId` (a member ID or null), `commentCount`, and `checklist` (items `{id, text, done}` in order).

Every board mutation returns this full, authoritative snapshot.

## API

All routes except `/api/hello`, `/api/login`, and `/api/register` need the session cookie; 401 means not signed in.

| Route | Purpose |
| --- | --- |
| `POST /api/register` `{username, password}` | Create a member account and sign in (201). Usernames are 3-32 of `A-Z a-z 0-9 . _ -`; passwords are 8-128 characters. 409 if taken. |
| `POST /api/login`, `GET /api/session`, `POST /api/logout` | Session lifecycle. Login and session return `{id, username, isAdmin}`. |
| `POST /api/account/password` `{currentPassword, newPassword}` | Change password; signs out the user's other sessions. 403 on a wrong current password. |
| `DELETE /api/account` `{password}` | Delete the account and all its boards. 403 on a wrong password. |
| `GET /api/admin/users` | Admin only (403 otherwise): users with `isAdmin`, `createdAt`, `boardCount`. |
| `PATCH /api/admin/users/{id}` `{isAdmin}` | Grant or revoke admin. |
| `POST /api/admin/users/{id}/password` `{password}` | Reset a password and sign that user out everywhere. |
| `DELETE /api/admin/users/{id}` | Delete another user (use account settings for yourself). |
| `GET /api/boards`, `POST /api/boards` `{name}` | List summaries `{id, name, createdAt, cardCount, role, owner}` (owned boards first, then shared); create a board (201, returns snapshot). |
| `GET /api/my-work` | Open cards assigned to you on any board: `{boardId, boardName, cardId, title, column, priority, dueDate, labels, checklistDone, checklistTotal}`, ordered by due date (none last), then priority, board, and title. Cards in a board's last column count as done and are left out. |
| `GET/PATCH/DELETE /api/boards/{boardId}` | Read (any member); rename `{name}` or delete (owner only; delete returns the remaining summaries). |
| `POST /api/boards/{boardId}/members` `{username, role}` | Owner shares the board, or changes a member's role (`editor` or `viewer`). |
| `DELETE /api/boards/{boardId}/members/{userId}` | Owner removes a member. |
| `POST /api/boards/{boardId}/leave` | A member leaves a shared board (returns their summaries). |
| `POST /api/boards/{boardId}/columns` `{title}` | Append a column. |
| `PATCH/DELETE /api/boards/{boardId}/columns/{columnId}` | Rename `{title}`; delete the column and its cards. |
| `POST /api/boards/{boardId}/columns/{columnId}/move` `{toIndex}` | Reorder columns. |
| `POST /api/boards/{boardId}/cards` | `{columnId, title, details?, priority?, dueDate?, labels?, assigneeId?}`; appends to the column. |
| `PATCH /api/boards/{boardId}/cards/{cardId}` | Partial edit of any card field; `null` clears `dueDate` or `assigneeId`. |
| `DELETE /api/boards/{boardId}/cards/{cardId}` | Delete a card. Works on active and archived cards. |
| `POST /api/boards/{boardId}/cards/{cardId}/move` `{toColumnId, toIndex}` | Move or reorder; `toIndex` is zero-based after removing the card. |
| `GET /api/boards/{boardId}/activity[?card_id=]` | Latest 50 entries `{id, cardId, username, action, summary, source, createdAt}`, newest first (any member). |
| `GET/POST /api/boards/{boardId}/cards/{cardId}/comments` | List, or add `{body}` (201); both return the thread `{id, userId, username, body, createdAt}` oldest first. |
| `DELETE /api/boards/{boardId}/cards/{cardId}/comments/{commentId}` | Delete your own comment, or any comment as the owner (403 otherwise). |
| `POST /api/boards/{boardId}/cards/{cardId}/checklist` `{text}` | Add a checklist item; returns the board. |
| `PATCH /api/boards/{boardId}/cards/{cardId}/checklist/{itemId}` `{text?, done?}` | Rename and/or check an item; returns the board. |
| `DELETE /api/boards/{boardId}/cards/{cardId}/checklist/{itemId}` | Remove an item; returns the board. |
| `POST /api/boards/{boardId}/cards/{cardId}/archive` | Archive an active card; returns the board. |
| `POST /api/boards/{boardId}/cards/{cardId}/restore` | Restore an archived card to the end of its column; returns the board. |
| `GET /api/boards/{boardId}/archive` | Archived cards `{id, title, column, archivedAt}`, most recent first (any member). |
| `POST /api/boards/{boardId}/ai/chat` | AI assistant; see [AI_CONTRACT.md](./AI_CONTRACT.md). |

Column, card, and checklist routes require the `owner` or `editor` role. Boards the user cannot see, and missing columns or cards, return 404; a role that is too low returns 403; invalid values return 422 with a `detail` message.

## Ownership and transactions

The session determines the user; clients never send their own user ID. Every board route first resolves the user's role on the board (owner, or a `board_members` row), so boards that are not shared with them return 404. Deleting an account deletes the boards it owns, including any shared with others. Each mutation, and each batch of AI operations, runs in one `BEGIN IMMEDIATE` transaction: either every operation and the final positions commit, or nothing does.

## Accounts and the default admin

When no user has a password (a new database, or one migrated from version 1), startup seeds the admin `user` / `password`. This happens only once, so a changed password survives restarts. At least one admin must remain: the last admin cannot be demoted or deleted.

## Migrations

`PRAGMA user_version` tracks the schema. Migrations run in one transaction at startup, and each older version migrates directly to the current schema.

- 0: create all tables.
- 5 to 6: add `cards.archived_at`.
- 4 to 6: add the `checklist_items` table and `cards.archived_at`.
- 3 to 6: add the `card_comments`, `activity`, and `checklist_items` tables and `cards.archived_at`.
- 2 to 6: add `cards.assignee_id`, `board_members`, `card_comments`, `activity`, `checklist_items`, and `cards.archived_at`.
- 1 to 6: rebuild `users`, `boards`, `columns`, and `cards` from the version 1 tables. Each old board becomes `My board`, column `slot` becomes `position`, and cards get default priority, no due date, and no labels. File-based sessions in `data/sessions/` are no longer read, so users sign in again.

Unknown versions stop startup with an error. Back up `data/board.sqlite3` before upgrading.
