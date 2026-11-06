# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `AGENTS.md` first: it holds the business requirements, technical decisions, color scheme, coding standards (simplicity, no emojis, root-cause debugging), and the required final task report format. `docs/PLAN.md` is the part-by-part plan; check boxes there only after a part's tests and success criteria pass. Each of `backend/`, `frontend/`, and `scripts/` has its own `AGENTS.md`; keep them current when behavior changes.

## Commands

Full app (Docker, serves http://localhost:8000, mounts `data/`, passes root `.env` at runtime):

- `scripts/start.sh` / `scripts/stop.sh` (Windows: `scripts\start.cmd` / `scripts\stop.cmd`). `PM_PORT` changes the host port. Image `pm-mvp:local`, container `pm-mvp`.

Backend (run in `backend/`):

- `uv sync` - install deps including dev group
- `uv run pytest` - all tests; coverage with an 80% floor is enforced via `addopts`
- `uv run pytest tests/test_board.py::test_name` - single test (add `--no-cov` to skip the coverage gate)
- Live OpenRouter test runs only with `OPENROUTER_LIVE_TEST=1` and `OPENROUTER_API_KEY` set in the test environment

Frontend (run in `frontend/`):

- `npm run dev`, `npm run build` (static export to `out/`), `npm run lint`
- `npm run test:unit` - Vitest with coverage (80% target); `npx vitest run src/lib/kanban.test.ts -t "name"` for one test
- `npm run test:e2e` - Playwright; builds the static site and serves it from the real FastAPI backend on :8123 with a fresh database in `frontend/.e2e-data/` and no OpenRouter key. Set `PLAYWRIGHT_BASE_URL` to test a running container instead. First run needs `npx playwright install chromium`. `Dockerfile.e2e` packages the suite in a Playwright image (no Python), so run it with `PLAYWRIGHT_BASE_URL` pointing at the app container.

## Architecture

Single container: the Dockerfile builds the Next.js static export (`output: "export"`, no Node runtime in production) and copies it to `/app/frontend-dist`; FastAPI (`backend/app/main.py`) mounts it at `/` and owns all `/api` routes. Paths are resolved relative to the repo/app root, so in the container data lives in `/app/data` (host `data/`).

Backend (`backend/app/`):

- `main.py` - `create_app(frontend_dir, data_dir)` factory; tests build isolated apps against `tmp_path`. uvicorn runs `app.main:default_app --factory`, so importing the module touches no data; `PM_FRONTEND_DIR`/`PM_DATA_DIR` override paths. Routes are on a module-level `api` router; stores (`users`, `boards`, `openrouter`) live on `app.state` and are injected through `Annotated` dependencies (`User`, `Admin`, `AIUser`, `Boards`, ...). Domain exceptions (`BoardError`, `UserError`, `OpenRouterError`, `AIError`) carry a `status_code` and map to JSON `{"detail": ...}` through one shared handler.
- `db.py` - `Database` over `data/board.sqlite3`: schema creation and versioned migrations (`PRAGMA user_version`, now 6), and `transaction()`.
- `users.py` - accounts (scrypt hashes, admin flag), SQLite sessions sent as the HTTP-only `pm_session` cookie (30 days), and admin operations. Seeds `user`/`password` as admin once.
- `board.py` - `BoardStore`: many boards per user, sharing with editor/viewer roles (`_access`/`_require`; viewers get 403 on writes), member assignees, card checklists and comments, a card archive, and an activity log (each `_op_*` returns `(card_id, summary)` for `_log`), positioned columns (1-12), cards with priority/dueDate/labels. Every mutation goes through `apply_operations(user_id, board_id, ops)` in one transaction and returns the full snapshot `{id, name, role, members, columns: [{id, title, cardIds}], cards: {id: {...}}}` (see `docs/BOARD_MODEL.md`).
- `openrouter.py` - httpx client for `openai/gpt-oss-120b`; `structured()` uses strict `json_schema`. Accepts an injectable transport for tests.
- `ai.py` - `/api/boards/{id}/ai/chat`: sends board JSON plus bounded history to the model, validates strict Pydantic operations, and applies them atomically. Contract in `docs/AI_CONTRACT.md`.

Frontend (`frontend/src/`): `AuthGate` (sign-in/register) -> `Workspace` (header with board picker and new-board form, My work, account, admin) -> `KanbanBoard` for the selected board. The board is server-authoritative: each edit calls `lib/board-api.ts` and the UI replaces state with the returned snapshot (errors keep the previous board). `AIChatSidebar` is a drawer toggled from the board toolbar and keeps per-board chat history in `sessionStorage`. Drag and drop uses `@dnd-kit`; move logic is in `lib/kanban.ts`. Playwright (`npm run test:e2e`) builds the site and runs it on the real backend at :8123 with a fresh database.


## DETAILED PLAN
@docs/PLAN.md