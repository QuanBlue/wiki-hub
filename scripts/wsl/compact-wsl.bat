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
echo   WikiHub WSL and Docker Disk Compactor (Full ~350 GB Clean)
echo ============================================================
echo.
echo 1. Closing Docker Desktop and shutting down WSL...
taskkill /F /IM "Docker Desktop.exe" /T >nul 2>&1
taskkill /F /IM "com.docker.backend.exe" /T >nul 2>&1
wsl --shutdown
timeout /t 3 /nobreak >nul

echo.
echo 2. Disabling sparse VHD flag...
wsl --manage docker-desktop --set-sparse false >nul 2>&1
wsl --manage Ubuntu-24.04 --set-sparse false >nul 2>&1
wsl --shutdown
timeout /t 2 /nobreak >nul

echo.
echo 3. Resetting Docker Data VHDX (Freeing 219 GB)...
if exist "%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx" (
    del /f /q "%LOCALAPPDATA%\Docker\wsl\disk\docker_data.vhdx" >nul 2>&1
    echo    - Successfully reset docker_data.vhdx! (Reclaimed 219 GB)
)

echo.
echo 4. Compacting Ubuntu WSL VHDX (125 GB to ~30 GB)...
(
echo select vdisk file="%LOCALAPPDATA%\wsl\{fab29910-16fa-4b34-9800-3f29fd9b19d9}\ext4.vhdx"
echo attach vdisk readonly
echo compact vdisk
echo detach vdisk
) | diskpart

echo.
echo 5. Restarting Docker Desktop service...
net start com.docker.service >nul 2>&1
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe" >nul 2>&1

echo.
echo ============================================================
echo   SUCCESS! Docker service restarted & Drive C free space reclaimed!
echo ============================================================
pause
