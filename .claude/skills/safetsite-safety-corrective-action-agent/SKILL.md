---
name: n8n-safety-corrective-action-agent
description: >
  Use this skill when building, extending, or reviewing an n8n-powered Safety
  Corrective Action Agent that creates deduplicated corrective action tasks for
  high-risk payroll workers. Triggers on any mention of: safety corrective
  actions, n8n risk analysis automation, corrective task creation from payroll
  risk analysis, safety action task deduplication, escalation workflows, or
  admin completion flows for worker safety tasks. Always use this skill when
  the user is working on the safety-actions module within an existing n8n
  Payroll Risk Analysis Agent.
---

# n8n Safety Corrective Action Agent

Extension of an existing n8n Payroll Risk Analysis Agent that creates
**deduplicated, scoped, non-auto-escalating** corrective action tasks for
high-risk workers only. This skill encodes all constraints that prevent
over-automation.

---

## Scope Boundaries (Non-Negotiable)

Before writing any code, internalize these hard limits:

| What is IN scope | What is OUT of scope |
|---|---|
| Create one task per worker × month × risk reason | Auto-follow-up task chains |
| Deduplicate via DB unique key | Auto-fine deduction |
| Escalate only overdue pending tasks (once) | HR email sending |
| Admin manually completes tasks | File upload evidence |
| P1 is max priority — no escalation beyond P1 | Changing payroll report behavior |
| Frontend uses admin JWT only | Exposing X-N8N-API-KEY to frontend |

---

## Database Schema

### `safety_action_tasks`

```sql
CREATE TABLE safety_action_tasks (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  worker_id             UUID NOT NULL REFERENCES workers(id),
  month                 DATE NOT NULL,                        -- first day of month
  risk_reason_hash      TEXT NOT NULL,                       -- SHA-256 of normalized risk reason string
  action_title          TEXT NOT NULL,
  priority              TEXT NOT NULL CHECK (priority IN ('P1','P2','P3')),
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','completed','escalated')),
  deadline_date         DATE NOT NULL,
  created_by            TEXT NOT NULL DEFAULT 'n8n-agent',
  created_from_log_id   UUID REFERENCES payroll_risk_logs(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at          TIMESTAMPTZ,
  completed_by_admin_id UUID REFERENCES admins(id),
  completion_notes      TEXT,
  escalated_at          TIMESTAMPTZ,

  -- DB-level idempotency guard
  CONSTRAINT uq_worker_month_reason UNIQUE (worker_id, month, risk_reason_hash)
);
```

**Key design decisions:**
- `month` stores the first day of the month (e.g., `2025-07-01`) for clean indexing.
- `risk_reason_hash` is `SHA-256(lower(trim(risk_reason)))` — compute in application layer before insert.
- The `UNIQUE` constraint is the primary idempotency mechanism; the application layer is a secondary guard.

---

## Backend Endpoints

### 1. `POST /api/v1/admin/safety-actions/agent/create-from-risk-analysis`

**Auth:** `X-N8N-API-KEY` (server-side header only — never expose to frontend)  
**Purpose:** Create deduplicated corrective action tasks from a risk analysis result.

**Request body:**
```json
{
  "log_id": "uuid",
  "month": "2025-07",
  "high_risk_workers": [
    {
      "worker_id": "uuid",
      "risk_reason": "Missed 3 consecutive safety trainings",
      "suggested_priority": "P2"
    }
  ]
}
```

**Implementation logic:**
```
FOR EACH high_risk_worker:
  hash = SHA256(normalize(risk_reason))
  INSERT INTO safety_action_tasks (worker_id, month, risk_reason_hash, ...)
  ON CONFLICT (worker_id, month, risk_reason_hash) DO NOTHING

RETURN { created: N, skipped_duplicates: M }
```

**Response:**
```json
{
  "created": 3,
  "skipped_duplicates": 1,
  "task_ids": ["uuid1", "uuid2", "uuid3"]
}
```

