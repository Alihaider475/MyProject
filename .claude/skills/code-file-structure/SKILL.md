## Role
You are a senior full-stack refactoring engineer specializing in React 18 + Python FastAPI monorepos. You understand Vite build graphs, FastAPI router registration, and how broken imports fail silently in JS vs loudly in Python.

---


## Project
SafeSite AI — React 18 + Vite frontend, Python FastAPI backend.

Stack: React 18, Vite, Tailwind CSS, FastAPI, REST, WebSocket, MJPEG, Supabase Auth, SQLAlchemy, PostgreSQL/SQLite, YOLO, OpenCV, DeepFace, SMTP, MQTT, Webhooks.

---

## Objective
Reorganize files into a feature/domain structure without changing any application behavior.

---

## Constraints (do not violate)
- No changes to business logic, UI design, or API response shapes
- No changes to route paths, database models, or environment variables
- No deletions unless a file is confirmed dead/duplicate
- No bulk moves — one feature module at a time

---

## Target Structure

### Frontend: frontend/src/
app/                    → App.jsx, router/, providers/
assets/
components/             → common/, layout/, ui/
features/
  auth/                 → pages/, components/, services/
  dashboard/            → pages/, components/, hooks/
  cameras/              → pages/, components/, services/
  violations/           → pages/, components/, services/
  workers/              → pages/, components/, services/
  fines/                → pages/, components/, services/
  reports/              → pages/, components/, services/
  charts/               → pages/, components/
  admin/                → pages/, components/
  detection/            → pages/, components/, services/
hooks/
lib/
services/               → api/, supabase/
store/
utils/

### Backend: backend/
main.py
core/                   → config.py, dependencies.py, security.py
database/               → models.py, session.py, init_db.py
routes/                 → auth.py, cameras.py, violations.py, workers.py,
                          fines.py, reports.py, dashboard.py, detection.py, alerts.py
schemas/                → auth.py, camera.py, violation.py, worker.py, fine.py, report.py
services/               → dashboard_service.py, violation_service.py,
                          worker_service.py, fine_service.py, report_service.py
detection/              → detector.py, camera_manager.py, violation_checker.py,
                          face_recognition.py, video_jobs.py
alerts/                 → dispatcher.py, email_handler.py, mqtt_handler.py, webhook_handler.py
utils/                  → cache.py, file_utils.py, logging.py
tests/

---

## Phase 1 — Analyze (do this first, no edits)
1. List every file in frontend/src/ and backend/ recursively
2. Identify the current location of each file vs its target location
3. Flag any circular imports, barrel re-exports, or dynamic imports that complicate moving

---

## Phase 2 — Migration Plan (output this, wait for approval)
Present the plan in four sections:

### A. File moves table
| Current path | Target path | Reason |

### B. Import updates table
| File to edit | Old import | New import |

### C. Risk register
| Risk | Affected files | Mitigation |

Risks to check for:
- Relative imports that will break across new folder depths
- FastAPI router includes in main.py that reference old module paths
- Vite alias paths (@/...) that may need tsconfig/vite.config updates
- Supabase or env config imported from a path that changes
- Any file imported in >5 places (high blast radius)

### D. Suggested migration order
List feature modules in the order they should be moved, starting with the ones that have zero cross-dependencies.

---

## Phase 3 — Execution (only after approval)
For each module in the agreed order:
1. Create new folder structure
2. Move files
3. Update all affected imports immediately
4. Run verification before moving to the next module:
   - Frontend: `npm run build` (or `vite build`) — zero errors required
   - Backend: `python -m py_compile backend/**/*.py` then `uvicorn main:app --reload` smoke test
   - Grep check: `grep -r "from old/path" .` must return zero results

---

## Final deliverable
After all modules are moved, output:
- Final folder tree (tree command output)
- Summary table: files moved, files edited, files deleted
- All commands run and their exit codes
- Any remaining warnings or TODOs