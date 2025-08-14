@echo off
cd /d %~dp0
pm2 logs pos-client --lines 200
