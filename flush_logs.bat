@echo off
cd /d %~dp0
pm2 flush
echo Logs rotados.
pause
