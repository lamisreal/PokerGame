@echo off
title Poker Định Mệnh Server
cd /d "%~dp0"
echo Starting Poker Định Mệnh Server...
echo Mo trinh duyet tai: http://127.0.0.1:5500
echo Nhan Ctrl+C de tat server
echo.
C:/Users/412358/AppData/Local/Programs/Python/Python312/python.exe server.py
pause
