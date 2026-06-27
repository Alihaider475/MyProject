# n8n Payroll Risk Analysis Agent

> **UC_16 amendment (n8n agent scope):** The n8n Payroll Risk Analysis Agent does NOT
> mark fines as deducted. It performs monthly risk analysis, saves an audit log, and
> creates scoped corrective action tasks for high-risk workers.
> All fine status updates (deducted / waived) remain manual from the Admin Payroll page
> by the administrator.

---

## 1. Purpose — why this is NOT a report downloader

The Admin Payroll page already generates and downloads monthly fine reports (PDF/CSV) and
lets an administrator finalize a month. That feature is untouched.

This agent is a separate, automated **analytical** layer. Once a month it:

- scores every worker's **risk** using a weighted, auditable formula,
- detects **repeat offenders** (the same violation type recurring),
- compares the month against a **3-month rolling baseline** to spot spikes,
- groups risk by **department**,
- emits structured **recommendations** (P1/P2/P3) with owners and deadlines,
- saves an **audit log** of the run,
- creates **deduplicated corrective action tasks** for high-risk workers after the log is saved,

and the Admin Payroll page surfaces the latest run in a small read-only "n8n Risk Insights"
panel. The Admin Safety Corrective Actions page lists and completes the generated tasks.
It never emails HR, never changes fine status, and never creates follow-up task chains.

## 2. Difference between the Admin Payroll Report and this agent

| | Admin Payroll Report (existing) | n8n Risk Analysis Agent (this feature) |
|---|---|---|
| Trigger | Manual, by an admin in the browser | Automated, monthly via n8n schedule |
| Output | PDF / CSV of fines per worker | Risk scores, recommendations, audit log, corrective action tasks |
| Changes fine status | Yes (Finalize Month → deducted) | **Never** |
| Auth | Supabase admin JWT | `X-N8N-API-KEY` (execution) + JWT (history read) |
| Frontend role | Full page | Read-only insights panel plus admin safety action task list |

## 3. n8n workflow (ASCII)

```text
┌──────────────────────┐
│  Schedule Trigger     │  1st of each month, 09:00
│  (cron)               │
└──────────┬───────────┘
           │
┌──────────▼───────────┐
│  Code: compute month  │  month = previous calendar month as YYYY-MM
└──────────┬───────────┘
           │
┌──────────▼───────────────────────────────┐
│  HTTP GET /risk-analysis?month={{month}}   │  header X-N8N-API-KEY
│  retryOnFail=3, wait 2000ms                │
└──────────┬───────────────────────────────┘
           │ (on success)
┌──────────▼───────────┐
│  IF status == "empty"│
└───┬──────────────┬───┘
    │ true         │ false
┌───▼────────┐  ┌──▼─────────────┐
│ POST log    │  │ POST log        │
│ status=empty│  │ status=success  │
└─────────────┘  └────────────────┘

        (error path, any HTTP failure)
┌────────────────────────────────────────┐
│  POST /risk-analysis-log status=failed   │  include error_message
└────────────────────────────────────────┘
```

After `POST log (success)` returns, the workflow checks
`high_risk_workers.length > 0`. If true, it posts to
`/api/v1/admin/safety-actions/agent/create-from-risk-analysis` with:

```json
{
  "log_id": "id returned by POST log (success)",
  "month": "YYYY-MM",
  "high_risk_workers": [
    {
      "worker_id": 1,
      "risk_reason": "joined risk_reasons from risk analysis",
      "suggested_priority": "P1",
      "action_title": "recommendation action"
    }
  ]
}
```

The safety action endpoint deduplicates with `(worker_id, month, risk_reason_hash)`.
Retries can safely call it again; duplicates are skipped. The workflow stores only
`created`, `skipped_duplicates`, and `task_ids` counts after this step. It does not
create follow-up tasks, send email, or touch fines.

## 4. Required environment variables

| Name | Description | Example value |
|---|---|---|
| `N8N_PAYROLL_AGENT_API_KEY` | Shared secret for `/risk-analysis` and `/risk-analysis-log` payroll agent endpoints. | `a-long-random-string` |
| `N8N_SAFETY_ACTION_AGENT_API_KEY` | **Separate** shared secret for `/safety-actions/agent/*` endpoints. Must differ from the payroll key — key isolation prevents a compromised payroll credential from writing safety tasks. | `another-long-random-string` |

Set both in the backend `.env` (git-ignored). `.env.example` carries the placeholders only.
In n8n, store each value as its own credential / variable.

## 5. Configuring `X-N8N-API-KEY` in the n8n HTTP Request nodes

