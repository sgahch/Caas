@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "delivery\v2.4.3\CaaS-Portable-x64.exe" (
  start "" "%~dp0delivery\v2.4.3\CaaS-Portable-x64.exe"
  exit /b 0
)
if exist "release\v2.4.3\CaaS-Portable-x64.exe" (
  start "" "%~dp0release\v2.4.3\CaaS-Portable-x64.exe"
  exit /b 0
)
echo 未找到 2.4.3 客户端，请先解压完整交付包。
pause
