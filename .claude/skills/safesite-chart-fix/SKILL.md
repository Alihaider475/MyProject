---
name: safesite-charts-fix
description: >
  Use this skill whenever the user wants to fix, improve, rewrite, or upgrade the
  Charts/Analytics page of the SafeSite AI PPE detection dashboard. Triggers include:
  any mention of "charts page", "violation analytics", "recharts fix", "dashboard graphs",
  "confidence histogram", "stacked bar camera", "top offenders chart", "KPI delta",
  "yesterday line not showing", or requests to improve graph representation in the
  PPE detection system. Also triggers when the user asks to add new charts, fix existing
  Recharts components, or improve the visual quality of any analytics panel in SafeSite AI.
  Always use this skill before writing any Recharts or TailwindCSS code for this project.
compatibility:
  runtime: React 18 + Vite
  libraries: Recharts, TailwindCSS, React Router v6
  backend: FastAPI (Python)
  language: JavaScript (JSX)
---

# SafeSite AI — Charts Page Fix Skill

This skill captures all fixes, improvements, and new chart additions for the
`/charts` (ChartsPage.jsx) page of the SafeSite AI PPE violation detection dashboard.

## Quick Reference — What Needs Fixing

| Issue | Severity | Fix Location |
|-------|----------|-------------|
| KPI cards missing delta % vs prior period | Medium | `KPICard` component |
| Yesterday line invisible on hourly chart | High | `ViolationsPerHourChart` |
| No alert threshold line on hourly chart | Medium | `ViolationsPerHourChart` |
| Donut chart hides minority violation types | High | Replace with `StackedTypeBar` |
| Camera bar chart has no violation breakdown | Medium | `CameraBarChart` → stacked |
| No confidence score distribution chart | High | New `ConfidenceHistogram` |
| No per-worker violation chart | Medium | New `TopOffendersBar` |
| Empty state not handled in any chart | Low | All chart components |

Read `references/chart-components.md` for full component code for each fix.
Read `references/api-contract.md` for the exact FastAPI response shape each chart expects.
Read `references/layout.md` for the TailwindCSS grid and panel system.

---

## Architecture Overview

```
ChartsPage.jsx
├── useChartsData(timeRange)         ← single hook, fetches all panels
├── Row 1: KPICards (x4)             ← with delta badges
├── Row 2:
│   ├── ViolationsPerHourChart (60%) ← area + yesterday + threshold line
│   └── StackedTypeBar (40%)         ← replaces donut
├── Row 3:
│   ├── StackedCameraBar (50%)       ← breakdown per violation type
│   └── ConfidenceHistogram (50%)    ← new — YOLO model health
└── Row 4: TopOffendersBar (100%)    ← new — clickable, links to /top-offenders
```

---

## Step-by-Step Implementation Guide

### Step 1 — Data Hook

Create `useChartsData.js`. It must:
- Accept `timeRange` as param (`"24h" | "7d" | "30d"`)
- Call `GET /api/v1/charts?range=<timeRange>`
- Return `{ data, loading, error }`
- Re-fetch automatically when `timeRange` changes via `useEffect([timeRange])`

```js
// hooks/useChartsData.js
import { useState, useEffect } from "react";

export function useChartsData(timeRange) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/v1/charts?range=${timeRange}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [timeRange]);

  return { data, loading, error };
}
```

---

### Step 2 — KPI Cards with Delta Badges

Each card receives `value`, `prevValue`, `label`, `icon`.

Delta logic:
```js
const delta = prevValue > 0 ? ((value - prevValue) / prevValue * 100).toFixed(1) : null;
const isUp  = delta > 0;
```

Render badge:
```jsx
{delta !== null ? (
  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
    isUp ? "bg-red-500/20 text-red-400" : "bg-green-500/20 text-green-400"
  }`}>
    {isUp ? "▲" : "▼"} {Math.abs(delta)}%
  </span>
) : (
  <span className="text-xs text-gray-500">— no prior data</span>
)}
```

> For violations, UP = bad (red). For compliance rate, UP = good (green).
> Pass a `higherIsBetter={false}` prop to invert the color logic.

---

### Step 3 — Violations Per Hour Chart (Critical Fixes)

**Fix A — Yesterday line not rendering:**

The root cause is almost always one of:
1. Backend returns yesterday data with full ISO timestamps instead of hour-of-day keys
2. Data arrays have different lengths (today = 24 entries, yesterday = partial)

Normalize both arrays to hour index 0–23 before passing to Recharts:

```js
function normalizeHourly(raw) {
  const map = {};
  raw.forEach(d => {
    // Accept both "13:00" and "2024-01-01T13:00:00Z" formats
    const hour = parseInt(
      typeof d.hour === "string" && d.hour.includes("T")
        ? d.hour.split("T")[1].split(":")[0]
        : d.hour.split(":")[0]
    );
    map[hour] = { today: d.today ?? 0, yesterday: d.yesterday ?? 0 };
  });
  return Array.from({ length: 24 }, (_, i) => ({
    hour: `${String(i).padStart(2,"0")}:00`,
    today: map[i]?.today ?? 0,
    yesterday: map[i]?.yesterday ?? 0,
  }));
}
```

**Fix B — Alert threshold + midnight marker:**

```jsx
import { ReferenceLine } from "recharts";

