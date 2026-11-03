# Project Management MVP plan

Work through these parts in order. Mark a task done only after its tests and success criteria pass. Part 1 and Part 5 require user approval before the next part starts.

## Shared scope and checks

- One board per signed-in user; the database supports multiple users.
- Five fixed columns can be renamed, but not added, removed, or reordered.
- Users can add, edit, delete, move, and reorder cards. AI can perform several card changes in one request.
- MVP credentials are `user` / `password`. Sign-in persists across refresh and browser restart; logout clears it, and sessions expire after 30 days.
- FastAPI serves the exported Next.js site at `/` and owns `/api` routes. The OpenRouter key stays on the server.
- SQLite data survives container restarts via a mounted data directory. Create the database when missing.
- Frontend and backend unit test suites each reach at least 80% line coverage of application code. Exclude generated code, configuration, tests, and framework boilerplate. Integration and browser tests are additional.
- At each implementation part, run relevant tests, build or type checks, and lint checks. Record failures before proceeding.

## Part 1: Plan and frontend inventory

- [x] Expand every part into tasks, tests, and success criteria.
- [x] Document the existing frontend in `frontend/AGENTS.md`.
- [x] Record persistent browser sign-in and the 80% unit coverage target.
- [x] Present the plan and inventory for user approval.

Tests: Check every part for tasks, tests, and a completion condition. Compare the frontend inventory with source files. This documentation-only part needs no code tests.

Success: The user approves the plan before Part 2.

## Part 2: Docker and backend scaffold

- [x] Add a minimal FastAPI app in `backend/`, with Python dependencies managed by `uv`.
- [x] Add a Docker build that installs backend dependencies, builds the Next.js frontend, and packages both in one runtime container.
- [x] Serve a temporary static hello-world page at `/` and a simple API response at `/api/hello`.
- [x] Add Mac, Windows, and Linux start/stop scripts in `scripts/`. Start scripts build and run with an app port and persistent data mount; stop scripts stop the app container.
- [x] Document minimum commands and environment variables in a concise project README. Keep `.env` and secrets out of the image.

Tests: Backend unit test for `/api/hello`; container smoke test for `/` and `/api/hello`; exercise scripts on available platforms and review the others.

Success: A script starts one local container, the browser displays the hello page and receives the API response, and a script stops it.

## Part 3: Serve the existing frontend

- [x] Configure Next.js static export and copy its output into the FastAPI image.
- [x] Replace the temporary page with the demo board at `/`, including assets and refresh-safe routing.
- [x] Preserve demo interactions and appearance while adapting build and serving paths.
- [x] Add focused unit and browser tests for rendering, renaming, card add/remove, and drag and drop.

Tests: Frontend unit suite, Playwright suite against the container, frontend build, and direct static asset request. Measure frontend unit coverage against 80%.

Success: The container serves the working demo without a Next.js runtime server; tested interactions work in a browser.

## Part 4: Persistent dummy sign-in

- [x] Add FastAPI sign-in, current-session, and logout endpoints using the fixed MVP credentials.
- [x] Use a persistent, HTTP-only browser cookie. Reject incorrect credentials and provide the authentication dependency for future board API routes.
- [x] Add a sign-in form and logout control. Check the current session before showing the board.
- [x] Retain sign-in across refresh and browser restart; clear the session on logout.

Tests: Backend unit tests for valid/invalid credentials, protected routes, invalid or expired sessions, and logout; frontend unit tests for loading, errors, signed-in and signed-out states; browser test for sign-in, refresh, browser restart, and logout.

Success: The board requires sign-in; valid sign-in survives browser restart, logout removes access, and invalid credentials reveal no board data.

## Part 5: Database model and approval

- [x] Propose SQLite tables and constraints for users, sessions if needed, each user's single board, fixed columns, cards, and ordering.
- [x] Save a representative board JSON example in `docs/` and document its mapping to tables and API payloads.
- [x] Document ownership checks, stable IDs, ordering, initial board creation, and migrations in `docs/`.
- [x] Review the proposal with the user and obtain sign-off before Part 6.

Tests: Validate the JSON and review the schema against all operations, including a second user, empty columns, and multi-card updates. No production database code is required yet.

Success: The user approves a schema and JSON shape supporting the MVP and fixed-column rule.

## Part 6: Board backend

- [x] Create the SQLite database and schema when absent; seed a five-column board for a new user.
- [x] Add authenticated API routes to read a board, rename columns, and add/edit/delete/move/reorder cards.
- [x] Enforce ownership; validate IDs, required fields, and move targets; keep multi-step changes transactional.
- [x] Return a consistent board shape and useful validation errors.

Tests: Backend unit tests for all operations, ordering, invalid inputs, cross-user access, missing-database creation, and rollback. API integration test with a temporary SQLite file; measure 80% backend unit line coverage.

Success: Board state persists across app restarts, users are isolated, and backend unit coverage reaches 80%.

## Part 7: Connect frontend and backend

- [x] Load the signed-in user's board through the API instead of `initialData`.
- [x] Send rename, add, edit, delete, move, and reorder actions to the backend; add the missing card editing UI.
- [x] Show saving and error states. Reconcile the displayed board with server responses so failed changes do not appear saved.
- [x] Retain five fixed columns and existing styling.

Tests: Frontend unit tests for API actions and failures; integration tests for all operations; browser tests for persistence after refresh, editing, drag and drop, and logout. Recheck both unit coverage targets.

Success: Every board change survives refresh and container restart and belongs to the signed-in user.

## Part 8: OpenRouter connectivity

- [x] Add a backend-only OpenRouter client using `OPENROUTER_API_KEY` and `openai/gpt-oss-120b`.
- [x] Add a small authenticated test endpoint or script that asks `2+2` without logging secrets.
- [x] Handle a missing key and upstream errors clearly.

Tests: Unit tests with mocked OpenRouter success and failure; one opt-in live `2+2` connectivity test.

Success: A live call returns the expected answer from the chosen model and the key never reaches the browser.

## Part 9: Structured AI board updates

- [x] Send current board JSON, user message, and conversation history from the backend to OpenRouter.
- [x] Request a structured answer with user-facing text and optional board operations. Verify model and route support for the required structured output format before implementation and document the contract.
- [x] Validate operations against manual-edit rules. Apply a valid operation set in one transaction and return the resulting board.
- [x] Bound conversation history and handle invalid output or failed updates clearly.

Tests: Unit tests for parsing, no-op replies, one and multiple operations, invalid IDs, malformed output, and rollback; API integration tests with a mocked model. Recheck backend unit coverage.

Success: The endpoint returns text and an authoritative board snapshot; valid AI changes persist atomically and invalid changes leave the board intact.

## Part 10: AI chat sidebar

- [ ] Add a responsive sidebar with message history, input, send/loading/error states, and clear attribution.
- [ ] Connect the sidebar to Part 9. Refresh the board from the returned snapshot after AI changes.
- [ ] Preserve conversation during the active browser session and provide a way to start a new conversation.

Tests: Frontend unit tests for sending, replies, failures, and board refresh; browser tests for a reply and multi-card update with a mocked model; final container smoke test and both 80% unit coverage checks.

Success: A signed-in user chats from the sidebar; AI changes appear immediately and persist after refresh; the full app runs in one local container.
