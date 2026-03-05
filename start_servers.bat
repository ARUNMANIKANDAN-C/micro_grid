@echo off
title EMS Decentralized Microgrid System

echo =======================================================
echo Starting Decentralized Microgrid API (FastAPI) on :8001
echo =======================================================
start cmd /k "python -m uvicorn decentralized_api:app --port 8001 --reload"

echo =======================================================
echo Starting EMS Web Dashboard (Vite) on :5173
echo =======================================================
start cmd /k "cd ems-web && npm run dev"

echo Done! The servers are starting in two separate terminal windows.
echo You can close this window now.
pause
