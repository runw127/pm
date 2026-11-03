# Frontend

This directory contains the Kanban Studio frontend. It is a Next.js App Router application using React and TypeScript. The root page renders `KanbanBoard`, which is a client component.

## Current behavior

- `src/lib/kanban.ts` defines board types and card movement helpers. Its sample board is used by tests.
- `AuthGate` checks the backend session, displays the sign-in form, and provides logout. The board is shown only after sign-in.
- `KanbanBoard` loads the signed-in user's board from the backend and saves each change through the board API. Confirmed server responses update the displayed board; errors leave the previous board visible.
- Users can rename columns, add, edit, and delete cards, and drag cards within or between columns using `@dnd-kit`.
- The board shows loading, saving, and error states.
- Column count is fixed; titles are editable.
- Styling uses `src/app/globals.css` and Tailwind CSS classes in components.

## File map

- `src/app/page.tsx`: root page.
- `src/app/layout.tsx`: fonts, metadata, and global styles.
- `src/components/KanbanBoard.tsx`: board loading, state, and interaction handlers.
- `src/components/AuthGate.tsx`: session check, sign-in, and logout.
- `src/components/KanbanColumn.tsx`: column rendering and add form.
- `src/components/KanbanCard.tsx`: sortable card, editing form, and delete button.
- `src/components/NewCardForm.tsx`: add-card form.
- `src/components/KanbanCardPreview.tsx`: drag overlay.
- `src/lib/kanban.ts`: types, sample test data, and card movement.
- `src/lib/board-api.ts`: board API requests and error handling.
- `src/lib/kanban.test.ts`, `src/lib/board-api.test.ts`, and `src/components/KanbanBoard.test.tsx`: Vitest unit tests.
- `tests/kanban.spec.ts`: Playwright browser tests.

## Commands

- `npm run dev`: run the frontend locally.
- `npm run build`: build the Next.js app.
- `npm run lint`: run ESLint.
- `npm run test:unit`: run Vitest tests.
- `npm run test:e2e`: run Playwright browser tests.

The project plan is in `../docs/PLAN.md`.
