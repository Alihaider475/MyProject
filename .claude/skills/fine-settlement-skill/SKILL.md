SafeSite AI — Fine Settlement Skill
Purpose
Use this skill when implementing or modifying the worker fine settlement workflow in SafeSite AI.
The goal is to let an admin or payroll officer settle fines that were automatically created after PPE violations.
A fine should not stay only as a charged amount. It needs a clear settlement state:
```text
Pending → Paid / Deducted / Waived
```
This feature is part of the payroll/challan workflow, not a real online payment gateway.
---
Project Context
SafeSite AI is a construction PPE monitoring system.
Current system behavior:
```text
Worker violates PPE rule
→ Violation is logged
→ Fine/challan is created
→ Fine appears in payroll/fines dashboard
```
Required new behavior:
```text
Fine is created with status: pending
→ Admin chooses settlement method
→ System records payment/deduction/waiver details
→ Payroll report and worker fine history update correctly
```
This is an admin/payroll management feature. The worker does not need to pay directly through JazzCash, EasyPaisa, Stripe, or a bank gateway for the FYP version.
---
Recommended Scope
Implement these settlement types:
1. Paid
Use when the worker has paid the fine manually, for example by cash or manual transfer.
Required fields:
```text
status = paid
payment_method = cash / bank_transfer / manual
paid_at = datetime
notes = optional
received_by = current admin user if available
```
2. Deducted
Use when the fine will be deducted from worker salary/payroll.
Required fields:
```text
status = deducted
payment_method = payroll_deduction
deducted_month = YYYY-MM
paid_at or settled_at = datetime
notes = optional
```
3. Waived
Use when the fine is cancelled/forgiven, for example false detection or supervisor approval.
Required fields:
```text
status = waived
waived_reason = required
settled_at = datetime
notes = optional
```
---
Core Business Rules
Every new fine must start as `pending`.
Only pending fines should show settlement action buttons by default.
Valid statuses are:
```text
pending
paid
deducted
waived
```
Do not silently change a settled fine back to another status unless an explicit admin correction workflow exists.
Payroll report should count only `deducted` fines for salary deduction totals.
Paid fines should not appear as pending deductions.
Waived fines should remain visible in history but should not be counted as payable or deductible.
Keep existing violation and challan creation logic intact.
Do not add real online payment gateway integration unless explicitly requested later.
All settlement actions must be protected by the same authentication/authorization rules as existing fine/payroll APIs.
---
Database Requirements
Inspect the existing fine/challan model first.
If fields do not already exist, add fields similar to:
```python
status = Column(String, default="pending", nullable=False)
payment_method = Column(String, nullable=True)
paid_at = Column(DateTime, nullable=True)
settled_at = Column(DateTime, nullable=True)
deducted_month = Column(String, nullable=True)  # format: YYYY-MM
waived_reason = Column(Text, nullable=True)
settlement_notes = Column(Text, nullable=True)
settled_by_user_id = Column(String, nullable=True)
```
Acceptable naming can follow the existing project conventions.
Important:
Do not break existing rows.
Existing fines with null status should be treated as `pending`.
If the project does not use Alembic yet, add safe startup/schema handling consistent with the current project pattern.
If the project uses migrations, create a migration.
---
Backend API Requirements
Add or update endpoints for fine settlement.
Recommended endpoints:
```text
PATCH /api/v1/fines/{fine_id}/settle
```
Request body example for paid:
```json
{
  "status": "paid",
  "payment_method": "cash",
  "notes": "Received cash from worker"
}
```
Request body example for payroll deduction:
```json
{
  "status": "deducted",
  "deducted_month": "2026-06",
  "notes": "Deduct from June payroll"
}
```
Request body example for waived:
```json
{
  "status": "waived",
  "waived_reason": "False detection confirmed by supervisor",
  "notes": "Camera angle caused incorrect detection"
}
```
Backend validation:
Reject invalid statuses.
Require `payment_method` when status is `paid`.
Require `deducted_month` when status is `deducted`.
Require `waived_reason` when status is `waived`.
Validate `deducted_month` format as `YYYY-MM`.
Return 404 if fine does not exist.
Return 400 if fine is already settled and correction is not supported.
Return updated fine object after successful settlement.
Recommended response:
```json
{
  "id": 101,
  "challan_number": "CH-2026-081",
  "worker_id": 12,
  "amount": 500,
  "status": "deducted",
  "payment_method": "payroll_deduction",
  "deducted_month": "2026-06",
  "settled_at": "2026-06-23T10:30:00",
  "settlement_notes": "Deduct from June payroll"
}
```
---
Frontend Requirements
The main UI should be implemented in the payroll/fines area, especially `WorkerDashboard.jsx` if that is where worker fines and challans are managed.
Add these UI elements:
Fine Status Badge
Show a clear badge:
```text
Pending
Paid
Deducted
Waived
```
Suggested visual meaning:
```text
Pending  = amber/yellow
Paid     = green
Deducted = blue/cyan
Waived   = gray
```
Follow the project’s existing Tailwind style conventions.
Action Buttons
For pending fines only, show:
```text
[Mark as Paid]
[Deduct from Payroll]
[Waive Fine]
```
Do not show these buttons for already settled fines unless an explicit edit/correction workflow is added.
Modal: Mark as Paid
Fields:
```text
Payment method: Cash / Bank Transfer / Manual
Notes: optional
Confirm button
```
Modal: Deduct from Payroll
Fields:
```text
Payroll month: YYYY-MM
Notes: optional
Confirm button
```
Modal: Waive Fine
Fields:
```text
Waiver reason: required
Notes: optional
Confirm button
```
After confirmation:
```text
Call backend settlement endpoint
Refresh worker fine history
Refresh payroll summary/report
Show success toast/message
```
---
Payroll Report Behavior
Payroll deduction report should include:
```text
Worker
Total pending fines
Total deducted fines for selected month
Total paid fines
Total waived fines
Net payroll deduction amount
```
Important rule:
```text
Only status = deducted should count toward salary deduction.
```
Do not count:
```text
paid
waived
pending
```
as deducted salary amount.
---
Suggested Implementation Steps
When using this skill, follow this workflow:
Inspect existing fine/challan models, schemas, routes, and frontend payroll files.
Identify the actual fine model/table name.
Check current fine statuses if any already exist.
Add missing database fields safely.
Add or update Pydantic schemas for settlement request/response.
Add backend settlement endpoint.
Add service/helper function for status transition validation.
Update fine list/detail responses to include settlement fields.
Update frontend API client.
Add UI status badges.
Add pending fine action buttons.
Add settlement modals.
Refresh React Query/Redux/manual state after settlement.
Update payroll report totals so only deducted fines count as deductions.
Add or update backend tests.
Run relevant backend and frontend checks.
List changed files and manual test steps.
---
Do Not Do
Do not:
Add JazzCash/EasyPaisa/Stripe/payment gateway.
Make worker-facing payment portal.
Remove existing challan/fine creation logic.
Count waived fines in payroll deductions.
Count paid fines as salary deductions.
Let settled fines change status repeatedly without explicit correction rules.
Break existing violation history or challan PDF/download behavior.
Expose sensitive internal IDs unnecessarily in the UI.
Skip validation for waiver reason or deducted month.
---
Testing Checklist
Backend
Test these cases:
```text
New fine is created with pending status
Pending fine can be marked paid
Pending fine can be marked deducted
Pending fine can be waived
Invalid status is rejected
Paid requires payment_method
Deducted requires deducted_month
Waived requires waived_reason
Already-settled fine cannot be settled again by default
Payroll report counts only deducted fines
```
Frontend
Test these cases:
```text
Pending fine shows action buttons
Paid fine shows Paid badge and no settlement buttons
Deducted fine shows Deducted badge and payroll month
Waived fine shows Waived badge and reason
Mark as Paid modal works
Deduct from Payroll modal works
Waive Fine modal works
Fine table refreshes after settlement
Payroll totals update after settlement
```
---
Manual Demo Script
Use this flow for FYP demo:
```text
1. Start live PPE detection.
2. Worker commits PPE violation.
3. System logs violation and creates challan/fine.
4. Open Worker Dashboard / Payroll page.
5. Show fine status as Pending.
6. Click Deduct from Payroll.
7. Select payroll month.
8. Confirm deduction.
9. Show fine status changed to Deducted.
10. Open payroll report.
11. Show deduction included in monthly payroll total.
```
Alternative demo:
```text
1. Open pending fine.
2. Click Waive Fine.
3. Enter reason: False detection verified.
4. Confirm.
5. Show status as Waived.
6. Show that waived amount is not included in payroll deduction.
```
---
Claude Code Prompt Template
Use this prompt when asking Claude Code to implement the feature:
```text
Role: Act as an expert FastAPI + React engineer.

Implement a fine settlement feature for SafeSite AI.

Context:
- PPE violations automatically create fines/challans.
- Fines currently appear in the worker payroll/fines dashboard.
- I do not want a real online payment gateway.
- I want admin/manual fine settlement with three outcomes:
  1. Mark as Paid
  2. Deduct from Payroll
  3. Waive Fine

Backend requirements:
1. Inspect existing fine/challan models, routes, schemas, and payroll report logic first.
2. Every new fine should default to status "pending".
3. Add or reuse fields for:
   - status
   - payment_method
   - paid_at or settled_at
   - deducted_month
   - waived_reason
   - settlement_notes
   - settled_by_user_id if current user info is available
4. Add a settlement endpoint, preferably:
   PATCH /api/v1/fines/{fine_id}/settle
5. Valid statuses: pending, paid, deducted, waived.
6. Validation:
   - paid requires payment_method
   - deducted requires deducted_month in YYYY-MM format
   - waived requires waived_reason
7. Do not allow already settled fines to be changed again unless an explicit correction flow already exists.
8. Update payroll report logic so only status="deducted" counts toward salary deduction.
9. Keep existing violation, challan, and fine creation logic unchanged.

Frontend requirements:
1. Update the worker payroll/fines dashboard where fines/challans are shown.
2. Show a status badge for each fine: Pending, Paid, Deducted, Waived.
3. For pending fines only, show:
   - Mark as Paid
   - Deduct from Payroll
   - Waive Fine
4. Add modals/forms for each settlement action.
5. Refresh fine history and payroll summary after settlement.
6. Use existing styling patterns and do not redesign unrelated UI.

Testing:
1. Run relevant backend tests.
2. Run frontend build or lint check.
3. List changed files.
4. Provide manual test steps for the FYP demo.
```
---
Expected Final Behavior
After this skill is implemented, the fine lifecycle should be:
```text
Violation detected
→ Fine created as Pending
→ Admin settles fine
→ Fine becomes Paid / Deducted / Waived
→ Payroll report updates correctly
→ Worker fine history remains auditable
```
This gives the project a complete and realistic fine management workflow without unnecessary payment gateway complexity.