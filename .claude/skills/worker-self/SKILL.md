# Feature: Worker Self-Service Login & Dashboard
## SafeSite AI — Production Implementation Prompt

---

## 0. Stack Reference

| Layer | Technology |
|---|---|
| Backend | Python 3.10+, FastAPI, SQLAlchemy ORM |
| Database | SQLite (dev) / PostgreSQL (prod) |
| Auth | Supabase Auth — JWT validation on all protected routes |
| Frontend | React 18, Vite, TailwindCSS, React Router, Supabase JS SDK |
| Deployment | Docker + Docker Compose, AWS EC2 Ubuntu |

> **Constraint:** Do not introduce new dependencies unless explicitly listed. Use patterns already established in the codebase (existing `get_current_user` dependency, existing `verify_supabase_jwt()` utility, existing Tailwind component classes).

---

## 1. Objective

Add a self-service read-only portal for registered workers.  
After login, a worker sees **only their own** salary summary, PPE violations, fines, and payroll deductions — nothing else.  
Admin and Safety Manager flows, routes, and data access are **not changed**.

---

## 2. Database — Schema Migration

Write a proper **Alembic revision file**. Do not use raw `ALTER TABLE` or `IF NOT EXISTS` — SQLite does not support it. Use `op.add_column()` inside `with op.batch_alter_table()` for SQLite/Postgres compatibility.

### 2.1 Migration: `add_worker_auth_fields`

```python
# alembic/versions/xxxx_add_worker_auth_fields.py

def upgrade():
    with op.batch_alter_table("workers") as batch_op:
        batch_op.add_column(sa.Column("auth_user_id", sa.String(), nullable=True, unique=True))
        batch_op.add_column(sa.Column("base_salary",  sa.Float(),  nullable=False, server_default="0.0"))
    op.create_index("idx_workers_auth_user_id", "workers", ["auth_user_id"], unique=True)

def downgrade():
    op.drop_index("idx_workers_auth_user_id", table_name="workers")
    with op.batch_alter_table("workers") as batch_op:
        batch_op.drop_column("auth_user_id")
        batch_op.drop_column("base_salary")
```

### 2.2 Migration: `create_worker_access_log`

```python
# alembic/versions/xxxx_create_worker_access_log.py

def upgrade():
    op.create_table(
        "worker_access_log",
        sa.Column("id",         sa.Integer(), primary_key=True),
        sa.Column("worker_id",  sa.Integer(), sa.ForeignKey("workers.id"), nullable=False),
        sa.Column("endpoint",   sa.String(),  nullable=False),
        sa.Column("ip_address", sa.String(),  nullable=True),
        sa.Column("accessed_at",sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("idx_access_log_worker_id", "worker_access_log", ["worker_id"])
```

> **Why access log:** HR/payroll systems require an audit trail of who viewed their salary data and when. Required for dispute resolution.

---

## 3. Backend

### 3.1 SQLAlchemy Models

**`app/models/worker.py`** — add to existing `Worker` model:
```python
auth_user_id = Column(String, unique=True, nullable=True, index=True)
base_salary   = Column(Float,  nullable=False, default=0.0)
```

**`app/models/worker_access_log.py`** — new file:
```python
class WorkerAccessLog(Base):
    __tablename__ = "worker_access_log"
    id          = Column(Integer, primary_key=True)
    worker_id   = Column(Integer, ForeignKey("workers.id"), nullable=False)
    endpoint    = Column(String,  nullable=False)
    ip_address  = Column(String,  nullable=True)
    accessed_at = Column(DateTime(timezone=True), server_default=func.now())
```

---

### 3.2 FastAPI Dependencies — `app/dependencies/auth.py`

Add the following alongside the existing `get_current_user` dependency. Do not modify existing dependencies.

