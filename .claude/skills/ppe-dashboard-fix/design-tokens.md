# Design Tokens — PPE Dashboard Fix

## Color palette

### Semantic colors (use these in components)

| Token            | Light mode hex | Dark mode hex | Usage                        |
|------------------|---------------|---------------|------------------------------|
| `danger-bg`      | `#FCEBEB`     | `#501313`     | Violation card bg, alert bg  |
| `danger-border`  | `#F7C1C1`     | `#791F1F`     | Violation card border        |
| `danger-text`    | `#A32D2D`     | `#F7C1C1`     | Violation value, badge text  |
| `danger-sub`     | `#793636`     | `#F09595`     | Violation sub-label          |
| `success-bg`     | `#EAF3DE`     | `#173404`     | OK badge bg                  |
| `success-text`   | `#3B6D11`     | `#C0DD97`     | OK badge text                |
| `success-bar`    | `#639922`     | `#97C459`     | Confidence bar fill (OK)     |
| `danger-bar`     | `#E24B4A`     | `#F09595`     | Confidence bar fill (violation)|
| `surface-primary`| `#FFFFFF`     | `#1C1C1E`     | Card backgrounds             |
| `surface-secondary`|`#F5F5F4`   | `#2C2C2A`     | Stat cards, hover states     |
| `border-tertiary`| `rgba(0,0,0,0.15)`| `rgba(255,255,255,0.12)`| Default borders    |
| `text-primary`   | `#1C1C1E`     | `#F5F5F4`     | Main values                  |
| `text-secondary` | `#5F5E5A`     | `#B4B2A9`     | Labels, sub-text             |
| `text-tertiary`  | `#888780`     | `#888780`     | Hints, timestamps            |

---

## Tailwind mappings (if project uses Tailwind)

```
danger-bg        → bg-red-50
danger-border    → border-red-200
danger-text      → text-red-700
success-bg       → bg-green-50
success-text     → text-green-800
surface-secondary→ bg-gray-50
border-tertiary  → border-gray-200
```

Dark mode equivalents (prefix with `dark:`):
```
dark:bg-red-950  dark:text-red-200  dark:border-red-800
dark:bg-green-950 dark:text-green-200
dark:bg-zinc-800  dark:border-zinc-700
```

---

## Spacing & layout

```
Card padding:        1rem 1.25rem   (16px 20px)
Gap between cards:   12px
Stat grid:           repeat(auto-fit, minmax(120px, 1fr))
Border radius card:  12px  (border-radius-lg)
Border radius badge: 999px (pill)
Border radius bar:   99px
Border width:        0.5px (cards, rows) / 2px (featured/accent only)
```

---

## Typography

```
Stat label:   11px / uppercase / letter-spacing 0.05em / text-tertiary
Stat value:   22px / weight 500 / text-primary   (16px if long string like resolution)
Stat sub:     12px / text-secondary
Badge text:   12px / weight 500
Row time:     12px / weight 500 / text-primary
Row detail:   11px / text-tertiary
Table header: 12px / text-tertiary
Table cell:   13px / text-primary (item) / text-secondary (detected)
```

---

## Component snippets

### Stat card — plain CSS

```css
.stat-card {
  background: var(--surface-secondary, #F5F5F4);
  border-radius: 8px;
  padding: 14px 16px;
}
.stat-card.danger {
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
.stat-value { font-size: 22px; font-weight: 500; }
.stat-value.danger { color: #A32D2D; }
```

### Confidence bar — plain CSS

```css
.conf-bar-wrap {
  width: 80px;
  height: 5px;
  background: #E5E5E3;
  border-radius: 99px;
  overflow: hidden;
}
.conf-bar {
  height: 100%;
  border-radius: 99px;
  background: #639922;   /* override to #E24B4A for violations */
}
```

### Badge — plain CSS

```css
.badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 10px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
}
.badge-ok        { background: #EAF3DE; color: #3B6D11; }
.badge-violation { background: #FCEBEB; color: #A32D2D; }
.badge-neutral   { background: #F5F5F4; color: #5F5E5A;
                   border: 0.5px solid rgba(0,0,0,0.15); }
```

---

## Dark mode

If the project toggles dark mode via a `dark` class on `<html>` or `<body>`:

```css
@media (prefers-color-scheme: dark) {
  .stat-card.danger { background: #501313; border-color: #791F1F; }
  .stat-value.danger { color: #F7C1C1; }
  .badge-ok   { background: #173404; color: #C0DD97; }
  .badge-violation { background: #501313; color: #F7C1C1; }
  .conf-bar   { background: #97C459; }  /* OK bar */
}
```

If using Tailwind dark mode (`darkMode: 'class'`), apply `dark:` variants inline on each element instead.