1. Nodes that call `/risk-analysis` or `/risk-analysis-log` use `{{N8N_PAYROLL_AGENT_API_KEY}}`.
2. The node that calls `/safety-actions/agent/create-from-risk-analysis` uses
   `{{N8N_SAFETY_ACTION_AGENT_API_KEY}}` — a **different** credential.
3. Set **Authentication** to *None* on all of these nodes (plain custom header).
4. Do **not** add either key to anything the React frontend calls — history and task list
   endpoints use the admin's Supabase JWT instead.
5. Keep both values out of logs and out of source control.

## 6. Risk scoring formula (with worked example)

Per worker, for the selected month:

```text
repeat_penalty = max(0, max_same_violation_repeat_count - 1) * 15
trend_penalty  = (see §8; 0 if no 3-month history)
risk_score = (monthly_violations * 10)
           + (total_fine_amount / 300)
           + repeat_penalty
           + trend_penalty
```

Levels: worker `high` ≥ 50, `medium` ≥ 25, else `normal`.

**Worked example** — worker with 3 `NO-Hardhat` violations this month, PKR 1500 in fines,
and a 3-month baseline of 1 violation / PKR 500 per month:

```text
monthly_violations = 3                    → 3 * 10            = 30.0
total_fine_amount  = 1500                 → 1500 / 300        =  5.0
max_same_repeat    = 3 → max(0,3-1)*15    = repeat_penalty    = 30.0
trend: 3 > 1*1.30 (+15), 1500 > 500*1.30 (+10) → trend_penalty = 25.0
                                            risk_score          = 90.0  → high
```

## 7. 3-month rolling baseline (calendar example)

For **selected month 2025-06**, the baseline is the three immediately preceding calendar
months: **2025-05, 2025-04, 2025-03**.

- `previous_3_month_avg_violations` = (May + Apr + Mar violation counts) / 3.
- A month with no data counts as **0** in the average (it is not skipped).
- Example: 3 violations in May, 0 in April, 0 in March → baseline average = 3 / 3 = **1.0**.

## 8. Repeat offender detection

- For each worker, count how many times **each** violation type occurs in the selected month.
- `max_same_violation_repeat_count` = the highest of those per-type counts.
- `repeat_penalty = max(0, count - 1) * 15`, so a single unique violation contributes **0**;
  only the 2nd, 3rd, … occurrence of the same type is penalised.
- When `max_same_violation_repeat_count >= 2`, a human-readable string such as
  `"Repeat offender: 3× NO-Hardhat in 2025-06"` is added to the worker's `risk_reasons`.

Trend penalty (spike vs baseline), with a zero-baseline guard:

```text
if baseline_violations == 0 and baseline_fine == 0:
    trend_penalty = 0                       # brand-new worker / first month — no false spike
else:
    +15 if baseline_violations > 0 and monthly_violations > baseline_violations * 1.30
    +10 if baseline_fine > 0       and total_fine_amount  > baseline_fine * 1.30
```

## 9. Department risk scoring

- Each worker is grouped by `department` (workers with none are grouped as `Unassigned`).
- **Department `risk_score` = the sum of its workers' `risk_score` values.**
- Levels: department `high` ≥ 100, `medium` ≥ 50, else `normal`.
- Each department gets one recommendation whose priority follows the department level.

## 10. Recommendation priority rules

| Priority | When | Deadline |
|---|---|---|
| **P1** | worker is high risk **or** in a high-risk department | 7 days |
| **P2** | worker is medium risk **or** in a medium-risk department | 14 days |
| **P3** | normal-risk worker / department | 30 days |

Each recommendation object:

```json
{
  "priority": "P1",
  "target_type": "worker",
  "target_name": "Ali Haider",
  "action": "Mandatory NO-Hardhat compliance re-training",
  "owner": "site supervisor",
  "deadline_days": 7,
  "trigger": "3× NO-Hardhat in 2025-06"
}
```

## 11. Audit log fields and idempotency

`POST /risk-analysis-log` writes one row per run. Fields: `n8n_execution_id`, `month`,
`status` (`success`|`empty`|`failed`), `total_workers_analyzed`, `high_risk_workers_count`,
`medium_risk_workers_count`, `total_violations`, `total_fine_amount`, `trend`
(`improved`|`worsened`|`stable`), `recommendations_count`, `response_snapshot_json`
(full §6 response, PostgreSQL `JSONB`), `backend_version`, `error_message`, `created_at`
(server-set).

Idempotency is keyed on `(month, n8n_execution_id)` and enforced by a DB unique constraint:

