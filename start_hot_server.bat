@echo off
cd /d "%~dp0"
set "TEAM_LOOP_PYTHON="
where python >nul 2>nul
if not errorlevel 1 set "TEAM_LOOP_PYTHON=python"
if not defined TEAM_LOOP_PYTHON if exist "%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" set "TEAM_LOOP_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if not defined TEAM_LOOP_PYTHON (
  echo Python 3 was not found. Install Python or add it to PATH.
  pause
  exit /b 1
)
"%TEAM_LOOP_PYTHON%" "%~dp0scripts\dev_server.py" --host 0.0.0.0 --port 8000
pause
