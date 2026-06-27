# Design Tokens — PPE Violations Fix

## Colors

| Token | Light hex | Dark hex | Used in |
|-------|-----------|----------|---------|
| danger-bg | `#FCEBEB` | `#501313` | Violation card, alert banner, active frame row |
| danger-border | `#F7C1C1` | `#791F1F` | Violation card border, alert banner border |
| danger-text | `#A32D2D` | `#F7C1C1` | Violation value text, badge text |
| danger-bar | `#E24B4A` | `#F09595` | Confidence bar (violation) |
| success-bg | `#EAF3DE` | `#173404` | OK badge bg |
| success-text | `#3B6D11` | `#C0DD97` | OK badge text |
| success-bar | `#639922` | `#97C459` | Confidence bar (ok), ok dot |
| neutral-surface | `#F5F5F4` | `#2C2C2A` | Stat cards, neutral badges, hover |
| border | `rgba(0,0,0,0.15)` | `rgba(255,255,255,0.12)` | Card borders, row dividers |
| text-primary | `#1C1C1E` | `#F5F5F4` | Values, headings |
| text-secondary | `#5F5E5A` | `#B4B2A9` | Labels, sub-text |
| text-tertiary | `#888780` | `#888780` | Timestamps, hints |

---

## Alert banner

```css
.violation-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  background: #FCEBEB;
  border: 0.5px solid #F7C1C1;
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 500;
  color: #A32D2D;
}
```

Tailwind:
```
className="flex items-center gap-2.5 bg-red-50 border border-red-200 rounded-lg px-3.5 py-2.5 text-sm font-medium text-red-700"
```

---

## Stat card

```css
.stat-card {
  background: #F5F5F4;
  border-radius: 8px;
  padding: 14px 16px;
}
.stat-card--danger {
  background: #FCEBEB;
  border: 0.5px solid #F7C1C1;
}
.stat-label {
  font-size: 11px;
  color: #888780;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 4px;
}
.stat-value {
  font-size: 22px;
  font-weight: 500;
  color: #1C1C1E;
}
.stat-value--danger { color: #A32D2D; }
.stat-sub {
  font-size: 12px;
  color: #5F5E5A;
  margin-top: 2px;
}
```

Tailwind (normal card):
```
className="bg-gray-50 rounded-lg p-4"
```
Tailwind (danger card):
```
className="bg-red-50 border border-red-200 rounded-lg p-4"
```

---

## Frame timeline row

```css
.frame-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-bottom: 0.5px solid rgba(0,0,0,0.15);
  cursor: pointer;
  transition: background 0.15s;
}
.frame-row:hover     { background: #F5F5F4; }
.frame-row--active   { background: #FCEBEB; }
.frame-row:last-child { border-bottom: none; }

.frame-time { font-size: 12px; font-weight: 500; color: #1C1C1E; }
.frame-row--active .frame-time { color: #A32D2D; }

.frame-detail { font-size: 11px; color: #888780; }
.frame-row--active .frame-detail { color: #793636; }

.frame-thumb {
  width: 36px; height: 36px;
  background: #F5F5F4;
  border-radius: 5px;
  flex-shrink: 0;
}
.frame-row--active .frame-thumb { background: #F7C1C1; }

.status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.status-dot--ok        { background: #639922; }
.status-dot--violation { background: #E24B4A; }
```

---

## Confidence bar

```css
.conf-cell     { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
.conf-bar-wrap { width: 80px; height: 5px; background: #E5E5E3; border-radius: 99px; overflow: hidden; }
.conf-bar      { height: 100%; border-radius: 99px; }
```

---

## Badge system

```css
.badge            { display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:500; }
.badge--ok        { background:#EAF3DE; color:#3B6D11; }
.badge--violation { background:#FCEBEB; color:#A32D2D; }
.badge--neutral   { background:#F5F5F4; color:#5F5E5A; border:0.5px solid rgba(0,0,0,0.15); }
```

Tailwind:
```
ok:        "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-800"
violation: "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-50 text-red-700"
neutral:   "inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600 border border-gray-200"
```

---

## Dark mode overrides

```css
@media (prefers-color-scheme: dark) {
  .violation-banner  { background:#501313; border-color:#791F1F; color:#F7C1C1; }
  .stat-card         { background:#2C2C2A; }
  .stat-card--danger { background:#501313; border-color:#791F1F; }
  .stat-value--danger { color:#F7C1C1; }
  .frame-row:hover   { background:#2C2C2A; }
  .frame-row--active { background:#501313; }
  .badge--ok         { background:#173404; color:#C0DD97; }
  .badge--violation  { background:#501313; color:#F7C1C1; }
  .badge--neutral    { background:#2C2C2A; color:#B4B2A9; border-color:rgba(255,255,255,0.12); }
  .conf-bar-wrap     { background:#3A3A38; }
}
```