```python
from dataclasses import dataclass

@dataclass
class WorkerClaim:
    auth_user_id: str   # Supabase UUID (jwt["sub"])

async def require_worker_role(
    token: str = Depends(oauth2_scheme),
) -> WorkerClaim:
    """
    Validates JWT, enforces role == 'worker'.
    Role is read from jwt["user_metadata"]["role"] — NO database query.
    Returns 403 if role is missing or not 'worker'.
    Returns 401 if JWT is invalid or expired.
    """
    payload = verify_supabase_jwt(token)           # existing utility
    role = payload.get("user_metadata", {}).get("role")
    if role != "worker":
        raise HTTPException(status_code=403, detail="Worker role required")
    return WorkerClaim(auth_user_id=payload["sub"])


async def get_current_worker(
    claim: WorkerClaim = Depends(require_worker_role),
    db: Session = Depends(get_db),
    request: Request = None,
) -> Worker:
    """
    Resolves WorkerClaim → Worker ORM record.
    Writes an access log row on every successful resolution.
    Returns 404 if auth_user_id is not linked to any worker record.
    """
    worker = db.query(Worker).filter(Worker.auth_user_id == claim.auth_user_id).first()
    if not worker:
        raise HTTPException(status_code=404, detail="Worker account not linked. Contact admin.")

    # Audit log — fire-and-forget, never raise
    try:
        log = WorkerAccessLog(
            worker_id  = worker.id,
            endpoint   = str(request.url.path) if request else "",
            ip_address = request.client.host if request else None,
        )
        db.add(log)
        db.commit()
    except Exception:
        pass  # never block the request for a logging failure

    return worker
```

---

### 3.3 Worker Provisioning — `app/routers/admin_workers.py`

Add to the existing worker registration endpoint (POST `/api/v1/workers`). After saving the worker to the DB, optionally provision a Supabase auth account:

```python
# After: db.commit(); db.refresh(worker)

if worker_in.email:
    try:
        supabase_admin = create_supabase_admin_client()   # uses SERVICE_ROLE_KEY
        resp = supabase_admin.auth.admin.create_user({
            "email": worker_in.email,
            "email_confirm": True,
            "user_metadata": {
                "role":      "worker",
                "worker_id": worker.id,
            },
        })
        worker.auth_user_id = resp.user.id
        db.commit()

        # Send invite so worker sets their own password
        supabase_admin.auth.admin.invite_user_by_email(worker_in.email)

    except Exception as e:
        # Non-fatal: worker record is saved, auth account can be linked later
        logger.warning(f"Supabase provisioning failed for worker {worker.id}: {e}")
```

> **Note:** `SERVICE_ROLE_KEY` must be in `.env` / Docker secret. Never expose it to the frontend. Admin API calls are server-side only.

---

### 3.4 Worker Self-Service Router — `app/routers/worker_self.py`

```python
router = APIRouter(
    prefix="/api/v1/worker/me",
    tags=["Worker Self-Service"],
    dependencies=[Depends(require_worker_role)],
)

# ── Block all write methods at router level ──────────────────────────────────
# Any POST/PUT/PATCH/DELETE to this prefix returns 405 before reaching handlers.
# This is enforced by only registering GET routes — no explicit block needed.
# Document this in OpenAPI with response_model and include_in_schema=True.
```

#### `GET /api/v1/worker/me/dashboard?month=YYYY-MM`

```python
@router.get("/dashboard", response_model=WorkerDashboardResponse)
async def worker_dashboard(
    month: str = Query(default=None, regex=r"^\d{4}-\d{2}$"),
    worker: Worker = Depends(get_current_worker),
    db: Session = Depends(get_db),
):
    """
    Returns aggregated salary and fine summary for the requested month.
    Defaults to current calendar month if month param is omitted.
    net_salary is floored at 0. salary_fully_offset flag is set when
    deductions exceed base_salary.
    """
    target = parse_month(month)   # returns (year, month) tuple
    fines  = get_worker_fines_for_month(db, worker.id, target)

    deducted = sum(f.amount for f in fines if f.status == "deducted")
    net      = max(0.0, worker.base_salary - deducted)

    return WorkerDashboardResponse(
        worker_name           = worker.name,
        employee_id           = worker.employee_id,
        department            = worker.department,
        base_salary           = worker.base_salary,
        total_violations      = count_violations(db, worker.id, target),
        pending_fine_amount   = sum(f.amount for f in fines if f.status == "pending"),
        paid_fine_amount      = sum(f.amount for f in fines if f.status == "paid"),
        deducted_fine_amount  = deducted,
        waived_fine_amount    = sum(f.amount for f in fines if f.status == "waived"),
        net_salary            = net,
        salary_fully_offset   = (worker.base_salary > 0 and net == 0.0),
        month                 = f"{target[0]}-{target[1]:02d}",
    )
```

