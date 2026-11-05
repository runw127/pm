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
- `npm run test:e2e` - Playwright; starts `next dev` on :3000 unless `PLAYWRIGHT_BASE_URL` is set (point it at the container to test the real backend). `Dockerfile.e2e` packages this suite in a Playwright image.

## Architecture

Single container: the Dockerfile builds the Next.js static export (`output: "export"`, no Node runtime in production) and copies it to `/app/frontend-dist`; FastAPI (`backend/app/main.py`) mounts it at `/` and owns all `/api` routes. Paths are resolved relative to the repo/app root, so in the container data lives in `/app/data` (host `data/`).

Backend (`backend/app/`):

- `main.py` - `create_app(frontend_dir, data_dir)` factory; tests build isolated apps against `tmp_path`. Routes are on a module-level `api` router; stores (`sessions`, `boards`, `openrouter`) live on `app.state` and are injected through `Annotated` dependencies (`User`, `AIUser`, `Boards`, ...), so tests can swap `app.state.openrouter`. Domain exceptions (`BoardError`, `OpenRouterError`, `AIError`) carry a `status_code` and are mapped to JSON `{"detail": ...}` by one shared exception handler. Protected routes take `User` (or `AIUser`, which adds the per-user AI rate limit).
- `auth.py` - hardcoded `user`/`password`; opaque 30-day session tokens stored as files under `data/sessions/` (filename is the token's SHA-256), sent as the HTTP-only `pm_session` cookie.
- `board.py` - `BoardStore` over `data/board.sqlite3`, created on first use, versioned with `PRAGMA user_version`. Each user gets one board with five fixed column IDs (`col-backlog` ... `col-done`) enforced by CHECK constraints; only titles change. Every mutation runs in a transaction and returns the full board snapshot (`{columns: [{id, title, cardIds}], cards: {id: {...}}}`, see `docs/BOARD_MODEL.md`).
- `openrouter.py` - httpx client for `openai/gpt-oss-120b`; `structured()` uses strict `json_schema` response format. Accepts an injectable transport for tests.
- `ai.py` - `/api/ai/chat`: sends board JSON plus bounded history to the model, validates the reply with strict Pydantic discriminated-union operations (`rename_column`, `add_card`, `edit_card`, `delete_card`, `move_card`), then applies them atomically via `BoardStore.apply_operations`. Contract in `docs/AI_CONTRACT.md`.

Frontend (`frontend/src/`): `AuthGate` checks `/api/session` before rendering `KanbanBoard`. The board is server-authoritative: each edit calls `lib/board-api.ts` and the UI replaces state with the returned snapshot (errors keep the previous board). `AIChatSidebar` calls `lib/ai-api.ts`, applies the returned board, and keeps chat history in `sessionStorage` (history is never stored server-side). Drag and drop uses `@dnd-kit`; move logic is in `lib/kanban.ts`.


## DETAILED PLAN
@docs/PLAN.md