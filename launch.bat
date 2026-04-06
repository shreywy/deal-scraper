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

:: Install npm dependencies if missing
if not exist node_modules (
    echo Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo npm install failed.
        pause
        exit /b 1
    )
)

:: Check if Playwright Chromium browser binary is installed
:: (npm package alone is not enough — the browser binary must be downloaded separately)
node -e "const {chromium}=require('playwright');const fs=require('fs');process.exit(fs.existsSync(chromium.executablePath())?0:1);" >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing Playwright Chromium browser...
    call npx playwright install chromium
    if %errorlevel% neq 0 (
        echo Playwright browser install failed.
        pause
        exit /b 1
    )
)

:: Create data directory if missing (stores deal cache)
if not exist data mkdir data

:: Kill any existing dealsco server on port 3000
echo Checking for existing server on port 3000...
powershell -Command "Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 1 /nobreak >nul

echo.
echo  Starting dealsco...
echo  Press Ctrl+C to stop.
echo.

node index.js

pause