#### `GET /api/v1/worker/me/violations?month=YYYY-MM&page=1&per_page=20`

```python
@router.get("/violations", response_model=PaginatedViolations)
async def worker_violations(
    month:    str = Query(default=None, regex=r"^\d{4}-\d{2}$"),
    page:     int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    worker: Worker = Depends(get_current_worker),
    db: Session = Depends(get_db),
):
    # Filter is applied server-side — never trusts client to filter
    ...
```

#### `GET /api/v1/worker/me/fines?month=YYYY-MM&status=pending|paid|deducted|waived`

```python
@router.get("/fines", response_model=PaginatedFines)
async def worker_fines(...):
    ...
```

#### `GET /api/v1/worker/me/salary?month=YYYY-MM`

```python
@router.get("/salary", response_model=WorkerSalaryResponse)
async def worker_salary(...):
    # Returns: base_salary, per-violation fine list, total_deducted, net_salary
    ...
```

---

### 3.5 Rate Limiting

Apply `slowapi` (already a common FastAPI add-on) to the worker router:

```python
# app/main.py
from slowapi import Limiter
from slowapi.util import get_jwt_subject   # limit per JWT sub, not per IP

limiter = Limiter(key_func=get_jwt_subject)

# On worker router:
@router.get("/dashboard")
@limiter.limit("60/minute")
async def worker_dashboard(request: Request, ...):
```

> **Why per-JWT, not per-IP:** Workers on a construction site share a WiFi NAT. IP-based limiting would throttle all workers simultaneously.

---

### 3.6 Response Schemas — `app/schemas/worker_self.py`

```python
class WorkerDashboardResponse(BaseModel):
    worker_name:          str
    employee_id:          str
    department:           str
    base_salary:          float
    total_violations:     int
    pending_fine_amount:  float
    paid_fine_amount:     float
    deducted_fine_amount: float
    waived_fine_amount:   float
    net_salary:           float
    salary_fully_offset:  bool   # true when deductions >= base_salary
    month:                str    # YYYY-MM

class ViolationRecord(BaseModel):
    id:               int
    detected_at:      datetime
    violation_type:   str
    fine_amount:      float
    fine_status:      str        # pending | paid | deducted | waived
    payment_method:   str | None
    deduction_month:  str | None # YYYY-MM
    waive_reason:     str | None
    snapshot_url:     str | None # presigned URL if evidence exists

class PaginatedViolations(BaseModel):
    data:        list[ViolationRecord]
    total:       int
    page:        int
    per_page:    int
    total_pages: int
```

---

### 3.7 Register Router — `app/main.py`

```python
from app.routers import worker_self
app.include_router(worker_self.router)
```

---

## 4. Frontend

### 4.1 Role-Based Redirect After Login — `src/lib/auth.js`

```js
// After supabase.auth.getSession() or onAuthStateChange:
export function redirectByRole(session, navigate) {
  const role = session?.user?.user_metadata?.role
  if (role === "worker")  return navigate("/worker/dashboard", { replace: true })
  if (role === "admin")   return navigate("/admin",            { replace: true })
  return navigate("/dashboard", { replace: true })   // safety manager default
}
```

> **Important:** Read role from `user_metadata` in the Supabase session — no extra API call needed.

