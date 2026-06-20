@echo off
setlocal

REM Compatibility launcher for users who prefer double-click build.
REM The canonical build logic lives in scripts\build-portable-windows.ps1.

cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-portable-windows.ps1" %*
set BUILD_EXIT_CODE=%ERRORLEVEL%

echo.
if "%BUILD_EXIT_CODE%"=="0" (
  echo KubeDeck portable build completed successfully.
) else (
  echo KubeDeck portable build failed with exit code %BUILD_EXIT_CODE%.
)

pause
exit /b %BUILD_EXIT_CODE%