// Inside <AreaChart>:
<ReferenceLine y={20} stroke="#EF4444" strokeDasharray="4 2"
  label={{ value: "Alert Threshold", fill: "#EF4444", fontSize: 11, position: "insideTopRight" }} />

<ReferenceLine x="00:00" stroke="#6B7280" strokeDasharray="3 3"
  label={{ value: "Midnight", fill: "#9CA3AF", fontSize: 10, position: "insideTopLeft" }} />
```

**Fix C — Yesterday line styling:**
```jsx
<Line type="monotone" dataKey="yesterday"
  stroke="#6B7280" strokeDasharray="5 3" strokeWidth={1.5}
  dot={false} name="Yesterday" />
```

---

### Step 4 — Replace Donut with Stacked Horizontal Bar

Remove `<PieChart>` / `<Pie>` entirely. Replace with:

```jsx
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, Cell } from "recharts";

const TYPE_COLORS = {
  "NO-Mask":        "#FBBF24",
  "NO-Safety-Vest": "#F97316",
  "NO-Hardhat":     "#EF4444",
};

// Transform data into single-row format for stacked bar
const stackedData = [
  {
    name: "Violations",
    ...Object.fromEntries(byType.map(t => [t.type, t.count]))
  }
];

<BarChart data={stackedData} layout="vertical" height={120}>
  <XAxis type="number" hide />
  <YAxis type="category" dataKey="name" hide />
  <Tooltip formatter={(v, name) => [`${v} violations`, name]} />
  <Legend />
  {Object.entries(TYPE_COLORS).map(([type, color]) => (
    <Bar key={type} dataKey={type} stackId="a" fill={color}
      label={{ position: "center", fill: "#fff", fontSize: 11,
        formatter: (v) => v > 10 ? `${v}` : "" }} />
  ))}
</BarChart>
```

Add percentage legend below:
```jsx
{byType.map(t => (
  <div key={t.type} className="flex items-center justify-between text-sm">
    <span className="flex items-center gap-2">
      <span className="w-3 h-3 rounded-sm" style={{ background: TYPE_COLORS[t.type] }} />
      {t.type}
    </span>
    <span className="text-gray-400">{t.count} ({t.pct}%)</span>
  </div>
))}
```

---

### Step 5 — Stacked Camera Bar Chart

Convert existing flat bar to stacked breakdown by violation type:

```jsx
<BarChart data={byCamera} layout="vertical">
  <XAxis type="number" />
  <YAxis type="category" dataKey="camera" width={80} tick={{ fill: "#9CA3AF", fontSize: 12 }} />
  <Tooltip
    content={({ active, payload, label }) => active && payload ? (
      <div className="bg-gray-900 border border-white/10 rounded-lg p-3 text-sm">
        <p className="font-semibold text-white mb-1">{label}</p>
        {payload.map(p => (
          <p key={p.dataKey} style={{ color: p.fill }}>
            {p.dataKey}: {p.value}
          </p>
        ))}
      </div>
    ) : null}
  />
  <Legend />
  {Object.entries(TYPE_COLORS).map(([type, color]) => (
    <Bar key={type} dataKey={type} stackId="cam" fill={color} />
  ))}
</BarChart>
```

---

### Step 6 — Confidence Score Histogram (New)

This chart surfaces YOLO model health. It is the most ML-relevant addition.

```jsx
// Color each bar by confidence level: red → amber → green
function binColor(bin) {
  const low = parseFloat(bin.split("–")[0]);
  if (low < 0.60) return "#EF4444";
  if (low < 0.75) return "#F59E0B";
  return "#22C55E";
}

<BarChart data={confidenceDist}>
  <XAxis dataKey="bin" tick={{ fill: "#9CA3AF", fontSize: 10 }} angle={-30} textAnchor="end" />
  <YAxis tick={{ fill: "#9CA3AF", fontSize: 11 }} />
  <Tooltip formatter={(v) => [`${v} detections`, "Count"]} />
  <ReferenceLine x="0.70–0.75" stroke="#F59E0B" strokeDasharray="4 2"
    label={{ value: "Confidence Threshold", fill: "#F59E0B", fontSize: 10, position: "insideTopRight" }} />
  <Bar dataKey="count" radius={[3, 3, 0, 0]}>
    {confidenceDist.map((entry) => (
      <Cell key={entry.bin} fill={binColor(entry.bin)} />
    ))}
  </Bar>
</BarChart>

{/* Model health warning — show only when mean confidence is low */}
{meanConfidence < 0.65 && (
  <div className="mt-3 flex items-start gap-2 bg-amber-500/10 border border-amber-500/30
                  rounded-lg p-3 text-amber-400 text-sm">
    <span>⚠️</span>
    <span>
      Mean confidence is <strong>{(meanConfidence * 100).toFixed(1)}%</strong> — detections
      are clustering near the decision boundary. Consider retraining on current
      environment data or adjusting the confidence threshold in camera settings.
    </span>
  </div>
)}
```

---

### Step 7 — Top Offenders Bar (New, Clickable)

```jsx
import { useNavigate } from "react-router-dom";

