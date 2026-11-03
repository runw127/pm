# Backend

This directory contains the FastAPI application. It serves the exported Next.js frontend at `/` and returns JSON from `/api/hello`. Python dependencies are defined in `pyproject.toml` and locked with `uv`. Tests are in `tests/`.

Part 4 adds `/api/login`, `/api/session`, and `/api/logout`. `auth.py` stores opaque, 30-day sessions as files in the mounted `data/sessions/` directory. Part 6 adds `board.py`, which creates `data/board.sqlite3` and manages one five-column board per user. Board routes in `main.py` use `require_user` and return the updated board after mutations. Part 8 adds `openrouter.py` and an authenticated `/api/ai/check` endpoint for a `2+2` connectivity check. The API key comes from `OPENROUTER_API_KEY` on the backend. Structured AI board updates remain for a later part.
