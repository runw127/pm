# Start and stop scripts

`start.sh` and `stop.sh` serve macOS and Linux. `start.cmd` and `stop.cmd` serve Windows. The scripts use the Docker image and container names `pm-mvp:local` and `pm-mvp`, expose port 8000 by default, and mount `data/` for future SQLite persistence.
