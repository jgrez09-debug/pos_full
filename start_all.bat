@echo off
cd /d %~dp0
echo Iniciando PM2 apps...
pm2 start ecosystem.config.cjs
pm2 save
pm2 status
echo --
echo Listo. Server en 3001 y Client (Vite) normalmente en 5173.
pause
