@echo off
title Poker + Tien Len Server
cd /d "%~dp0"
echo ============================================
echo   Server: Poker Dinh Menh + Tien Len
echo ============================================
echo   Poker:      http://127.0.0.1:5500/
echo   Tien Len:   http://127.0.0.1:5500/tienlen
echo.
echo Nhan Ctrl+C de tat server
echo.
C:/Users/412358/AppData/Local/Programs/Python/Python312/python.exe server.py
pause
