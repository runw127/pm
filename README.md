# Project Management MVP

Requires Docker. Run `scripts/start.sh` on macOS/Linux or `scripts\start.cmd` on Windows, then open http://localhost:8000. Use the matching stop script to stop the app. Set `PM_PORT` to change the host port. If present, the root `.env` is passed to the container; it is not baked into the image.

The container serves the persistent Kanban board at `/` and the board API at `/api/board`. Sign in with `user` / `password`.

For the OpenRouter connectivity check, set `OPENROUTER_API_KEY` in the root `.env`, restart the container, sign in, and POST to `/api/ai/check`. The optional live backend test also requires `OPENROUTER_LIVE_TEST=1` and the key in the test process environment.
