@echo off
title Memproses Data Titik Survei ke Poligon ZNT Cilacap...
echo ==============================================================
echo       SPATIAL JOIN: MENARIK KOORDINAT KE FIELD NOZN
echo ==============================================================
echo.
powershell -ExecutionPolicy Bypass -File "%~dp0run_spatial_join.ps1"
echo.
echo Selesai! Silakan refresh dashboard Anda di browser.
pause
