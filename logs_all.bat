@echo off
cd /d %~dp0
pm2 logs --lines 200
