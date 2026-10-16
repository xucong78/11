@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 知页 - AI 图文工作室
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0scripts\launch.mjs" --portable
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo 没有找到运行环境。请下载「知页 Windows 免安装版」，解压后再双击本文件。
    echo 源码版需要先安装 Node.js 24.5 或更新版本。
    pause
    exit /b 1
  )
  node "%~dp0scripts\launch.mjs"
)
if errorlevel 1 (
  echo.
  echo 启动未完成，请查看上面的提示。
  pause
  exit /b 1
)
