# Layout Reference — ChartsPage.jsx

## Panel Design Token System

All chart panels share these Tailwind classes for visual consistency:

```
bg-[#13131f]          ← panel background (slightly lighter than page bg)
border border-white/10 ← subtle separator
rounded-xl            ← 12px radius
p-5                   ← 20px padding
```

Page background: `bg-[#0d0d1a]` or `bg-gray-950`

Panel header label:
```
text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4
```

---

## Grid Layout (Desktop — 1280px+)

```
┌─────────────────────────────────────────────────────────────┐
│  [Total Violations] [Peak Hour] [Top Type] [Top Camera]     │  ← grid-cols-4
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────┬───────────────────────────┐
│  Violations Per Hour            │  By Violation Type        │
│  (col-span-3, ~60%)             │  (col-span-2, ~40%)       │
│  Area chart + ref lines         │  Stacked horizontal bar   │
└─────────────────────────────────┴───────────────────────────┘

┌───────────────────────────┬─────────────────────────────────┐
│  By Camera                │  Confidence Distribution        │
│  (col-span-1, 50%)        │  (col-span-1, 50%)              │
│  Stacked horizontal bar   │  Histogram with color gradient  │
└───────────────────────────┴─────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│  Top 5 Offenders (full width, col-span-2)                   │
│  Horizontal bar, clickable                                  │
└─────────────────────────────────────────────────────────────┘
```

## Responsive Breakpoints

```jsx
// Row 1 — KPI cards
<div className="grid grid-cols-2 md:grid-cols-4 gap-4">

// Row 2 — Hourly + Type
<div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
  <div className="lg:col-span-3"> ... </div>
  <div className="lg:col-span-2"> ... </div>
</div>

// Row 3 — Camera + Confidence
<div className="grid grid-cols-1 md:grid-cols-2 gap-4">

// Row 4 — Offenders
<div className="w-full">
```

## Recharts Height Reference

| Chart | ResponsiveContainer height |
|-------|--------------------------|
| ViolationsPerHourChart | 280 |
| StackedTypeBar | 160 |
| StackedCameraBar | 220 |
| ConfidenceHistogram | 220 |
| TopOffendersBar | 200 |

## Color Palette

```js
const COLORS = {
  // Violation types
  "NO-Mask":        "#FBBF24",   // amber-400
  "NO-Safety-Vest": "#F97316",   // orange-500
  "NO-Hardhat":     "#EF4444",   // red-500

  // Chart lines
  today:     "#FF4444",           // bright red (area chart today)
  yesterday: "#6B7280",           // gray-500 (dashed)
  threshold: "#EF4444",           // red-500 reference line
  midnight:  "#4B5563",           // gray-600 reference line

  // Confidence histogram
  confLow:   "#EF4444",           // < 0.60
  confMid:   "#F59E0B",           // 0.60–0.75
  confHigh:  "#22C55E",           // > 0.75

  // UI
  panelBg:   "#13131f",
  border:    "rgba(255,255,255,0.1)",
  textMuted: "#9CA3AF",           // gray-400
  textBody:  "#D1D5DB",           // gray-300
};
```

## Time Range Toggle Component

Place in top-right of page header, outside any panel:

```jsx
const RANGES = ["24h", "7d", "30d"];

<div className="flex bg-white/5 rounded-lg p-1 gap-1">
  {RANGES.map(r => (
    <button key={r}
      onClick={() => setTimeRange(r)}
      className={`px-3 py-1 rounded-md text-sm font-medium transition-all ${
        timeRange === r
          ? "bg-cyan-500 text-black"
          : "text-gray-400 hover:text-white"
      }`}>
      {r}
    </button>
  ))}
</div>
```