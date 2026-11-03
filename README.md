# Project Management MVP

Requires Docker. Run `scripts/start.sh` on macOS/Linux or `scripts\start.cmd` on Windows, then open http://localhost:8000. Use the matching stop script to stop the app. Set `PM_PORT` to change the host port. If present, the root `.env` is passed to the container; it is not baked into the image.

The container serves the Kanban demo at `/` and a simple API response at `/api/hello`. Sign in with `user` / `password`.
