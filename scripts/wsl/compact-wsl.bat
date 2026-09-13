@echo off
:: Self-elevate script to Administrator if not already running as Admin
NET FILE >nul 2>&1
if %errorlevel% neq 0 (
    echo Requesting Administrator privileges to compact WSL disk files...
    powershell -Command "Start-Process '%~f0' -Verb RunAs"
    exit /b
)

title "WikiHub WSL and Docker Disk Compactor"
echo ============================================================
echo   WikiHub WSL and Docker Disk Compactor
echo ============================================================
echo.
echo This removes unused Docker images/build cache/volumes, then
echo reclaims that freed space from the WSL virtual disks back onto
echo drive C:. Deleting files alone never does this on its own -
echo Windows has to be told which blocks are free before it can
echo shrink a WSL disk file.
echo.
echo It will ask for your Linux (sudo) password partway through -
echo that is separate from the Administrator prompt you just approved.
echo.

echo 1. Removing unused Docker images, build cache and volumes...
echo    (only things no container - running or stopped - references;
echo    nothing you still have gets touched)
wsl -d Ubuntu-24.04 -- docker image prune --all --force
wsl -d Ubuntu-24.04 -- docker builder prune --all --force
wsl -d Ubuntu-24.04 -- docker volume prune --force
echo.

echo 2. Trimming the WSL filesystem so Windows learns which blocks
echo    are actually free - without this, compacting later reclaims
echo    almost nothing no matter what was just deleted above.
wsl -d Ubuntu-24.04 -- sudo fstrim -av
echo.

echo 3. Closing Docker Desktop and shutting down WSL...
taskkill /F /IM "Docker Desktop.exe" /T >nul 2>&1
taskkill /F /IM "com.docker.backend.exe" /T >nul 2>&1
wsl --shutdown
timeout /t 3 /nobreak >nul
echo.

echo 4. Disabling the sparse VHD flag...
wsl --manage docker-desktop --set-sparse false >nul 2>&1
wsl --manage Ubuntu-24.04 --set-sparse false >nul 2>&1
wsl --shutdown
timeout /t 2 /nobreak >nul
echo.

echo 5. Resetting Docker Desktop's own small WSL-integration disk...
if exist "%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx" (
    del /f /q "%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx" >nul 2>&1
    echo    - Removed docker_data.vhdx ^(Docker Desktop recreates it on next start^)
)
echo.

echo 6. Compacting every registered WSL disk...
echo    (found automatically from the registry - no hardcoded path,
echo    so this keeps working even if a distro gets reinstalled)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0compact-wsl-disks.ps1"
echo.

echo 7. Restarting Docker Desktop...
net start com.docker.service >nul 2>&1
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" >nul 2>&1

echo.
echo ============================================================
echo   Done. Check drive C: free space in Explorer to confirm.
echo ============================================================
pause
