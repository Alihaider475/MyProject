# API Contract — GET /api/v1/charts

## Request

```
GET /api/v1/charts?range=24h
Authorization: Bearer <JWT>
```

`range` accepts: `24h` | `7d` | `30d`

---

## Full Response Schema

```json
{
  "kpis": {
    "total_violations": 161,
    "total_violations_prev": 132,
    "peak_hour": "13:00",
    "peak_hour_count": 56,
    "top_violation_type": "NO-Mask",
    "top_camera": "Camera 4"
  },
  "hourly": [
    { "hour": "10:00", "today": 12, "yesterday": 8 },
    { "hour": "11:00", "today": 5,  "yesterday": 3 },
    { "hour": "13:00", "today": 56, "yesterday": 20 }
  ],
  "by_type": [
    { "type": "NO-Mask",        "count": 124, "pct": 77.0 },
    { "type": "NO-Safety-Vest", "count": 33,  "pct": 20.5 },
    { "type": "NO-Hardhat",     "count": 4,   "pct": 2.5  }
  ],
  "by_camera": [
    { "camera": "Camera 4", "NO-Mask": 110, "NO-Safety-Vest": 30, "NO-Hardhat": 3 },
    { "camera": "Camera 1", "NO-Mask": 10,  "NO-Safety-Vest": 2,  "NO-Hardhat": 1 },
    { "camera": "Camera 2", "NO-Mask": 4,   "NO-Safety-Vest": 1,  "NO-Hardhat": 0 }
  ],
  "confidence_distribution": [
    { "bin": "0.50–0.55", "count": 5  },
    { "bin": "0.55–0.60", "count": 12 },
    { "bin": "0.60–0.65", "count": 18 },
    { "bin": "0.65–0.70", "count": 22 },
    { "bin": "0.70–0.75", "count": 35 },
    { "bin": "0.75–0.80", "count": 29 },
    { "bin": "0.80–0.85", "count": 19 },
    { "bin": "0.85–0.90", "count": 13 },
    { "bin": "0.90–0.95", "count": 7  },
    { "bin": "0.95–1.00", "count": 1  }
  ],
  "mean_confidence": 0.71,
  "top_offenders": [
    { "worker": "Abid",           "count": 158 },
    { "worker": "Unknown Worker", "count": 23  },
    { "worker": "Zain",           "count": 11  },
    { "worker": "Hassan",         "count": 7   },
    { "worker": "Unknown Worker", "count": 5   }
  ]
}
```

---

## FastAPI Implementation — New Fields to Add

Add these two new query functions to your `charts` router:

### confidence_distribution

```python
@router.get("/charts")
def get_charts(range: str = "24h", db: Session = Depends(get_db)):
    # ... existing code ...

    # Confidence distribution (10 bins from 0.5 to 1.0)
    bins = [(0.5 + i*0.05, 0.5 + (i+1)*0.05) for i in range(10)]
    confidence_dist = []
    for lo, hi in bins:
        count = db.query(Violation).filter(
            Violation.timestamp >= start_time,
            Violation.confidence >= lo,
            Violation.confidence < hi
        ).count()
        confidence_dist.append({
            "bin": f"{lo:.2f}–{hi:.2f}",
            "count": count
        })

    # Mean confidence
    mean_conf_result = db.query(func.avg(Violation.confidence)).filter(
        Violation.timestamp >= start_time
    ).scalar()
    mean_confidence = round(float(mean_conf_result or 0), 3)
```

### top_offenders

```python
    # Top 5 offenders by violation count
    offender_rows = (
        db.query(Violation.worker_name, func.count(Violation.id).label("count"))
        .filter(Violation.timestamp >= start_time)
        .filter(Violation.worker_name.isnot(None))
        .group_by(Violation.worker_name)
        .order_by(desc("count"))
        .limit(5)
        .all()
    )
    top_offenders = [
        { "worker": row.worker_name or "Unknown Worker", "count": row.count }
        for row in offender_rows
    ]
```

### yesterday window calculation

```python
from datetime import datetime, timedelta

def get_time_windows(range: str):
    now = datetime.utcnow()
    if range == "24h":
        today_start     = now - timedelta(hours=24)
        yesterday_start = now - timedelta(hours=48)
        yesterday_end   = now - timedelta(hours=24)
    elif range == "7d":
        today_start     = now - timedelta(days=7)
        yesterday_start = now - timedelta(days=14)
        yesterday_end   = now - timedelta(days=7)
    elif range == "30d":
        today_start     = now - timedelta(days=30)
        yesterday_start = now - timedelta(days=60)
        yesterday_end   = now - timedelta(days=30)
    return today_start, yesterday_start, yesterday_end
```

---

## Notes for ML Engineer

- `confidence` column must exist on the `violations` table. If using SQLite for dev,
  run: `ALTER TABLE violations ADD COLUMN confidence REAL DEFAULT 0.75;`
- If `worker_name` is NULL (unidentified worker), the frontend labels it "Unknown Worker"
- `mean_confidence < 0.65` triggers the model health warning in the UI —
  this threshold corresponds to detections within 0.15 of the 0.5 decision boundary,
  indicating the model is uncertain. Adjust in `ConfidenceHistogram.jsx` if your
  deployment uses a different inference threshold.