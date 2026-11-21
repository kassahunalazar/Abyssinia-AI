@echo off
setlocal
cd /d "%~dp0"
node launch.mjs --open
if errorlevel 1 pause
