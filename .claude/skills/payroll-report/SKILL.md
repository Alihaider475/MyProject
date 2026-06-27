---
name: payroll-report
description: "Use this skill when building or fixing the SafeSite AI payroll report feature end-to-end. Triggers: any task involving payroll PDF generation, per-violation-type fine breakdowns, FineRecord status bulk-update to 'deducted', top-offenders camera deduplication, violation tag aggregation on the OffendersPage, or empty-state handling for zero-fine periods. Stack: FastAPI + SQLAlchemy ORM + ReportLab Platypus (in-memory BytesIO) + React 18 + Pydantic v2. Do NOT use raw SQL, weasyprint, wkhtmltopdf, or disk-based PDF writing."
---

# SafeSite AI — Payroll Report Skill

## Overview

This skill covers the complete end-to-end implementation of the SafeSite AI
payroll report feature, including six specific bug fixes across backend, PDF
layer, and frontend.

---

## Tech Stack

| Layer     | Technology                                      |
|-----------|-------------------------------------------------|
| Backend   | FastAPI (Python 3.11), SQLAlchemy ORM           |
| Database  | SQLite (dev) / PostgreSQL (prod)                |
| Auth      | Supabase JWT — roles: `safety_manager`, `system_administrator` |
| PDF Gen   | ReportLab Platypus — **in-memory only** (BytesIO) |
| Frontend  | React 18, Vite, TailwindCSS                     |
| Scheduler | n8n (triggers payroll on 1st of each month)     |

---

## Key Database Models (SQLAlchemy — do NOT modify)

```python
# Worker        : id, employee_id (EMP-XXX), name, department, face_embedding
# ViolationEvent: id, worker_id (FK), camera_id, violation_type, confidence,
#                 timestamp, frame_path
# FineRecord    : id, challan_no, worker_id (FK), violation_id (FK),
#                 amount (PKR), status (pending|deducted|waived), created_at
# FineConfig    : violation_type, amount_per_occurrence, is_active
```

---

## Deliverables

Produce these five files, complete and runnable:

1. `routers/payroll.py`
2. `services/payroll_service.py`
3. `schemas/payroll.py`
4. `routers/offenders.py` (patch only)
5. `frontend/src/pages/OffendersPage.jsx` (patch only)

---

## Issue 1 — Missing Per-Violation-Type Breakdown in Query

**Problem:** The SQLAlchemy query groups only by worker and sums all fines into
a single total. No per-violation-type breakdown exists.

**Fix:** Rewrite the payroll query using `GROUP BY (worker_id, violation_type)`.

### Required result shape per worker

```json
{
  "employee_id": "EMP-001",
  "name": "Abid",
  "department": "Mechanical",
  "total_violations": 191,
  "fines": {
    "NO-Mask":        { "count": 122, "amount": 29000 },
    "NO-Hardhat":     { "count": 6,   "amount": 3600  },
    "NO-Safety-Vest": { "count": 32,  "amount": 12800 }
  },
  "total_fine": 46200
}
```

### Query constraints

- Filter `FineRecord.created_at` within first day to last day of selected month/year
- Exclude `FineRecord.status == 'waived'`
- Use SQLAlchemy ORM only — **no raw SQL strings**

### SQLAlchemy pattern

```python
from sqlalchemy import func
from calendar import monthrange
from datetime import date

start = date(year, month, 1)
end   = date(year, month, monthrange(year, month)[1])

rows = (
    db.query(
        Worker.employee_id,
        Worker.name,
        Worker.department,
        ViolationEvent.violation_type,
        func.count(FineRecord.id).label("count"),
        func.sum(FineRecord.amount).label("amount"),
    )
    .join(FineRecord, FineRecord.worker_id == Worker.id)
    .join(ViolationEvent, FineRecord.violation_id == ViolationEvent.id)
    .filter(
        FineRecord.created_at >= start,
        FineRecord.created_at <= end,
        FineRecord.status != "waived",
    )
    .group_by(Worker.id, Worker.employee_id, Worker.name,
              Worker.department, ViolationEvent.violation_type)
    .all()
)
```

---

