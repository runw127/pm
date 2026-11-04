@echo off
setlocal
set "PROJECT_DIR=%~dp0.."
if not defined PM_PORT set "PM_PORT=8000"
if not exist "%PROJECT_DIR%\data" mkdir "%PROJECT_DIR%\data"
docker build -t pm-mvp:local "%PROJECT_DIR%"
if errorlevel 1 exit /b 1
docker rm -f pm-mvp >nul 2>&1
if exist "%PROJECT_DIR%\.env" (
  docker run -d --name pm-mvp -p %PM_PORT%:8000 -v "%PROJECT_DIR%\data:/app/data" --env-file "%PROJECT_DIR%\.env" pm-mvp:local
) else (
  docker run -d --name pm-mvp -p %PM_PORT%:8000 -v "%PROJECT_DIR%\data:/app/data" pm-mvp:local
)
