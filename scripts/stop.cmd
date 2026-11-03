@echo off
docker stop pm-mvp
if errorlevel 1 exit /b 1
docker rm pm-mvp
