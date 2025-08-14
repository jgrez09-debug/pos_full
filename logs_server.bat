@echo off
cd /d %~dp0
pm2 logs pos-server --lines 200
