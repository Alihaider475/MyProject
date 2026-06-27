# SafeSite AI — Safety Action Effectiveness Agent

## Purpose

This n8n workflow closes the safety automation loop. After an admin marks a corrective action complete, the workflow evaluates whether the same worker's same violation type decreased in the 7 days after completion vs. the 7 days before.

```
Detect risk → Create corrective action → Admin completes action → n8n evaluates effectiveness → Admin sees results
```

---

## Workflow Schedule

Runs every Monday at 09:00 UTC:

```
0 9 * * 1
```

---

## Endpoint Called

```
POST /api/v1/admin/safety-actions/agent/evaluate-effectiveness
```

### Required Headers

```
X-N8N-API-KEY: <N8N_SAFETY_ACTION_AGENT_API_KEY>
ngrok-skip-browser-warning: true
```

### Response

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

## How Effectiveness Is Calculated

For each completed safety action task, the backend:

1. Extracts the PPE violation type from `risk_reason` (e.g. "NO-Hardhat").
2. Counts violations for that worker and violation type in the **before window**: `[completed_at − 7 days, completed_at)`.
3. Counts violations in the **after window**: `(completed_at, completed_at + 7 days]`.
4. Applies scoring:

| Condition | Status |
|---|---|
| `before == 0` and `after == 0` | `no_after_data` |
| `after ≤ before × 0.5` and `before > 0` | `effective` |
| `after < before` (but not 50% reduction) | `partially_effective` |
| `after ≥ before` | `not_effective` |

5. Stores one result per task. Duplicate runs skip already-reviewed tasks.

---

## Demo / FYP Configuration

To evaluate tasks immediately without waiting 7 days, set in `.env`:

```env
EFFECTIVENESS_REVIEW_WINDOW_DAYS=0
```

When set to `0`, all completed tasks are eligible for review immediately and the before/after window uses a 7-day lookback regardless.

---

## Required Environment Variables

| Variable | Purpose |
|---|---|
| `N8N_SAFETY_ACTION_AGENT_API_KEY` | Shared secret for this endpoint. Set in both `.env` and n8n credentials. |
| `EFFECTIVENESS_REVIEW_WINDOW_DAYS` | Days to wait after completion before evaluating (default: 7, set 0 for demo). |

---

## n8n Workflow Setup

1. Import `safety-action-effectiveness-agent.workflow.json` into n8n.
2. Replace `REPLACE_WITH_BACKEND_BASE_URL` with your backend URL (e.g. `https://xxxx.ngrok-free.app`).
3. Replace `REPLACE_WITH_SAFETY_ACTION_AGENT_KEY` with the value of `N8N_SAFETY_ACTION_AGENT_API_KEY` from your `.env`.
4. Activate the workflow.

---

## Security

- The `X-N8N-API-KEY` is only used by the n8n agent endpoint. It is never sent from the React frontend.
- The admin read endpoint (`GET /api/v1/admin/safety-actions/effectiveness`) uses Supabase JWT only.
- The effectiveness results appear automatically in the Safety Actions admin UI for completed tasks.

---

## FYP Defense Explanation

> "The first n8n workflow detects high-risk workers and creates corrective safety actions. The second n8n workflow evaluates whether those completed actions actually reduced violations. This makes SafeSite AI a closed-loop safety automation system: detect risk, create action, complete action, and measure improvement."
