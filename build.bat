@echo off
chcp 65001 >nul
setlocal

set SCRIPT_DIR=%~dp0

powershell -NoProfile -ExecutionPolicy Bypass ^
  -File "%SCRIPT_DIR%build.ps1" %*

if %ERRORLEVEL% NEQ 0 (
  echo [ERROR] 构建失败
  exit /b %ERRORLEVEL%
)

echo [SUCCESS] 完成