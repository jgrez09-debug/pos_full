@echo off
cd /d %~dp0
pm2 stop all
pm2 status
pause
