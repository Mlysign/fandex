@echo off
rem Starts the release plan's little server if it is not running, then opens the page.
cd /d "%~dp0"
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4777/api/ping -TimeoutSec 1 | Out-Null } catch { Start-Process -WindowStyle Minimized node -ArgumentList 'serve.mjs' -WorkingDirectory (Get-Location) }"
timeout /t 1 /nobreak >nul
start "" http://127.0.0.1:4777/
