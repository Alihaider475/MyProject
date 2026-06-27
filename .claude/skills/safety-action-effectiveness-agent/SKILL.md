---
name: safety-action-effectiveness-agent
description: >
  Use this skill when building, extending, reviewing, or debugging the n8n-powered
  Safety Action Effectiveness Agent for SafeSite AI. Trigger this skill when the
  user mentions safety action effectiveness, corrective action impact, completed
  safety task review, before/after violation comparison, n8n effectiveness review,
  training effectiveness, or measuring whether PPE violations decreased after a
  safety corrective action.
-------------------------

# Safety Action Effectiveness Agent

This skill extends the existing SafeSite AI Safety Corrective Actions feature.

The goal is to create a small, controlled n8n automation that evaluates whether a completed safety corrective action actually reduced the worker’s related PPE violations.

---

## Core Goal

After an admin completes a safety corrective action task, n8n should later evaluate whether the same worker’s same violation type decreased after completion.

This creates a closed-loop safety workflow:

```text
Detect risk
→ Create corrective action
→ Admin completes action
→ n8n evaluates effectiveness
→ Admin sees whether violations improved
```

---

## Strict Scope

### In Scope

* Add a new effectiveness log model/table.
* Add an n8n-only effectiveness evaluation endpoint.
* Use `N8N_SAFETY_ACTION_AGENT_API_KEY` for n8n-only agent endpoint authentication.
* Find completed safety action tasks due for review.
* Compare before vs after violation counts for the same worker and same violation type.
* Calculate improvement percentage.
* Store one effectiveness result per safety action task.
* Avoid duplicate effectiveness logs per task.
* Add an admin JWT endpoint to read effectiveness results.
* Show effectiveness status in the existing Safety Actions admin UI.
* Add n8n docs/workflow JSON for a weekly effectiveness review workflow.

### Out of Scope

* Do not auto-deduct fines.
* Do not send HR emails.
* Do not create follow-up task chains.
* Do not expose n8n keys to the frontend.
* Do not change existing payroll behavior.
* Do not change existing safety task creation behavior.
* Do not change existing fine settlement behavior.
* Do not add file upload evidence.
* Do not add worker punishment automation.

---

## Required Backend Behavior

### New Table / Model

Add a new effectiveness log model/table, for example:

```text
safety_action_effectiveness_logs
```

Recommended fields:

```text
id
task_id
worker_id
month
violation_type
before_count
after_count
improvement_percentage
status
recommendation
reviewed_at
created_at
```

Recommended status values:

```text
effective
partially_effective
not_effective
no_after_data
```

Use existing project database conventions. Do not force UUIDs if the project uses integer IDs. Do not invent an admins table.

---

## n8n-only Endpoint

Add:

```text
POST /api/v1/admin/safety-actions/agent/evaluate-effectiveness
```

Auth:

```text
X-N8N-API-KEY = N8N_SAFETY_ACTION_AGENT_API_KEY
```

This endpoint should:

```text
1. Find completed safety action tasks due for review.
2. Only review tasks where completed_at is old enough for the review window.
3. Identify the worker and related violation type/risk reason.
4. Count related violations before completion.
5. Count related violations after completion.
6. Calculate improvement percentage.
7. Store an effectiveness result.
8. Avoid duplicate logs for the same task.
9. Return a summary count.
```

Example response:

```json
{
  "reviewed_count": 1,
  "effective": 1,
  "partially_effective": 0,
  "not_effective": 0,
  "no_after_data": 0,
  "skipped_duplicates": 0
}
```

---

## Admin Read Endpoint

Add an admin JWT-protected endpoint such as:

```text
GET /api/v1/admin/safety-actions/effectiveness
```

Purpose:

```text
Return effectiveness results for the admin Safety Actions UI.
```

The frontend must use the existing admin JWT/session auth only. It must never send or contain `X-N8N-API-KEY`.

---

## Effectiveness Logic

Use a simple before/after comparison.

Example:

```text
Task: Mandatory NO-Mask compliance re-training
Worker: Abid
Completed at: 2026-07-04
Violation type: NO-Mask
Before window: 7 days before completion
After window: 7 days after completion
```

