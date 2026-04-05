@echo off
title dealsco
cd /d "%~dp0"

:: Check node is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed or not in PATH.
    echo Download it at https://nodejs.org
    pause
    exit /b 1
)

:: Install dependencies if node_modules is missing
if not exist node_modules (
    echo Installing dependencies...
    call npm install
    if %errorlevel% neq 0 ( echo npm install failed. & pause & exit /b 1 )
)

:: Install Playwright chromium if missing
if not exist node_modules\playwright\package.json (
    echo Installing Playwright browser...
    call npx playwright install chromium
)

echo.
echo  Starting dealsco...
echo  Press Ctrl+C to stop.
echo.

node index.js

pause
