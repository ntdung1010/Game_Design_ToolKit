@echo off
rem GD Toolkit - bam dup file nay de mo. Lan dau se tu tao moi truong .venv va cai thu vien.
cd /d "%~dp0"
title GD Toolkit
if not exist ".venv\Scripts\python.exe" (
  echo [GD Toolkit] Lan dau chay: tao moi truong rieng .venv ^(can mang, ~1 phut^)...
  python -m venv .venv
  if errorlevel 1 (
    echo Khong tim thay Python. Cai Python 3.10+ tu https://www.python.org roi chay lai.
    pause
    exit /b 1
  )
)
rem Cai lai thu vien khi requirements.txt thay doi (so sanh dau van tay file)
certutil -hashfile requirements.txt SHA256 2>nul | findstr /v ":" > ".venv\req.new"
fc /b ".venv\req.new" ".venv\req.sha" >nul 2>&1
if errorlevel 1 (
  echo [GD Toolkit] Cai / cap nhat thu vien...
  ".venv\Scripts\python.exe" -m pip install -q --disable-pip-version-check -r requirements.txt
  if errorlevel 1 (
    echo Cai thu vien loi - kiem tra mang roi chay lai start.bat.
    pause
    exit /b 1
  )
  copy /y ".venv\req.new" ".venv\req.sha" >nul
)
".venv\Scripts\python.exe" server.py %*
pause