| Condition | Behaviour | HTTP |
|---|---|---|
| `month` + `n8n_execution_id` both new | Create new log | **201** |
| Same `month` AND same `n8n_execution_id` | Return existing log + `"already_exists": true` | **200** |
| Same `month` but different `n8n_execution_id` | Create new log (a distinct run) | **201** |

## 12. Empty data handling

When the selected month has no fines, `/risk-analysis` returns a clean structured payload
(`status: "empty"`, empty arrays, `month_to_month_comparison: null`) rather than an error.
The IF node routes this to the "empty" branch, which posts a log with `status: "empty"`.
This keeps empty months out of the failure path.

## 13. Failure handling and retry behaviour

- The `/risk-analysis` HTTP Request node uses `retryOnFail: true`, `maxTries: 3`,
  `waitBetweenTries: 2000` ms.
- If all retries fail, the workflow's error path posts `/risk-analysis-log` with
  `status: "failed"` and the captured `error_message`.
- Because idempotency is keyed on `(month, n8n_execution_id)`, retries of the **same** n8n
  execution that eventually reach the log endpoint will not create duplicate rows.

## 14. FYP demo steps (reproducible by an evaluator)

1. In the backend `.env`, set `N8N_PAYROLL_AGENT_API_KEY=demo-key` and restart the backend.
2. Ensure some fines exist for a month, e.g. `2025-06` (create a few via the normal flow).
3. Simulate the agent's analysis call:
   ```bash
   curl -H "X-N8N-API-KEY: demo-key" \
     "http://localhost:8000/api/v1/admin/payroll/agent/risk-analysis?month=2025-06"
   ```
   Confirm a JSON body with `status: "success"`, `high_risk_workers`, `department_summary`,
   and `recommendations`.
4. Save the audit log (paste the JSON from step 3 as `response_snapshot_json`):
   ```bash
   curl -X POST -H "X-N8N-API-KEY: demo-key" -H "Content-Type: application/json" \
     -d '{"n8n_execution_id":"demo-1","month":"2025-06","status":"success",
          "high_risk_workers_count":1,"medium_risk_workers_count":0,
          "total_violations":3,"total_fine_amount":1500,"trend":"worsened",
          "recommendations_count":2,"response_snapshot_json":{}}' \
     "http://localhost:8000/api/v1/admin/payroll/agent/risk-analysis-log"
   ```
   Confirm HTTP 201. Re-run the same command → HTTP 200 with `"already_exists": true`.
5. Create safety action tasks for high-risk workers from that saved log
   (use `N8N_SAFETY_ACTION_AGENT_API_KEY`, not the payroll key):
   ```bash
   curl -X POST -H "X-N8N-API-KEY: demo-safety-key" -H "Content-Type: application/json" \
     -d '{"log_id":1,"month":"2025-06","high_risk_workers":[
           {"worker_id":1,"risk_reason":"Repeat offender: 3x NO-Hardhat in 2025-06",
            "suggested_priority":"P1","action_title":"Mandatory NO-Hardhat compliance re-training"}
         ]}' \
     "http://localhost:8000/api/v1/admin/safety-actions/agent/create-from-risk-analysis"
   ```
   Confirm HTTP 201 with `created` and `skipped_duplicates` counts. Re-run the same command
   and confirm duplicates are skipped.
6. Log in as an admin, open **Admin → Payroll**. The "n8n Risk Insights" panel shows the
   latest run (last run time, status badge, high/medium counts, trend, total fine,
   recommendations count). Click **View Full Analysis** to see the stored snapshot.
7. Open **Admin → Safety Actions**. The generated task appears with priority, status,
   deadline, risk reason, and a manual completion action.
8. Import `payroll-risk-analysis-agent.workflow.json` into n8n, set `{{BACKEND_BASE_URL}}`
   and `{{N8N_PAYROLL_AGENT_API_KEY}}`, and run it manually to see the full automated path.

## 15. Known limitations

- **No HR email** — the agent does not notify HR or anyone by email.
- **No auto-deduction** — fine status (`deducted`/`waived`) is never changed by the agent;
  it remains a manual action on the Admin Payroll page (UC_16 amendment).
- **No task chains** — safety action creation is one task per high-risk worker, month,
  and risk reason. Escalation never creates another task.
- **No evidence uploads** — admin completion stores notes only.
- **No admin approval workflow** in this version.
- The frontend panel reads the **latest** audit log only; it does not run the analysis.
- Month filtering is dialect-agnostic by design (date ranges + `deduction_month`), so it
  does not reuse the existing report's PostgreSQL-specific `to_char` SQL.
