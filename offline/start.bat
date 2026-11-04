@echo off
setlocal
cd /d "%~dp0.."

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 18 or newer is required.
  echo Install Node.js, then try again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo Installing CBT HUB dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo.
echo Starting CBT HUB on this laptop...
echo Keep this window open during exams.
echo Connect student laptops to the same Wi-Fi or hotspot.
echo Open http://THIS-LAPTOP-IP:3000 on student devices.
echo Press Ctrl+C to stop the server.
echo.

call npm start
pause
