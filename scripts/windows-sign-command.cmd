@echo off
setlocal
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0windows-artifact-sign.ps1" -FilePath "%~1"
exit /b %ERRORLEVEL%
