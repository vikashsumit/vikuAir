@echo off
title vikuAir Local Network Share (Python)
echo ======================================================
echo          🚀 Welcome to vikuAir File Share 🚀
echo ======================================================
echo.

:: Verify if Python is installed on the host machine
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo ❌ Error: Python is not installed or not added to your system PATH!
    echo.
    echo Please download and install Python (version 3.8 or newer) on this PC first.
    echo Make sure to check the box: "Add python.exe to PATH" during installation.
    echo.
    echo Download link: https://www.python.org/downloads/
    echo.
    pause
    exit /b
)

:: Check if virtual environment folder exists. If not, set it up automatically
if not exist ".venv" (
    echo ⚙️ Virtual environment (.venv) not found.
    echo 🛠️ Setting up vikuAir on this PC for the first time...
    echo.
    echo Creating virtual environment (.venv)...
    python -m venv .venv
    if %errorlevel% neq 0 (
        echo ❌ Error: Failed to create virtual environment!
        pause
        exit /b
    )
    echo.
    echo Installing dependencies from requirements.txt...
    .venv\Scripts\pip.exe install -r requirements.txt
    if %errorlevel% neq 0 (
        echo ❌ Error: Failed to install packages!
        pause
        exit /b
    )
    echo.
    echo ✅ Setup completed successfully!
    echo.
)

echo Make sure your Windows PC is connected to your iPhone's hotspot.
echo.
echo Launching server and opening web dashboard...
echo.
start http://localhost:3000
.venv\Scripts\python.exe -u server.py
pause