## Issue 2 — Status Not Updated to 'deducted' After Report Generation

**Problem:** Per FR_16, after payroll report generation all included
`FineRecord`s must transition `pending → deducted`. Currently not happening.

**Fix:** Bulk UPDATE **before** streaming the PDF so status is consistent even
if the download fails midway.

```python
db.query(FineRecord).filter(
    FineRecord.id.in_(fine_ids),
    FineRecord.status == "pending"
).update({"status": "deducted"}, synchronize_session=False)
db.commit()
```

### Atomicity requirement

Wrap in `try/except` with `db.rollback()` on failure:

```python
try:
    db.query(FineRecord).filter(
        FineRecord.id.in_(fine_ids),
        FineRecord.status == "pending",
    ).update({"status": "deducted"}, synchronize_session=False)
    db.commit()
except Exception:
    db.rollback()
    raise HTTPException(status_code=500, detail="Failed to update fine statuses.")
```

---

## Issue 3 — Raw Dump of Camera IDs in Top Offenders Page

**Problem:** `/top-offenders` returns unsorted, undeduped camera_id strings.
Renders as a wall of numbers in the UI.

### Backend fix (routers/offenders.py)

Replace raw camera list with:

```python
unique_camera_ids: list[int]  # deduplicated, sorted
camera_count: int             # len(unique_camera_ids)
```

Processing:

```python
raw_ids = [event.camera_id for event in worker_events]
unique_camera_ids = sorted(set(raw_ids))
camera_count = len(unique_camera_ids)
```

### Frontend fix (OffendersPage.jsx)

Replace the raw camera string with:

```jsx
<div className="text-sm text-gray-400">
  Seen on{" "}
  <span className="text-white font-semibold">{worker.camera_count}</span>
  {worker.camera_count === 1 ? " camera" : " cameras"}
  <span className="text-gray-600 ml-2">
    ({worker.unique_camera_ids.map(id => `Cam ${id}`).join(", ")})
  </span>
</div>
```

---

## Issue 4 — Violation Type Tags Not Aggregated on Offenders Page

**Problem:** UI renders a separate tag per `ViolationEvent` row, causing
duplicates like `[NO-Mask ×1] [NO-Mask ×119]` instead of `[NO-Mask ×120]`.

### Backend fix (routers/offenders.py)

Use a subquery grouping by `(worker_id, violation_type)`:

```python
"violation_summary": [
  { "type": "NO-Mask",        "count": 120 },
  { "type": "NO-Safety-Vest", "count": 32  },
  { "type": "NO-Hardhat",     "count": 3   }
]
```

### Frontend fix — color-coded badge chips

```jsx
const VIOLATION_COLORS = {
  "NO-Mask":        "bg-amber-500/20  text-amber-400  border-amber-500/30",
  "NO-Hardhat":     "bg-red-500/20    text-red-400    border-red-500/30",
  "NO-Safety-Vest": "bg-orange-500/20 text-orange-400 border-orange-500/30",
};

{worker.violation_summary.map(v => (
  <span
    key={v.type}
    className={`border rounded-full px-2 py-0.5 text-xs ${VIOLATION_COLORS[v.type] ?? "bg-gray-500/20 text-gray-400 border-gray-500/30"}`}
  >
    {v.type} ×{v.count}
  </span>
))}
```

---

## Issue 5 — PDF Report Unprofessional

**Problem:** Current PDF is plain text with a basic table — no branding,
no breakdown, no risk flag.

**Fix:** Rewrite using **ReportLab Platypus** with the following sections.

### Constraints (non-negotiable)

- ReportLab Platypus only — no weasyprint, no wkhtmltopdf
- Generate **in-memory** using `io.BytesIO` — **never write to disk**
- Stream via `StreamingResponse`:

```python
from fastapi.responses import StreamingResponse
import io

return StreamingResponse(
    io.BytesIO(pdf_bytes),
    media_type="application/pdf",
    headers={
        "Content-Disposition":
            f'attachment; filename="SafeSite_Payroll_{year}_{month:02d}.pdf"'
    },
)
```

### Report ID format