---

### 4.2 Route Guard — `src/components/RoleGuard.jsx`

```jsx
export default function RoleGuard({ allowedRole, children }) {
  const { session, loading } = useSupabaseSession()
  const navigate = useNavigate()

  if (loading) return <FullPageSpinner />

  const role = session?.user?.user_metadata?.role
  if (!session) return navigate("/login", { replace: true })
  if (role !== allowedRole) return navigate(
    role === "worker" ? "/worker/dashboard" : "/dashboard",
    { replace: true }
  )
  return children
}
```

---

### 4.3 Router — `src/router.jsx`

```jsx
<Route path="/worker/dashboard" element={
  <RoleGuard allowedRole="worker">
    <WorkerLayout>
      <WorkerDashboard />
    </WorkerLayout>
  </RoleGuard>
} />
```

---

### 4.4 Worker Layout — `src/layouts/WorkerLayout.jsx`

Renders a minimal sidebar. Only two items:

```
🏠  Dashboard
🚪  Logout
```

No links to `/admin/*`, `/cameras`, `/workers`, `/fine-config`, or `/payroll`.  
This is a separate layout component — do not modify the existing `AdminLayout` or `ManagerLayout`.

---

### 4.5 Worker Dashboard Page — `src/pages/worker/WorkerDashboard.jsx`

```
Month Picker (default: current month)
  └─ On change: re-fetch all /me/* endpoints with ?month=YYYY-MM

Summary Cards (read-only — no action buttons anywhere on this page):
  ┌──────────────┐ ┌───────────────┐ ┌────────────────────────────────┐
  │ Base Salary  │ │ Fine Deduction│ │ Net Salary                     │
  │ PKR 50,000   │ │ PKR 2,500 🔴  │ │ PKR 47,500  [⚠ amber if       │
  └──────────────┘ └───────────────┘ │  salary_fully_offset == true]  │
                                     └────────────────────────────────┘
  ┌──────────────────┐ ┌──────────────┐
  │ Total Violations │ │ Pending Fine │
  │ 3                │ │ PKR 1,500    │
  └──────────────────┘ └──────────────┘

Violations & Fines Table:
  Columns:
    Date & Time | Violation Type | Fine Amount | Status (badge) |
    Payment Method / Deduction Month | Waive Reason | Evidence

  Status badge colors:
    pending   → amber
    paid      → green
    deducted  → blue
    waived    → gray

  Evidence column:
    If snapshot_url exists → show thumbnail → click opens modal lightbox
    If null → show "—"

  Do NOT render:
    Mark as Paid / Deduct / Waive / Delete buttons
    Any link to admin pages
```

---

### 4.6 Data Fetching Hook — `src/hooks/useWorkerDashboard.js`

```js
export function useWorkerDashboard(month) {
  const [dashboard, setDashboard] = useState(null)
  const [violations, setViolations] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const param = month ? `?month=${month}` : ""
    setLoading(true)
    Promise.all([
      apiFetch(`/api/v1/worker/me/dashboard${param}`),
      apiFetch(`/api/v1/worker/me/violations${param}`),
    ])
      .then(([dash, viols]) => { setDashboard(dash); setViolations(viols.data) })
      .catch(setError)
      .finally(() => setLoading(false))
  }, [month])

  return { dashboard, violations, loading, error }
}
```

---

## 5. Tests

### 5.1 Backend — `tests/test_worker_self_service.py`

Write all tests with `pytest` + `httpx.AsyncClient`. Use existing test fixtures for `db_session` and `make_jwt`.

