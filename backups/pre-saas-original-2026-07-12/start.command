#!/bin/bash
cd "$(dirname "$0")"
/opt/homebrew/bin/python3 server.py &
sleep 1
open "http://localhost:8765/task_tracker.html"
echo "✓ Chie-Task_Tracker running!"
echo "  URL: http://localhost:8765/task_tracker.html"
echo "  Data: storage/tasks.json"
echo "  Press Ctrl+C to stop"
wait
