@echo off
echo.
echo ========================================
echo   Timetrace Project Launcher (Windows)
echo ========================================
echo.

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Error: Node.js not detected, please install Node.js first
    echo Download: https://nodejs.org/
    pause
    exit /b 1
)

REM Check command line arguments
if "%1"=="--init-only" (
    echo Initializing environment only...
    node setup.js --init-only
    pause
    exit /b 0
)

REM Check if .env file exists
if exist "backend\src\data\.env" (
    echo Environment configuration file exists: backend\src\data\.env
    echo Skipping initialization
) else (
    echo Environment configuration file does not exist, initializing...
    node setup.js --init-only
)

REM Start services (single port mode)
echo.
echo Starting services...
node start-services.js
