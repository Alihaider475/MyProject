You are working on my SafeSite AI project repository.

Project stack:

* Frontend: React 18, Vite, Tailwind CSS, React Router, Recharts, Redux Toolkit, React Query where already used
* Backend: Python FastAPI, SQLAlchemy, SQLite/PostgreSQL, YOLO/Ultralytics, OpenCV, Supabase Auth, WebSocket/MJPEG streaming
* Project folder: Construction-PPE-Detection

Goal:
Clean and reorganize my project into a proper development-ready structure by removing unused, duplicate, unnecessary, temporary, generated, and dead files/folders without breaking the application.

Important rules:

1. Do not delete anything blindly.
2. First inspect the full repository structure.
3. Check current git status before making changes.
4. Identify unused files, duplicate files, old experiment files, backup files, cache files, generated build files, unnecessary logs, old screenshots, temporary pasted files, unused scripts, unused components, and unused imports.
5. Before deleting any source file, verify whether it is imported, referenced, executed, or required by frontend/backend.
6. Do not remove .env.example, README, package.json, requirements files, migration files, model config files, or important documentation unless they are clearly duplicate/obsolete.
7. Do not delete trained model weights such as .pt files unless they are clearly duplicate and confirm which one is active in config.
8. Do not delete database files if the app depends on them for local development.
9. Do not remove working Redux Toolkit migration files.
10. Do not remove AuthContext unless a complete auth migration is intentionally planned.
11. Do not change backend API endpoint names unless required for cleanup.
12. Do not redesign UI.
13. Do not change business logic.
14. Do not remove Docker files if they are part of development/deployment workflow; only clean duplicates or unused Docker files after verification.
15. Keep the project runnable locally after cleanup.

Required workflow:
Step 1: Repository audit

* Print a tree-style summary of the current project structure.
* Identify files/folders that look unnecessary or suspicious.
* Categorize them as:
  A. Safe to delete
  B. Possibly unused but needs verification
  C. Must keep
  D. Should be moved/renamed
* Explain the reason for each suggested cleanup.

Step 2: Dependency and reference check

* For frontend, check imports and references across src/.
* For backend, check Python imports, route registration, config usage, model path usage, database usage, and script references.
* Check package.json scripts.
* Check requirements.txt / pyproject / dependency files if available.
* Check .gitignore coverage.
* Check Vite build output location.
* Check whether dist/, node_modules/, **pycache**, .pytest_cache, .ruff_cache, logs, temp files, and local DB files are properly ignored.

Step 3: Create a clean target structure
Propose and then implement a professional structure similar to this, adapting to the actual project:

Construction-PPE-Detection/
backend/
app/ or backend/
api/
core/
db/
models/
schemas/
services/
routes/
utils/
tests/
requirements.txt
.env.example
frontend/
src/
app/
components/
features/
pages/
services/
hooks/
contexts/
utils/
assets/
package.json
vite.config.js
.env.example
docs/
scripts/
models/
storage/
README.md
.gitignore

Only move files if it improves clarity and does not break imports. After moving files, update imports correctly.

Step 4: Cleanup implementation

* Delete only verified unnecessary files.
* Remove unused imports.
* Remove dead components only if no references exist.
* Remove duplicate API helper files only if one canonical service exists.
* Remove old build artifacts from git tracking if present.
* Improve .gitignore for frontend/backend:
  node_modules/
  dist/
  build/
  .env
  .env.*
  !.env.example
  **pycache**/
  *.pyc
  .pytest_cache/
  .ruff_cache/
  .mypy_cache/
  logs/
  *.log
  temp/
  tmp/
  .DS_Store
  Thumbs.db
* Keep required sample env files.

Step 5: Validation
After cleanup, run:

* frontend: npm install if needed, npm run build
* backend: python -m compileall backend or equivalent safe syntax check
* backend server import check if possible
* run any existing tests if available
* verify no broken imports
* verify frontend routes still build
* verify package lock is consistent

Step 6: Final report
After completing the cleanup, provide a clear summary:

* Files deleted
* Files moved/renamed
* Imports updated
* .gitignore changes
* Final project structure
* Commands run
* Build/test results
* Any files intentionally kept even though they looked suspicious
* Any cleanup items deferred because they need manual confirmation

Important:
If you are unsure whether a file is safe to delete, do not delete it. Put it in the “needs manual review” list instead.
