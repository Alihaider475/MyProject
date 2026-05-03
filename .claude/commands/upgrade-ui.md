---
name: upgrade-ui
description: Migrates dashboard UI from plain HTML/JS to React 18 + Vite + Tailwind CSS using subagents
---

You are the orchestrator for a UI migration task.
Execute each subagent below in strict order.
Wait for full completion before starting the next.
Never touch any file inside app/ directory.

---

## Subagent 1 — AUDIT
Read every file in app/static/ including all js/ and css/ folders.
List every page, feature, api endpoint, and websocket connection
used in the current dashboard.
Save the output as frontend/MIGRATION_CHECKLIST.md before proceeding.

---

## Subagent 2 — SCAFFOLD
Create frontend/ folder at project root with this exact setup:
- React 18
- Vite
- Tailwind CSS
- React Router v6
- Axios
- Recharts
Configure vite.config.js to proxy /api /frames /ws to localhost:8000.
Do not touch app/ folder.

---

## Subagent 3 — DASHBOARD PAGE
Read frontend/MIGRATION_CHECKLIST.md first.
Migrate home dashboard to React.
Create these components in frontend/src/components/:
- CameraGrid.jsx
- LiveFeed.jsx
- DetectionCounts.jsx
Match all existing API calls exactly as listed in checklist.

---

## Subagent 4 — VIOLATIONS PAGE
Read frontend/MIGRATION_CHECKLIST.md first.
Migrate violations table to React.
Create these components in frontend/src/components/:
- ViolationsTable.jsx
- SnapshotModal.jsx
- FilterBar.jsx
Match all existing API calls exactly as listed in checklist.

---

## Subagent 5 — CHARTS PAGE
Read frontend/MIGRATION_CHECKLIST.md first.
Migrate charts and stats to React using Recharts.
Create these components in frontend/src/components/:
- ViolationChart.jsx
- StatsCard.jsx
Match all existing chart data and api calls exactly.

---

## Subagent 6 — FINAL WIRING
Connect WebSocket for live detection counts in LiveFeed.jsx.
Connect MJPEG live feed stream using img src in LiveFeed.jsx.
Run npm install inside frontend/ and verify no import errors.
Update app/main.py to serve frontend/dist/ in production
with fallback to app/static/.

---

## Global Rules for All Subagents
- Never modify any file inside app/ directory
- Never change any FastAPI API endpoint or response format
- Use Tailwind CSS only — no Bootstrap, no inline styles
- All axios API calls go in frontend/src/api/client.js only
- One component per file inside frontend/src/components/
- Report what was created after each subagent completes