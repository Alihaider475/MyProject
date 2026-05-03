# PPE Detection Dashboard — React Migration Checklist

Audited from the former legacy static dashboard on 2026-05-01.

---

## Pages / Sections (Single-Page Application)

The original app is a single HTML page (`index.html`) with all features rendered together.
For the React migration we treat each major section as a component tree.

| Section | Original file(s) | React component(s) |
|---|---|---|
| Navbar + Health badge | `health.js` | `Navbar.jsx` |
| KPI Banner | `health.js` | `StatsCard.jsx` |
| Charts (hourly / by-type / by-camera) | `charts.js` | `ViolationChart.jsx` |
| 30-Day Heat Map | `heatmap.js` | `HeatMap.jsx` |
| Live Feed (MJPEG stream) | `stream.js` | `LiveFeed.jsx` |
| Live Detection Counts | `stream.js`, WebSocket | `DetectionCounts.jsx` |
| Camera Selector + Start/Stop | `cameras.js`, `stream.js` | `LiveFeed.jsx` |
| Zone Draw / Clear | `zone.js` | `LiveFeed.jsx` (canvas overlay) |
| Camera Management table + Add form | `cameras.js` | `CameraGrid.jsx` |
| Test Image Detection | `detect.js` | `ImageDetect.jsx` |
| Violations Filter Bar | `violations.js` | `FilterBar.jsx` |
| Violations Table | `violations.js` | `ViolationsTable.jsx` |
| Violation Detail Modal | `violations.js` | `SnapshotModal.jsx` |
| Frame Zoom Modal | `violations.js` | inside `SnapshotModal.jsx` |
| Keyboard Shortcuts Modal | `shortcuts.js` | `ShortcutsModal.jsx` |
| Toast Notifications | `ui.js` | custom `useToast` hook + `Toast.jsx` |
| PDF Report | `report.js` | `ReportButton.jsx` |
| Onboarding Tour | `tour.js` | `Tour.jsx` (driver.js) |

---

## API Endpoints

All calls must go through `frontend/src/api/client.js`.

### Health
| Method | Path | Used by | Response fields |
|---|---|---|---|
| GET | `/api/v1/health` | Navbar, KPI, Report | `{ status, cameras_active }` |

### Cameras
| Method | Path | Used by | Body / Params |
|---|---|---|---|
| GET | `/api/v1/cameras` | CameraGrid, LiveFeed | — |
| GET | `/api/v1/cameras/{id}` | CameraGrid | — |
| POST | `/api/v1/cameras` | CameraGrid (add form) | `{ name, source_type, source_uri, detection_confidence }` |
| PUT | `/api/v1/cameras/{id}` | CameraGrid (rename), Zone | `{ name?, source_uri?, detection_confidence?, roi_polygon? }` |
| DELETE | `/api/v1/cameras/{id}` | CameraGrid | — |
| POST | `/api/v1/cameras/{id}/start` | LiveFeed | — |
| POST | `/api/v1/cameras/{id}/stop` | LiveFeed | — |

Camera object fields used in UI:
```
{ id, name, source_type, source_uri, detection_confidence, is_running, roi_polygon }
```

### Violations
| Method | Path | Used by | Body / Params |
|---|---|---|---|
| GET | `/api/v1/violations` | ViolationsTable, KPI | `?from=ISO&violation_type=&camera_id=&is_resolved=bool&page_size=N` |
| POST | `/api/v1/violations/{id}/resolve` | SnapshotModal | — |
| POST | `/api/v1/violations/{id}/unresolve` | SnapshotModal | — |
| POST | `/api/v1/violations/{id}/flag-false-positive` | SnapshotModal | — |
| POST | `/api/v1/violations/{id}/unflag-false-positive` | SnapshotModal | — |
| GET | `/api/v1/violations/stats` | ViolationChart, HeatMap, Report | `?from=ISO` |
| GET | `/api/v1/violations/export` | FilterBar (CSV link) | — (direct href download) |

Violation object fields used in UI:
```
{ id, violation_type, camera_id, confidence, timestamp, is_resolved, resolved_at,
  is_false_positive, frame_url }
```

Violations list response shape: `{ items: [...], total: N }`

Stats response shape:
```
{ total, by_hour: [{hour, count}], by_type: [{type, count}],
  by_camera: [{camera_id, count}], by_day: [{date, count}] }
```

### Image Detection
| Method | Path | Used by | Body |
|---|---|---|---|
| POST | `/api/v1/detect/image` | ImageDetect | `multipart/form-data` — field `file` |
| GET | `/api/v1/detect/classes` | ImageDetect | — |

