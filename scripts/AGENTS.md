# Start and stop scripts

`start.sh` and `stop.sh` serve macOS and Linux. Start scripts remove any existing `pm-mvp` container before running a new one; stop scripts force-remove it. `start.cmd` and `stop.cmd` serve Windows. The scripts use the Docker image and container names `pm-mvp:local` and `pm-mvp`, expose port 8000 by default, and mount `data/` for the SQLite database and session files, and pass the root `.env` to the container when present.
