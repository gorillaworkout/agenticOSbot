#!/bin/bash
# Proactive Engine Cron Trigger
# Runs every 10 minutes to check for due proactive rules
curl -s -X POST http://localhost:3013/api/proactive \
  -H "Content-Type: application/json" \
  -d '{"action": "scheduler"}' > /tmp/proactive-cron.log 2>&1
