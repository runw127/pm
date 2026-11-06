# The Project Management MVP web app

## Business Requirements

This project is building a Project Management App. Key features:
- People can create an account, sign in, change their password, and delete their account
- Administrators manage users: list accounts, grant or revoke admin, reset passwords, delete users
- Each user owns any number of Kanban boards (one per project) and can create, rename, switch, and delete them
- Owners share boards with other users as editors or viewers; cards can be assigned to board members
- Members discuss cards in comment threads; every board change is recorded in an activity log
- Cards have checklists, with progress shown on the card
- Cards are archived rather than deleted, and can be restored or deleted permanently from the archive
- My work lists open cards assigned to you across all boards, soonest due first
- Boards have columns that can be added, renamed, reordered, and deleted
- Cards have a title, details, priority, due date, and labels; they can be moved with drag and drop, edited, searched, and filtered
- Each board header summarizes card, done, overdue, and high-priority counts
- There is an AI chat feature in a drawer opened from the board toolbar, scoped to the open board; the AI can create / edit / move cards and add / rename / reorder columns

## Limitations

A seeded admin account `user` / `password` is created on first start; change its password after signing in.

Boards are private unless their owner shares them.

This runs locally (in a docker container).

## Technical Decisions

- NextJS frontend
- Python FastAPI backend, including serving the static NextJS site at /
- Everything packaged into a Docker container
- Use "uv" as the package manager for python in the Docker container
- Use OpenRouter for the AI calls. An OPENROUTER_API_KEY is in .env in the project root
- Use `openai/gpt-oss-120b` as the model
- Use SQLLite local database for the database, creating a new db if it doesn't exist
- Start and Stop server scripts for Mac, PC, Linux in scripts/

## Starting Point

A working MVP of the frontend has been built and is already in frontend. This is not yet designed for the Docker setup. It's a pure frontend-only demo.

## Color Scheme

- Accent Yellow: `#ecad0a` - accent lines, highlights
- Blue Primary: `#209dd7` - links, key sections
- Purple Secondary: `#753991` - submit buttons, important actions
- Dark Navy: `#032147` - main headings
- Gray Text: `#888888` - supporting text, labels

## Coding standards

1. Use latest versions of libraries and idiomatic approaches as of today
2. Keep it simple - NEVER over-engineer, ALWAYS simplify, NO unnecessary defensive programming. No extra features - focus on simplicity.
3. Be concise. Keep README minimal. IMPORTANT: no emojis ever
4. When hitting issues, always identify root cause before trying a fix. Do not guess. Prove with evidence, then fix the root cause.

## Working documentation

All documents for planning and executing this project will be in the docs/ directory.
Please review the docs/PLAN.md document before proceeding.

## Final task report

After completing a task that changes files, show every file changed by that task in a directory-style tree. Include added, modified, and deleted files, including code, tests, and documentation. For each file, give a brief description of the change. Use clickable links for files that still exist, and label deleted files clearly. If the task changes no files, say so. Report only changes from the current task, not unrelated existing changes in the working tree.
