@echo off
NET FILE >nul 2>&1
if %errorlevel% neq 0 (
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)
echo Starting Docker Desktop Service...
net start com.docker.service
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
echo Docker Desktop has been started successfully!
