@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo First-time setup - installing dependencies ^(this can take a minute^)...
  call npm install
)
echo Starting Story Creator - it will open in your browser automatically.
call npm run dev -- --open
