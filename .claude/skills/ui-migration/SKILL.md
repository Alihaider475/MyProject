---
name: ui-migration
description: >
  Use this skill when working on React UI migration,
  frontend scaffolding, Vite config, Tailwind setup,
  component creation, or any frontend task in the
  frontend/ directory.
version: 1.0.0
---

# UI Migration Skill

## METADATA
| Field       | Value                        |
|-------------|------------------------------|
| Module path | frontend/src/                |
| Framework   | React 18 + Vite + Tailwind   |
| API client  | frontend/src/api/client.js   |
| Components  | frontend/src/components/     |
| Pages       | frontend/src/pages/          |
| Proxy target| http://localhost:8000        |

## RULES

### MUST DO
- MUST keep all components in src/components/
- MUST keep all api calls in src/api/client.js only
- MUST use Tailwind classes only — no inline styles
- MUST proxy /api /frames /ws to :8000 in vite.config.js
- MUST match existing API endpoints exactly

### MUST NOT
- MUST NOT touch any file inside app/ directory
- MUST NOT change any FastAPI endpoint or response shape
- MUST NOT use Bootstrap — Tailwind only
- MUST NOT put api calls inside components directly