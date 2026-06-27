---
name: gitlab-ci
description: "Use this skill when setting up or fixing a GitLab CI/CD pipeline for the SafeSite AI project. Triggers: any task involving .gitlab-ci.yml creation, GitLab pipeline stages, CI for FastAPI/React/Docker/ML projects, pre-merge build checks, or Docker image build in CI. Do NOT add CD/deployment, do NOT hardcode secrets, do NOT modify production code, do NOT commit .env files."
---

# SafeSite AI — GitLab CI Pipeline Skill

## Role

Act as an expert GitLab CI/CD + Docker + FastAPI/React DevOps Engineer.

---

## Project Context

| Layer       | Technology                              |
|-------------|-----------------------------------------|
| Frontend    | React + Vite                            |
| Backend     | FastAPI (Python 3.11)                   |
| ML          | YOLO, OpenCV, DeepFace                  |
| Database    | Supabase cloud PostgreSQL (external)    |
| Container   | Docker Compose — backend + Redis        |
| SPA Serving | Backend serves built React `/dist`      |
| Health Check| `GET /api/v1/health` (confirmed working)|

---

## Goal

Create a safe GitLab CI pipeline that checks the project is not broken on every push — before merging. **CI only — no CD/deployment yet.**

---

## Hard Rules (never violate)

- Do NOT modify production backend or frontend code
- Do NOT hardcode secrets anywhere
- Do NOT commit `.env` files
- Do NOT add deployment/CD stages yet
- Do NOT test webcam in CI
- Do NOT run expensive video detection in CI
- Do NOT require Supabase secrets for basic build checks unless absolutely necessary
- Keep these out of the repository entirely: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`

---

## Strict Workflow

1. Inspect the repository structure first
2. Show the plan and wait for approval
3. Only after approval: create/edit `.gitlab-ci.yml`
4. Run any local validation possible
5. Provide final git commands

---

## Phase 1 — Repository Inspection

### Inspect these files

- `frontend/package.json`
- `requirements/prod.txt` and `requirements/base.txt`
- `docker/Dockerfile`
- `docker-compose.yml`
- `backend/main.py`
- Existing `tests/` folder
- Current branch structure if possible

---

## Phase 2 — Required CI Stages

### Stage 1: `frontend_build`

- Image: Node (LTS)
- Steps:
  1. `npm ci`
  2. `npm run build`

### Stage 2: `backend_check`

- Image: Python 3.11
- Steps:
  1. Install required Linux packages for OpenCV if needed
  2. Install Python dependencies from requirements files
  3. Run Python compile check on backend
  4. Run `pytest` only if tests are available and stable

### Stage 3: `docker_build`

- Build `docker/Dockerfile`
- Do NOT push image yet
- Run on: `dev`, `main` branches and merge requests

---

## Phase 3 — Approval Gate

Before creating any files, show:

1. Proposed `.gitlab-ci.yml` structure
2. Which jobs run on: feature branches / dev / main / merge requests
3. Which secrets/variables are needed in GitLab CI settings
4. Expected pipeline runtime estimate
5. Any risks due to heavy ML dependencies (YOLO, OpenCV, DeepFace)

**Wait for explicit approval before editing any files.**

---

## Phase 4 — Implementation

### File to create

`.gitlab-ci.yml` only — unless a strong reason exists for a small supporting file.

### Performance considerations

- ML dependencies are heavy — keep the pipeline practical and not too slow
- Cache `pip` and `npm` dependencies between runs where possible
- Consider using a pre-built Docker image with ML deps for `backend_check` if install time is too long

### Secrets management

Use GitLab CI/CD Variables (Settings → CI/CD → Variables) for any required secrets. If a health smoke test is added, document exactly which variables are required.

---

## Phase 5 — Delivery

After implementation provide these exact commands:

```bash
git status
git add .gitlab-ci.yml
git commit -m "Add GitLab CI pipeline"
git push
```

Then explain:
- How to check the pipeline in GitLab UI (CI/CD → Pipelines)
- How to read job logs for each stage
- What a passing pipeline looks like vs a failing one