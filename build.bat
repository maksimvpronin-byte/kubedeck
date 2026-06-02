@echo off
setlocal enabledelayedexpansion

echo.
echo ====== Installing npm dependencies ======
call npm install
if errorlevel 1 (
    echo Failed to install npm dependencies
    exit /b 1
)

echo.
echo ====== Installing Python backend dependencies ======
py -3 -m pip install -r apps\backend\requirements.txt
if errorlevel 1 (
    echo Failed to install Python dependencies
    exit /b 1
)

echo.
echo ====== Installing PyInstaller ======
py -3 -m pip install pyinstaller
if errorlevel 1 (
    echo Failed to install PyInstaller
    exit /b 1
)

echo.
echo ====== Cleaning build output ======
if exist "apps\desktop\build\backend" rmdir /s /q "apps\desktop\build\backend"
if exist "build\pyinstaller" rmdir /s /q "build\pyinstaller"
if exist "build\backend-onedir" rmdir /s /q "build\backend-onedir"
if exist "apps\desktop\release" rmdir /s /q "apps\desktop\release"
mkdir "apps\desktop\build\backend"
mkdir "build\pyinstaller"

echo.
echo ====== Building Electron app ======
call npm run build
if errorlevel 1 (
    echo Failed to build Electron app
    exit /b 1
)

echo.
echo ====== Building Python backend ======
py -3 -m PyInstaller ^
  --noconfirm ^
  --clean ^
  --onedir ^
  --name "KubeDeck Backend" ^
  --distpath "build\backend-onedir" ^
  --workpath "build\pyinstaller" ^
  --specpath "build\pyinstaller" ^
  --paths "apps\backend" ^
  --hidden-import uvicorn.logging ^
  --hidden-import uvicorn.loops.auto ^
  --hidden-import uvicorn.loops.asyncio ^
  --hidden-import uvicorn.protocols.http.auto ^
  --hidden-import uvicorn.protocols.http.h11_impl ^
  --hidden-import uvicorn.protocols.websockets.auto ^
  --hidden-import uvicorn.protocols.websockets.websockets_impl ^
  --hidden-import uvicorn.lifespan.on ^
  "apps\backend\kubedeck_backend\main.py"
if errorlevel 1 (
    echo Failed to build Python backend
    exit /b 1
)

echo.
echo ====== Copying backend executable ======
copy "build\backend-onedir\KubeDeck Backend\KubeDeck Backend.exe" "apps\desktop\build\backend\KubeDeck Backend.exe"
xcopy "build\backend-onedir\KubeDeck Backend\_internal" "apps\desktop\build\backend\_internal" /E /I /Y

echo.
echo ====== Building portable executable ======
cd apps\desktop
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm run dist:win
cd ..\..

echo.
echo ====== Done ======
echo Build output: apps\desktop\release
dir apps\desktop\release\*.exe

pause