Detect response fields:
```
{ annotated_image_base64, filename, total_detections, image_size: {width,height},
  class_counts, violations: [{ppe_item, status, violation_class, violation_count,
  compliant_count, max_confidence}], missing_classes, person_count,
  violation_total, detections: [{class_name, confidence, bbox}] }
```

Classes response: `{ classes: [{class_id, class_name}], confidence_threshold }`

---

## WebSocket

| URL pattern | Direction | Message shape |
|---|---|---|
| `ws[s]://host/api/v1/ws/{cameraId}` | server → client | `{ hardhat_count, vest_count, person_count }` or `{ ping: true }` |

- Open immediately after a camera stream starts.
- Close when the stream stops or another camera is selected.
- Ignore `{ ping: true }` messages.

---

## MJPEG Stream

- URL: `/api/v1/stream/{cameraId}?t={timestamp}` (cache-buster)
- Rendered as `<img src={url} />` inside `LiveFeed.jsx`.
- On `onerror`: stop stream, show toast.

---

## Violation Types (badge colours)

| Type | Tailwind colour |
|---|---|
| `NO-Hardhat` | `bg-red-600` |
| `NO-Mask` | `bg-yellow-400 text-gray-900` |
| `NO-Safety Vest` | `bg-orange-500` |

---

## Violation Filter Options

- **Time range**: Last 24h / Last 7 days / Last 30 days / All time
  - Maps to `from` ISO param: `Date.now() - N ms` or null for "all"
- **Camera**: populated dynamically from `/api/v1/cameras`
- **Violation type**: NO-Hardhat / NO-Mask / NO-Safety Vest (or empty = all)
- **Status**: All / Open only (`is_resolved=false`) / Resolved only (`is_resolved=true`)

---

## Poll Intervals

| Data | Interval |
|---|---|
| Health + KPIs | 5 000 ms |
| Violations table | 5 000 ms |
| Charts | 30 000 ms |
| Heat Map | 120 000 ms |

New-violation toast: compare latest violation id against previous poll; show toast for each new one (max 3, then a "N more" toast).

---

## Camera Form Fields

| Field | Type | Validation |
|---|---|---|
| Name | text | required |
| Source type | select: `webcam` / `rtsp` / `file` | required |
| Source URI | text | required; if RTSP must start with `rtsp://` |
| Detection confidence | range 0.1–1.0 step 0.05 | default 0.5 |

---

## Zone Drawing (ROI Polygon)

- Canvas overlay on `<img>` in LiveFeed
- Coordinates stored as normalized `[[x,y],…]` pairs relative to video content area
- Sent via `PUT /api/v1/cameras/{id}` with `{ roi_polygon: [[x,y],…] | null }`
- Colour: drawing = `#ffc107` dashed, saved = `#0d6efd` solid fill

---

## Heat Map Colour Scale

| Count | Colour |
|---|---|
| 0 | surface (grey) |
| 1–2 | green `#2da44e` |
| 3–5 | yellow `#d29922` |
| 6–10 | orange `#fd7e14` |
| 11+ | red `#cf222e` |

---

## Chart Config

| Chart | Library | Type | Data source |
|---|---|---|---|
| Violations per hour | Recharts LineChart | Line (area fill) | `stats.by_hour` |
| Violations by type | Recharts PieChart | Donut (65% cutout) | `stats.by_type` |
| Violations by camera | Recharts BarChart | Horizontal bar | `stats.by_camera` |

---

## Theme / Design Tokens

Dark slate theme — map to Tailwind:
- Background: `#0d1117` → `bg-gray-950`
- Surface: `#161b22` → `bg-gray-900`
- Surface-2: `#1c2128` → `bg-gray-800`
- Surface-3: `#22272e` → `bg-gray-700`
- Brand / accent: `#ffc107` (safety yellow) → custom `brand` colour
- Text: `#e6edf3`
- Text muted: `#8b949e`

---

## Components Required by Subagents

### Subagent 3 — Dashboard Page
- `frontend/src/components/CameraGrid.jsx`
- `frontend/src/components/LiveFeed.jsx`
- `frontend/src/components/DetectionCounts.jsx`

### Subagent 4 — Violations Page
- `frontend/src/components/ViolationsTable.jsx`
- `frontend/src/components/SnapshotModal.jsx`
- `frontend/src/components/FilterBar.jsx`

### Subagent 5 — Charts Page
- `frontend/src/components/ViolationChart.jsx`
- `frontend/src/components/StatsCard.jsx`
