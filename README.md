# Project Management App

Requires Docker. Run `scripts/start.sh` on macOS/Linux or `scripts\start.cmd` on Windows, then open http://localhost:8000. Use the matching stop script to stop the app. Set `PM_PORT` to change the host port. If present, the root `.env` is passed to the container; it is not baked into the image.

Sign in with the seeded admin `user` / `password` (change it under Account), or create an account from the sign-in page. Each user can keep several Kanban boards, with custom columns and cards that have a priority, due date, labels, and an assignee, and can share boards with others as editors or viewers. Cards have checklists and comment threads, can be archived and restored, and each board keeps an activity log. My work lists the open cards assigned to you across all boards. Admins manage users under Users.

Set `OPENROUTER_API_KEY` in the root `.env` to enable the AI assistant (the AI chat button on each board).

Tests: `cd backend && uv run pytest`; `cd frontend && npm run test:unit && npm run test:e2e`. The API and data model are in `docs/BOARD_MODEL.md`.