| Test | Assertion |
|---|---|
| `test_worker_sees_only_own_violations` | Worker A JWT → `/me/violations` → all records have `worker_id == A.id` |
| `test_worker_cannot_spoof_worker_id` | Worker A JWT → `/me/violations?worker_id=B` → param is ignored, returns A's data |
| `test_non_worker_jwt_returns_403` | Admin JWT → `/api/v1/worker/me/dashboard` → `403` |
| `test_unauthenticated_returns_401` | No JWT → any `/me/*` → `401` |
| `test_unlinked_worker_returns_404` | Valid worker JWT, no `auth_user_id` match in DB → `404` |
| `test_net_salary_floored_at_zero` | `base_salary=1000`, `deducted=1500` → `net_salary==0`, `salary_fully_offset==True` |
| `test_month_filter_is_server_side` | Violations in Jan + Feb → `?month=2025-01` → only Jan returned |
| `test_write_methods_return_405` | POST/PUT/DELETE to `/api/v1/worker/me/dashboard` → `405` |
| `test_access_log_written_on_request` | Worker requests dashboard → `worker_access_log` has a new row |
| `test_rate_limit_enforced` | 61 requests/min from same JWT sub → 61st returns `429` |

### 5.2 Frontend — `src/tests/WorkerDashboard.test.jsx`

Use Vitest + React Testing Library. Mock `apiFetch` and Supabase session.

```
test: worker sidebar renders only Dashboard and Logout links
test: month picker change triggers re-fetch with correct ?month= param
test: net salary card has amber class when salary_fully_offset is true
test: fine deduction card shows red text when deducted_fine_amount > 0
test: evidence thumbnail click opens modal lightbox
test: no "Mark as Paid" or "Waive" buttons rendered anywhere
test: navigating to /admin redirects to /worker/dashboard
```

### 5.3 Build Gate

```bash
# Backend
pytest tests/test_worker_self_service.py -v --tb=short

# Frontend
npm run build           # zero errors, zero TS/lint warnings
npm run test -- --run   # all worker tests pass
```

---

## 6. Changed & New Files

### Backend
```
alembic/versions/xxxx_add_worker_auth_fields.py     NEW
alembic/versions/xxxx_create_worker_access_log.py   NEW
app/models/worker.py                                 MODIFIED  (auth_user_id, base_salary)
app/models/worker_access_log.py                      NEW
app/schemas/worker_self.py                           NEW
app/dependencies/auth.py                             MODIFIED  (require_worker_role, get_current_worker)
app/routers/worker_self.py                           NEW
app/routers/admin_workers.py                         MODIFIED  (Supabase provisioning on register)
app/main.py                                          MODIFIED  (include worker_self router)
tests/test_worker_self_service.py                    NEW
```

### Frontend
```
src/lib/auth.js                                      MODIFIED  (redirectByRole)
src/router.jsx                                       MODIFIED  (/worker/dashboard route)
src/components/RoleGuard.jsx                         NEW
src/layouts/WorkerLayout.jsx                         NEW
src/pages/worker/WorkerDashboard.jsx                 NEW
src/components/worker/SummaryCards.jsx               NEW
src/components/worker/ViolationTable.jsx             NEW
src/hooks/useWorkerDashboard.js                      NEW
```

---

## 7. Manual Verification Steps

```
1. Admin panel → Worker Management → Register worker with email
   → Supabase sends invite email to worker

2. Worker opens invite email → sets password via Supabase link

3. Worker visits app root → login → redirected to /worker/dashboard
   → header shows worker's own name and employee ID

4. Worker sees only their own violations in the table

5. Worker changes month picker → cards and table update, URL param changes

6. Worker opens browser → navigates to /admin manually in URL bar
   → immediately redirected back to /worker/dashboard

7. Worker clicks on a violation with evidence → modal lightbox opens with snapshot

8. Admin opens /admin/payroll → worker record unchanged, all admin actions intact

9. Supabase dashboard → disable worker auth account → worker login returns 401

10. Run: pytest tests/test_worker_self_service.py -v   → all 10 tests pass
11. Run: npm run build                                  → clean build, zero errors
```

---

## 8. Out of Scope (do not implement in this PR)

- Worker ability to dispute a violation (future feature)
- Push/email notification when a new fine is added to worker
- Exporting worker's own salary slip as PDF
- Mobile app