**Rules:**
- `ON CONFLICT DO NOTHING` — never update an existing task on retry.
- Retrying this endpoint with the same payload must be idempotent.
- Never create tasks for workers NOT in `high_risk_workers`.

---

### 2. `POST /api/v1/admin/safety-actions/agent/escalate-overdue`

**Auth:** `X-N8N-API-KEY`  
**Purpose:** Mark overdue pending tasks as escalated (atomic, guarded).

**Implementation logic (single atomic SQL):**
```sql
UPDATE safety_action_tasks
SET
  status       = 'escalated',
  escalated_at = now(),
  priority     = CASE WHEN priority = 'P3' THEN 'P2'
                      WHEN priority = 'P2' THEN 'P1'
                      ELSE priority           -- P1 stays P1
                 END
WHERE
  status        = 'pending'          -- guard: only pending tasks
  AND escalated_at IS NULL           -- guard: escalate only once
  AND deadline_date < CURRENT_DATE;  -- guard: only overdue
```

**Response:**
```json
{ "escalated_count": 4 }
```

**Rules:**
- `completed` tasks are never touched.
- `escalated` tasks are never re-escalated (guarded by `escalated_at IS NULL`).
- P1 priority is never incremented further.
- This endpoint is safe to call repeatedly (idempotent due to guards).

---

### 3. `GET /api/v1/admin/safety-actions`

**Auth:** Existing admin JWT  
**Purpose:** List all safety action tasks for the admin UI.

**Query params (optional):** `status`, `priority`, `worker_id`, `month`

**Response:**
```json
{
  "tasks": [
    {
      "id": "uuid",
      "worker_name": "Ahmed Khan",
      "worker_id": "uuid",
      "month": "2025-07",
      "action_title": "Safety training follow-up",
      "priority": "P2",
      "status": "pending",
      "deadline_date": "2025-07-31",
      "risk_reason": "Missed 3 consecutive safety trainings",
      "escalated_at": null,
      "created_at": "2025-07-01T10:00:00Z"
    }
  ]
}
```

---

### 4. `PATCH /api/v1/admin/safety-actions/{id}/complete`

**Auth:** Existing admin JWT  
**Purpose:** Admin manually marks a task as completed.

**Request body:**
```json
{
  "completion_notes": "Worker completed remedial training on 2025-07-28."
}
```

**Implementation logic:**
```sql
UPDATE safety_action_tasks
SET
  status                = 'completed',
  completed_at          = now(),
  completed_by_admin_id = :admin_id_from_jwt,
  completion_notes      = :notes
WHERE
  id = :task_id
  AND status != 'completed';   -- idempotency guard
```

**Rules:**
- `completed_by_admin_id` is always extracted from the JWT — never from the request body.
- `completion_notes` is optional.
- No file upload in this version.
- A completed task cannot be re-completed or escalated.

---

## n8n Workflow Changes

### Main Payroll Risk Analysis Workflow (extend after existing log POST)

```
[Existing: POST /payroll-risk-analysis → save log]
        |
        ↓
[IF high_risk_workers.length > 0]
        |
        ↓
[POST /api/v1/admin/safety-actions/agent/create-from-risk-analysis]
  Header: X-N8N-API-KEY
  Body: { log_id, month, high_risk_workers }
        |
        ↓
[Set node: save { created, skipped_duplicates } to workflow vars]
        |
        ↓
[Continue — do NOT create follow-up tasks]
```

**Critical:** Only add nodes AFTER the existing log success. Do NOT modify upstream payroll or risk analysis nodes.

### Separate Escalation Workflow (scheduled, optional)

```
[Cron trigger: daily at 08:00 or weekly on Monday]
        |
        ↓
[POST /api/v1/admin/safety-actions/agent/escalate-overdue]
  Header: X-N8N-API-KEY
        |
        ↓
[IF node: escalated_count > 0]
        |
        ↓
[Log node: "Escalated {count} overdue tasks"]
```