```python
from uuid import uuid4
report_id = f"PAY-{year}-{month:02d}-{uuid4().hex[:6].upper()}"
```

### Section specifications

#### a) Header Banner

| Property  | Value                                              |
|-----------|----------------------------------------------------|
| Background| `#0D0D1A` (dark)                                   |
| Title     | "SafeSite AI" — Helvetica-Bold 22pt, white         |
| Tagline   | "PPE Violation Detection & Safety Analytics" — cyan `#06B6D4` |
| Report ID | Auto-generated `PAY-{YEAR}-{MONTH:02d}-{HEX6}`    |

#### b) Meta Strip (4 columns, light gray background)

Columns: `Report Period | Department | Generated On | Status: Finalized`

#### c) KPI Summary Cards (3 columns)

| Card                  | Color  |
|-----------------------|--------|
| Total Employees       | neutral|
| Total Violations      | red    |
| Total Deductions PKR  | amber  |

#### d) Main Table

- Repeating header, alternating row shading
- Columns: `EMP ID | Name | Department | Violations | Fine Breakdown | Total PKR`
- Fine Breakdown: color-coded per type (amber/orange/red), shows count + amount
- Totals row: amber background, bold, top border

#### e) Risk Alert Box (conditional)

Show if **any worker has violations > 50**:

```
Background : HexColor("#FFFBEB")
Border     : amber
Content    : Worker name, violation count,
             "Mandatory safety re-training recommended"
```

#### f) Signature Block (2 columns)

| Left                    | Right                       |
|-------------------------|-----------------------------|
| Prepared By             | Approved By                 |
| Safety Manager          | System Administrator        |
| Signature line + name   | Signature line + name       |

#### g) Footer (every page)

- Red "CONFIDENTIAL" notice
- Report ID
- Page number
- Generation timestamp

---

## Issue 6 — No Empty State Handling for Zero-Fine Periods

**Problem:** If no `FineRecord`s exist for the selected month, the endpoint
crashes or returns an empty PDF.

### Backend fix

```python
if not employees:
    raise HTTPException(
        status_code=404,
        detail="No deductions found for the selected period."
    )
```

### Frontend fix (PayrollPage.jsx)

Catch the 404 and render:

```jsx
{error?.status === 404 && (
  <div className="text-gray-500 text-center py-20">
    <span className="text-4xl">📭</span>
    <p className="mt-3 text-sm">No deductions for this period.</p>
  </div>
)}
```

---

## Schemas (schemas/payroll.py)

All schemas use **Pydantic v2** syntax:

```python
from pydantic import BaseModel, ConfigDict
from typing import List
from datetime import datetime

class ViolationBreakdown(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    type: str
    count: int
    amount: float

class WorkerPayrollSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    employee_id: str
    name: str
    department: str
    total_violations: int
    fines: List[ViolationBreakdown]
    total_fine: float

class PayrollReportSchema(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    month: int
    year: int
    report_id: str
    generated_at: datetime
    employees: List[WorkerPayrollSchema]
    grand_total_violations: int
    grand_total_fines: float
```

---

## Route Protection

Both payroll routes must be protected:

```python
from fastapi import Depends
# require_role dependency already implemented in auth middleware

@router.get("/api/v1/payroll/preview")
async def payroll_preview(
    month: int, year: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_role("system_administrator")),
):
    ...

@router.get("/api/v1/payroll/download")
async def payroll_download(
    month: int, year: int,
    db: Session = Depends(get_db),
    _: dict = Depends(require_role("system_administrator")),
):
    ...
```

---

## Hard Constraints Summary

| Constraint                          | Rule                                    |
|-------------------------------------|-----------------------------------------|
| ORM                                 | SQLAlchemy only — no raw SQL strings    |
| PDF library                         | ReportLab Platypus only                 |
| PDF storage                         | `io.BytesIO` in-memory — never disk     |
| Auth                                | JWT via `require_role` dependency       |
| Status update atomicity             | `try/except` with `db.rollback()`       |
| Pydantic version                    | v2 — `ConfigDict(from_attributes=True)` |
| Model modification                  | Do NOT modify `FineRecord` or `Worker`  |