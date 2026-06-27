---
name: cctv-wall
description: "Use this skill when building the CCTV Wall / IP Camera Wall feature for SafeSite AI. Triggers: any task involving a multi-camera live feed dashboard, RTSP camera grid, duplicate camera tiles, MJPEG stream display, Start All/Stop All controls, or the /cctv-wall route. Stack: React 18 + Vite + TailwindCSS frontend, FastAPI backend, YOLO/Ultralytics, OpenCV, MJPEG streams, SQLAlchemy. Do NOT break the existing Dashboard, camera CRUD, violation logging, YOLO detection, worker identification, or alert dispatch."
---

# SafeSite AI — CCTV Wall Feature Skill

## Role

Act as an Expert FastAPI + React Computer Vision Engineer.

---

## Project Context

| Layer      | Technology                                      |
|------------|-------------------------------------------------|
| Frontend   | React 18, Vite, TailwindCSS                     |
| Backend    | FastAPI                                         |
| Detection  | YOLO/Ultralytics, OpenCV                        |
| Streaming  | MJPEG live streams, WebSocket live counts       |
| Database   | SQLAlchemy ORM                                  |
| Existing   | Camera CRUD, start/stop/stream system           |

---

## Goal

Create a **separate** `/cctv-wall` page — a professional multi-camera live feed dashboard similar to a CCTV control room wall. The existing Dashboard must continue working exactly as before.

---

## Hard Rules (never violate)

- Do NOT replace or break the existing Dashboard page
- Do NOT rewrite unrelated code
- Do NOT break: violation logging, YOLO detection, worker identification, alert dispatch
- Do NOT change existing API response formats unless a new endpoint is required
- Do NOT start implementation without explicit approval

---

## Strict Workflow

1. Explore existing project files (see Phase 1)
2. Explain the current camera flow
3. Propose a file-by-file implementation plan
4. **Wait for approval**
5. After approval: implement only approved files

---

## Phase 1 — Repository Exploration

### Explore these areas

- React routing configuration
- Sidebar/navbar links
- Dashboard camera grid component
- `CameraCard` or live feed components
- Frontend camera API services
- Backend camera routes
- Backend camera schemas
- Backend camera model
- `CameraManager`
- MJPEG stream endpoint
- WebSocket count endpoint (if used)

### Report the current camera flow

- How cameras are added
- How cameras are started
- How MJPEG stream URL is generated
- How live counts are updated
- How camera status is stored

---

## Phase 2 — Feature Requirements

### Route and navigation

- New route: `/cctv-wall`
- New sidebar item: **CCTV Wall**

### Page layout

- Page title: **CCTV Wall**
- Subtitle: *Monitor multiple IP camera feeds in real time*
- Action buttons: **Add IP Camera**, **Start All**, **Stop All**, **Refresh**
- Responsive camera grid:

| Screen size | Columns |
|-------------|---------|
| Small       | 1       |
| Medium      | 2       |
| Large       | 3       |
| Extra-large | 4 (optional) |

### Camera card requirements

- 16:9 aspect ratio
- Shows: camera name, status badge, live MJPEG feed
- Controls: Start / Stop per card
- States: loading, error ("Camera unavailable"), live

### Status badges

- `● LIVE` — green, when running
- `● OFFLINE` — red, when stopped or error

---

## Phase 3 — Add IP Camera Form/Modal

### Fields

| Field                | Default | Required |
|----------------------|---------|----------|
| Camera name          | —       | Yes      |
| RTSP URL             | —       | Yes      |
| Detection confidence | 0.25    | No       |
| Location             | —       | No       |
| Duplicate tile count | 1       | No       |

### Duplicate tile behavior

Enter one RTSP URL and create multiple tiles from it:

```
RTSP URL     : rtsp://user:pass@192.168.1.10:554/stream1
Name Prefix  : IP Camera
Copies       : 6

Creates → IP Camera 1, IP Camera 2, ... IP Camera 6
```

All tiles may share the same `source_uri` for the first implementation.

---

## Phase 4 — Backend Endpoint (only if needed)

### `POST /api/v1/cameras/duplicate`

**Request body:**
```json
{
  "name_prefix": "IP Camera",
  "source_type": "rtsp",
  "source_uri": "rtsp://...",
  "copies": 6,
  "detection_confidence": 0.25
}
```

**Response:** Return created camera records using the same shape as the existing camera list response.

---

## Phase 5 — Page Behavior

- On page load: fetch all cameras
- Show only RTSP cameras: filter by `source_type === "rtsp"` if backend doesn't distinguish
- Per-camera: Start, Stop
- Global: Start All (continue if one fails), Stop All (continue if one fails)
- Live stream URL: `/api/v1/cameras/{camera_id}/stream` (confirm correct endpoint during exploration)

---

## Phase 6 — Error Handling

| Scenario                  | Behavior                              |
|---------------------------|---------------------------------------|
| Invalid RTSP URL          | Show user-friendly validation error   |
| Camera start fails        | Show error on that card, don't crash  |
| Stream unavailable        | Show "Camera unavailable" on card     |
| Start All — one fails     | Continue starting remaining cameras   |
| Stop All — one fails      | Continue stopping remaining cameras   |

---

## Phase 7 — Performance Note (Post-Launch)

After the feature works, check whether the same RTSP URL is opened multiple times when duplicate tiles are started. If yes, **do not immediately rewrite** — instead provide a second-phase optimization plan:

- One RTSP capture worker per unique `source_uri`
- One YOLO inference loop per unique `source_uri`
- Multiple frontend tiles reuse the latest annotated frame
- Avoid running YOLO separately per duplicate tile

---

## UI Style Guidelines

- Dark card backgrounds matching existing app theme
- Compact camera cards, no huge right-side gutter
- Subtle borders between cards
- Responsive grid looks good at 1366px and 1920px
- Green LIVE / red OFFLINE badges
- Professional CCTV control room aesthetic

---

## Testing Checklist

### Automated
```bash
npm run build
pytest tests/unit  # or targeted camera tests if available
```

### Manual verification
- [ ] Open `/cctv-wall`
- [ ] Add one RTSP camera → confirm one card appears
- [ ] Add RTSP URL with duplicate count 6 → confirm 6 cards appear
- [ ] Start one camera → confirm live feed appears
- [ ] Start All → confirm all cards attempt to start
- [ ] Stop All → confirm all feeds stop
- [ ] Existing Dashboard still works
- [ ] Existing camera management still works

---

## Deliverables

At the end provide:

1. Summary of implemented feature
2. Changed files list
3. Any new endpoint added
4. Any assumptions made
5. Commands run and results
6. Manual testing checklist with results
7. Follow-up optimization plan for shared RTSP fan-out (if duplicate tiles open multiple captures)