**Do NOT add:**
- Follow-up task creation after escalation
- Email triggers
- Fine deduction nodes

---

## Frontend — Admin UI

Add a **Safety Corrective Actions** section to the existing Admin panel.

### Task list table columns

| Column | Source field |
|---|---|
| Worker Name | `worker_name` |
| Month | `month` |
| Action Title | `action_title` |
| Priority | `priority` (render P1 as red badge, P2 yellow, P3 green) |
| Status | `status` (render as pill: pending/escalated/completed) |
| Deadline | `deadline_date` |
| Risk Reason | `risk_reason` |
| Actions | "Complete" button (only visible when status = pending or escalated) |

### Completion modal (triggered by "Complete" button)

```
[ Completion Notes (textarea, optional) ]
[ Confirm Complete ]  [ Cancel ]
```

On confirm: `PATCH /api/v1/admin/safety-actions/{id}/complete`  
Auth: admin JWT from cookie/session — never hardcode or expose `X-N8N-API-KEY`.

---

## Security Model

```
n8n workflows        →  X-N8N-API-KEY  →  /agent/* endpoints (write)
Admin browser UI     →  JWT (admin)    →  /safety-actions GET + PATCH
Frontend JS bundle   →  ✗ NEVER contains X-N8N-API-KEY
```

Enforce at the API gateway / middleware layer:
- `/agent/*` routes: reject requests without valid `X-N8N-API-KEY`, regardless of JWT.
- `/safety-actions` and `/safety-actions/{id}/complete`: reject requests without valid admin JWT.

---

## Test Cases

Implement and verify all of the following before shipping:

```
✓ Duplicate prevention
  - Insert same (worker_id, month, risk_reason_hash) twice → second insert skipped
  - Retrying n8n create endpoint returns same created=N, skipped_duplicates increases

✓ Escalation guards
  - Overdue pending task → escalated once, escalated_at set
  - Re-running escalate-overdue → same task NOT escalated again (escalated_at IS NOT NULL guard)
  - Completed task → NOT escalated
  - P1 task → priority stays P1 after escalation attempt

✓ Completion
  - Admin completes task → status=completed, completed_by_admin_id set from JWT
  - completion_notes stored if provided, null if omitted
  - Completed task cannot be re-completed

✓ Auth isolation
  - Frontend request to /agent/* with JWT only → 401/403
  - n8n request to /safety-actions/complete with API key only → 401/403
  - X-N8N-API-KEY must not appear in any frontend bundle or network request from browser

✓ Regression
  - Existing payroll report endpoint returns same response as before
  - Existing risk analysis log behavior unchanged
  - No new fields added to existing payroll response schemas
```

---

## Priority & Status Reference

| Value | Meaning |
|---|---|
| P1 | Critical — immediate action required. Maximum priority; never escalate beyond this. |
| P2 | High — action required within deadline. Escalates to P1 if overdue. |
| P3 | Medium — action recommended. Escalates to P2 if overdue. |

| Status | Set by | Transition rules |
|---|---|---|
| `pending` | n8n on creation | → `completed` (admin) or → `escalated` (scheduled job, once) |
| `escalated` | Scheduled n8n job | → `completed` (admin). Cannot re-escalate. |
| `completed` | Admin via UI | Terminal state. Cannot transition to any other status. |

---

## What NOT to Build (Checklist)

Before marking this feature done, confirm none of these exist:

- [ ] Auto-follow-up task creation after escalation
- [ ] Task chains (task creates another task)
- [ ] Automated fine deduction
- [ ] HR or worker email notifications
- [ ] File upload / evidence attachment endpoints
- [ ] X-N8N-API-KEY in any frontend code, env var exposed to client, or API response
- [ ] Priority escalation beyond P1
- [ ] Escalation of completed tasks
- [ ] Changes to existing payroll report or risk analysis response shapes