Example result:

```text
Before count: 23
After count: 5
Improvement: 78%
Status: effective
```

Suggested scoring:

```text
If after_count is 50% or more lower than before_count:
  status = effective

If after_count decreased but less than 50%:
  status = partially_effective

If after_count is same or increased:
  status = not_effective

If there is no after-window data:
  status = no_after_data
```

Keep this logic simple and explainable for FYP defense.

---

## Duplicate Prevention

The system must not create duplicate effectiveness logs.

Recommended rule:

```text
One effectiveness log per safety_action_task_id
```

Use DB-level uniqueness if possible.

Example:

```text
UNIQUE(task_id)
```

The endpoint must be safe to run repeatedly from n8n.

---

## n8n Workflow

Create a separate workflow:

```text
Safety Action Effectiveness Review
```

Recommended flow:

```text
Schedule Trigger weekly
→ POST /api/v1/admin/safety-actions/agent/evaluate-effectiveness
→ Set/Log effectiveness counts
```

Required HTTP headers:

```text
X-N8N-API-KEY = N8N_SAFETY_ACTION_AGENT_API_KEY
ngrok-skip-browser-warning = true
```

Do not include real secrets in the workflow JSON. Use safe placeholders only.

Safe placeholders:

```text
REPLACE_WITH_BACKEND_BASE_URL
REPLACE_WITH_SAFETY_ACTION_AGENT_KEY
```

---

## Frontend UI

Update the existing Safety Actions admin UI.

Show effectiveness information for completed tasks.

Recommended display:

```text
Effectiveness: Pending Review
Effectiveness: Effective
Effectiveness: Partially Effective
Effectiveness: Not Effective
Effectiveness: No After Data
```

For reviewed tasks, show:

```text
Before count
After count
Improvement percentage
Recommendation
Reviewed date
```

Example UI row:

```text
Worker: Abid
Action: Mandatory NO-Mask compliance re-training
Status: Completed
Effectiveness: Effective
Before: 23
After: 5
Improvement: 78%
```

---

## Security Rules

```text
n8n endpoint:
  Uses X-N8N-API-KEY with N8N_SAFETY_ACTION_AGENT_API_KEY

Admin frontend endpoint:
  Uses existing admin JWT/session

Frontend:
  Must never contain or send X-N8N-API-KEY
```

Do not expose secrets in:

```text
frontend code
workflow JSON
API responses
documentation examples
screenshots
```

---

## Testing Requirements

Add or update tests for:

```text
- n8n endpoint rejects missing/wrong safety action key
- n8n endpoint accepts correct N8N_SAFETY_ACTION_AGENT_API_KEY
- completed tasks due for review are evaluated
- incomplete/pending tasks are not evaluated
- duplicate effectiveness logs are not created
- before_count and after_count are calculated correctly
- improvement_percentage is calculated correctly
- status is effective / partially_effective / not_effective / no_after_data correctly
- frontend/admin endpoint requires admin JWT
- frontend does not use X-N8N-API-KEY
- existing payroll risk analysis behavior remains unchanged
- existing safety action task creation behavior remains unchanged
```

---

## Required Agent Behavior

Before editing code:

```text
1. Explore the current Safety Corrective Actions feature.
2. Inspect existing models, routes, schemas, API client, UI page, tests, and n8n docs.
3. Identify exact files to change.
4. Present a plan.
5. Wait for approval.
```

After implementation:

```text
1. List changed files.
2. Explain backend changes.
3. Explain frontend changes.
4. Explain n8n workflow changes.
5. Explain how duplicate prevention works.
6. Explain how effectiveness is calculated.
7. Run relevant backend tests.
8. Run frontend build.
9. Provide manual verification steps.
```

---

## FYP Defense Explanation

Use this explanation:

```text
The first n8n workflow detects high-risk workers and creates corrective safety actions.
The second n8n workflow evaluates whether those completed actions actually reduced violations.
This makes SafeSite AI a closed-loop safety automation system: detect risk, create action, complete action, and measure improvement.
```
