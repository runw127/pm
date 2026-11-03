# Existing frontend

This directory contains the frontend-only Kanban Studio demo. It is a Next.js App Router application using React and TypeScript. The root page renders `KanbanBoard`, which is a client component.

## Current behavior

- Five initial columns and eight initial cards are defined in `src/lib/kanban.ts`.
- `AuthGate` checks the backend session, displays the sign-in form, and provides logout. The board is shown only after sign-in.
- `KanbanBoard` keeps the board in React state. Board changes are lost on refresh; the board API and database are not connected yet.
- Users can rename columns, add and delete cards, and drag cards within or between columns using `@dnd-kit`.
- Cards show a title and details, but there is no card editing UI.
- Column count is fixed; titles are editable.
- Styling uses `src/app/globals.css` and Tailwind CSS classes in components.

## File map

- `src/app/page.tsx`: root page.
- `src/app/layout.tsx`: fonts, metadata, and global styles.
- `src/components/KanbanBoard.tsx`: board state and interaction handlers.
- `src/components/AuthGate.tsx`: session check, sign-in, and logout.
- `src/components/KanbanColumn.tsx`: column rendering and add form.
- `src/components/KanbanCard.tsx`: sortable card and delete button.
- `src/components/NewCardForm.tsx`: add-card form.
- `src/components/KanbanCardPreview.tsx`: drag overlay.
- `src/lib/kanban.ts`: types, sample data, card movement, and ID creation.
- `src/lib/kanban.test.ts` and `src/components/KanbanBoard.test.tsx`: Vitest unit tests.
- `tests/kanban.spec.ts`: Playwright browser tests.

## Commands

- `npm run dev`: run the demo locally.
- `npm run build`: build the Next.js app.
- `npm run lint`: run ESLint.
- `npm run test:unit`: run Vitest tests.
- `npm run test:e2e`: run Playwright browser tests.

The project plan is in `../docs/PLAN.md`. Preserve board behavior when connecting FastAPI, and add card editing when implementing the persistent board.