const navigate = useNavigate();

<BarChart data={topOffenders} layout="vertical">
  <XAxis type="number" tick={{ fill: "#9CA3AF" }} />
  <YAxis type="category" dataKey="worker" width={120} tick={{ fill: "#D1D5DB", fontSize: 12 }} />
  <Tooltip formatter={(v) => [`${v} violations`, "Total"]} />
  <Bar dataKey="count" fill="#EF4444" radius={[0, 4, 4, 0]}
    cursor="pointer"
    onClick={(d) => navigate(`/top-offenders?worker=${encodeURIComponent(d.worker)}`)}
    label={{ position: "right", fill: "#F87171", fontSize: 12,
      formatter: (v) => v }}
  />
</BarChart>
<p className="text-xs text-gray-500 mt-2">Click a bar to view full violation history</p>
```

---

### Step 8 — Empty State Wrapper

Wrap every chart panel with this guard:

```jsx
function ChartPanel({ title, children, data, emptyCheck }) {
  const isEmpty = emptyCheck ? emptyCheck(data) : !data || data.length === 0;
  return (
    <div className="bg-[#13131f] border border-white/10 rounded-xl p-5">
      <h3 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
        {title}
      </h3>
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center h-40 text-gray-600">
          <span className="text-3xl mb-2">📭</span>
          <span className="text-sm">No data available for this period</span>
        </div>
      ) : children}
    </div>
  );
}
```

---

### Step 9 — Page Layout (TailwindCSS Grid)

```jsx
<div className="p-6 space-y-4">

  {/* Row 1 — KPI Cards */}
  <div className="grid grid-cols-4 gap-4">
    <KPICard label="Total Violations" value={kpis.total_violations}
      prevValue={kpis.total_violations_prev} icon="⚠️" higherIsBetter={false} />
    <KPICard label="Peak Hour" value={kpis.peak_hour}
      sub={`${kpis.peak_hour_count} violations`} icon="🕐" />
    <KPICard label="Top Violation" value={kpis.top_violation_type} icon="🔴" />
    <KPICard label="Top Camera"   value={kpis.top_camera} icon="📷" />
  </div>

  {/* Row 2 — Hourly trend + Type breakdown */}
  <div className="grid grid-cols-5 gap-4">
    <div className="col-span-3">
      <ChartPanel title="Violations Per Hour" data={hourly}>
        <ViolationsPerHourChart data={hourly} />
      </ChartPanel>
    </div>
    <div className="col-span-2">
      <ChartPanel title="By Violation Type" data={byType}>
        <StackedTypeBar data={byType} />
      </ChartPanel>
    </div>
  </div>

  {/* Row 3 — Camera breakdown + Confidence histogram */}
  <div className="grid grid-cols-2 gap-4">
    <ChartPanel title="By Camera" data={byCamera}>
      <StackedCameraBar data={byCamera} />
    </ChartPanel>
    <ChartPanel title="Detection Confidence Distribution" data={confidenceDist}>
      <ConfidenceHistogram data={confidenceDist} meanConfidence={meanConfidence} />
    </ChartPanel>
  </div>

  {/* Row 4 — Top Offenders */}
  <ChartPanel title="Top 5 Offenders" data={topOffenders}>
    <TopOffendersBar data={topOffenders} />
  </ChartPanel>

</div>
```

---

## Common Pitfalls

**Recharts ResponsiveContainer height:** Always set an explicit `height` on the
`ResponsiveContainer` wrapper, not just `width="100%"`. Without it, the chart collapses to 0px.
```jsx
<ResponsiveContainer width="100%" height={280}>
```

**Stacked Bar dataKey must match object keys exactly.** If your API returns
`"NO-Safety-Vest"` (with hyphens), the `dataKey` prop must be `"NO-Safety-Vest"` not
`"no_safety_vest"`. Use bracket notation in the data transform if needed.

**Legend overlapping chart:** Add `wrapperStyle={{ paddingTop: "12px" }}` to `<Legend />`.

**XAxis tick overlap on confidence histogram:** Use `angle={-30}` + `textAnchor="end"` +
increase `height` of the XAxis to 50 to prevent label clipping.

---

## Backend Endpoint Contract

See `references/api-contract.md` for the full FastAPI response schema,
including the `confidence_distribution` and `top_offenders` fields that need
to be added to `GET /api/v1/charts`.

---

## Testing Checklist

- [ ] Yesterday line renders as gray dashed line (not invisible)
- [ ] Alert threshold line appears at y=20 on hourly chart
- [ ] Stacked type bar shows all 3 violation types without any hidden
- [ ] Camera stacked bar shows per-type color breakdown on hover tooltip
- [ ] Confidence histogram shows red bars for low-confidence bins
- [ ] Model health warning appears when mean_confidence < 0.65
- [ ] Clicking a worker bar navigates to `/top-offenders?worker=<name>`
- [ ] All panels show empty state when data array is empty
- [ ] Time range toggle (24h / 7d / 30d) re-fetches all data simultaneously
- [ ] KPI delta badges show correct direction and color