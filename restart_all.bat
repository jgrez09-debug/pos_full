@echo off
cd /d %~dp0
pm2 restart all
pm2 status
pause
