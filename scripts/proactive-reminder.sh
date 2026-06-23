#!/bin/bash
# Proactive calendar reminder
# Runs every 5 minutes via cron
# Checks user's calendar for events in next 15 minutes
# Sends proactive message via bot if event found and not yet notified

set -e
APP_DIR="/home/ubuntu/apps/agentic-os"
LOG_FILE="/home/ubuntu/apps/agentic-os/logs/proactive-reminder.log"
CHAT_ID="oc_dc86d64c7aac9ec3bbb7b8e98975aaaf"  # Bayu's chat with bot

mkdir -p "$(dirname "$LOG_FILE")"
echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Proactive check started" >> "$LOG_FILE"

# Query user calendar for next 15 minutes
NOW=$(date -u +%s)
END=$((NOW + 900))  # +15 min

RESULT=$(cd "$APP_DIR" && lark-cli calendar +agenda --start "$(date -u -d "@$NOW" +%Y-%m-%dT%H:%M:%S+00:00)" --end "$(date -u -d "@$END" +%Y-%m-%dT%H:%M:%S+00:00)" 2>&1)

if echo "$RESULT" | jq -e '.ok == true' >/dev/null 2>&1; then
  EVENTS=$(echo "$RESULT" | jq -c '.data[]?' 2>/dev/null)
  EVENT_COUNT=$(echo "$EVENTS" | grep -c "^{" 2>/dev/null || echo 0)
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Found $EVENT_COUNT events in next 15 min" >> "$LOG_FILE"
  
  for EVT in $EVENTS; do
    if [ -z "$EVT" ] || [ "$EVT" = "null" ]; then continue; fi
    
    EID=$(echo "$EVT" | jq -r '.event_id' 2>/dev/null)
    SUMMARY=$(echo "$EVT" | jq -r '.summary' 2>/dev/null)
    START_TS=$(echo "$EVT" | jq -r '.start_time.timestamp // .start_time.datetime' 2>/dev/null)
    MEETING_URL=$(echo "$EVT" | jq -r '.vchat.meeting_url // ""' 2>/dev/null)
    
    # Skip if already notified (check DB)
    ALREADY=$(PGPASSWORD=dupoin2026secure psql -h localhost -U dupoin -d agentic_os -t -c "SELECT COUNT(*) FROM proactive_reminders WHERE event_id = '$EID' AND reminder_type = 'pre_15min';" 2>/dev/null | tr -d ' ')
    
    if [ "$ALREADY" = "0" ] && [ -n "$EID" ] && [ "$EID" != "null" ]; then
      # Format start time
      START_FMT=$(date -u -d "@$START_TS" +"%H:%M UTC (%Y-%m-%d)" 2>/dev/null)
      
      # Build message
      MSG="🔔 *Reminder*: Meeting *$SUMMARY* starts in 15 minutes ($START_FMT)"
      if [ -n "$MEETING_URL" ] && [ "$MEETING_URL" != "null" ]; then
        MSG="$MSG\n\nJoin: $MEETING_URL"
      fi
      
      # Send to user via bot
      cd "$APP_DIR" && node -e "
const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
fetch('http://localhost:3013/api/proactive/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ chatId: '$CHAT_ID', message: \`$MSG\` })
}).then(r => r.json()).then(d => console.log(JSON.stringify(d))).catch(e => console.error(e.message));
" >> "$LOG_FILE" 2>&1
      
      # Mark as notified
      PGPASSWORD=dupoin2026secure psql -h localhost -U dupoin -d agentic_os -c "INSERT INTO proactive_reminders (event_id, reminder_type) VALUES ('$EID', 'pre_15min') ON CONFLICT DO NOTHING;" >> "$LOG_FILE" 2>&1
      
      echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] Sent reminder for: $SUMMARY ($EID)" >> "$LOG_FILE"
    fi
  done
else
  echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] lark-cli error: $RESULT" >> "$LOG_FILE"
fi
