# Frontend

Kanban Studio frontend: Next.js App Router, React, TypeScript, Tailwind, exported statically (`output: "export"`) and served by FastAPI.

## Behavior

- `AuthGate` checks `/api/session`, then shows the sign-in or create-account form or the `Workspace`. A 401 from any request returns to sign-in with a session-expired message. Logout and expiry clear every board conversation.
- `Workspace` has a one-line header: the board picker (a select with "Your boards" and "Shared with you" groups, showing owner, role, and card count), Delete for the open owned board when you own more than one, the new-board form, then Boards, Account, Users for admins, and Log out. The board takes the full width below it; columns flex between 200px and 360px wide so five fit without sideways scrolling from about 1280px; the selected board is remembered in `localStorage` (`pm-active-board`).
- `KanbanBoard` loads one board by ID. Every change goes to the API, and the UI replaces its state with the returned snapshot; errors keep the previous board. Saving and error states are shown. Columns can be added, renamed, moved left or right, and deleted (with confirmation). Cards can be dragged with the pointer or keyboard (focus Drag, Space, arrows, Space).
- `MembersPanel` (opened with the toolbar's Members button) lets the owner share by username, change roles, and remove members; others can leave. Viewers get a read-only board: no add, edit, drag, or column controls.
- `BoardToolbar` has the board name (editable by the owner only), a role badge, summary stats (cards, done = last column, overdue, high priority), and search, priority, label, and assignee filters.
- `CardForm` is shared by add and edit: title, details, priority, due date, assignee (a board member), and comma-separated labels. `CardMeta` shows priority, due status, the assignee, and labels.
- Clicking a card title opens `CardDetail`, a dialog with the card's fields, comment thread (add, and delete your own or as owner), and history. It closes with Close, the backdrop, or Escape. The toolbar's Activity button shows `ActivityPanel`, which refetches whenever the board snapshot changes. Cards show their comment count and checklist progress. The dialog's `Checklist` section toggles, adds, and removes items through the board's `save` (read-only for viewers); the dialog shows board save errors and reloads card history whenever the card changes.
- `MyWork` (header button) lists open cards assigned to you from `lib/work-api.ts`, grouped by due status (`groupWork`). Choosing one selects its board and passes `initialCardId` to `KanbanBoard`, which opens that card's dialog; the board is keyed with a counter so the same card can be reopened.
- Cards have an Archive action (no confirmation, since it can be undone). The toolbar's Archived button shows `ArchivePanel`, which lists archived cards, restores them, or deletes them permanently after a confirmation, and refetches when the board changes.
- `AIChatSidebar` is a fixed right-hand drawer toggled by the toolbar's AI chat button (it stays mounted while hidden, so a pending reply is kept). It chats about the open board and keeps history in `sessionStorage` under `kanban-studio-chat:<boardId>`.
- `AccountSettings` handles password change and account deletion. `AdminPanel` handles the user table, admin toggle, password reset, and delete.

## File map

- `src/lib/api.ts`: `request`, `ApiError`, `isExpired`, `messageOf`.
- `src/lib/board-api.ts`, `src/lib/account-api.ts`, `src/lib/ai-api.ts`, `src/lib/activity-api.ts`: typed API calls (activity also has `describe` and `formatTime`).
- `src/lib/kanban.ts`: types, sample data for tests, filters, due-date and stats helpers, `moveCard`.
- `src/components/*.tsx`: the components above, each with a `*.test.tsx` beside it.
- `tests/*.spec.ts`: Playwright specs (auth, boards, kanban, sharing, collaboration, checklist, my-work, admin, ai-chat) with shared `tests/helpers.ts`. Each test registers a fresh user.

## Commands

- `npm run dev`, `npm run build`, `npm run lint`
- `npm run test:unit`: Vitest with coverage (80% floor; currently about 97% of lines).
- `npm run test:e2e`: Playwright. By default it builds the site and serves it from the real FastAPI backend on port 8123 with a fresh database in `.e2e-data/`, and no OpenRouter key. Set `PLAYWRIGHT_BASE_URL` to test a running container instead. First run: `npx playwright install chromium`.
