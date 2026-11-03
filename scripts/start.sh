#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$project_dir/data"
docker build -t pm-mvp:local "$project_dir"

if [[ -f "$project_dir/.env" ]]; then
  docker run -d --name pm-mvp -p "${PM_PORT:-8000}:8000" -v "$project_dir/data:/app/data" --env-file "$project_dir/.env" pm-mvp:local
else
  docker run -d --name pm-mvp -p "${PM_PORT:-8000}:8000" -v "$project_dir/data:/app/data" pm-mvp:local
fi
