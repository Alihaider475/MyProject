---
name: ppe-violations-fix
description: >
  Fixes and redesigns the PPE Detection video analysis results page. Use this
  skill whenever the user asks to improve, fix, redesign, or beautify the PPE
  video detection page, violation display, frame timeline, detection stat cards,
  alert toasts, confidence table, or badge styling in the PPE dashboard. Also
  triggers when the user says the dashboard does not look good, is not up to
  the mark, or wants the video results UI to look more professional.
---

# PPE Video Detection Page — UI Fix Skill

You are fixing a PPE (Personal Protective Equipment) video analysis results
page. The page has 5 specific problems rated and confirmed by the user.
Fix all 5 in every run. Do not skip any.

## Known problems to fix

| # | Problem | Severity |
|---|---------|----------|
| 1 | Three identical alert toasts stacked on screen | Critical |
| 2 | All stat cards look identical — violations not visually distinct | High |
| 3 | Active frame in timeline has only a faint underline highlight | Medium |
| 4 | Confidence values are plain text — no visual weight | Medium |
| 5 | Badge colors are inconsistent — NO-Mask badge is teal not red | Medium |

---

## Step 1 — Identify the tech stack

```bash
# Detect framework
cat package.json | grep -E '"react|"vue|"svelte|"next|"vite'

# Find the video/detection page component
find . -type f \( -name "*.tsx" -o -name "*.jsx" -o -name "*.vue" \) \
  | xargs grep -l -i "VideoPage\|PPEDetect\|FrameTimeline\|violation\|Detect PPE" 2>/dev/null

# Check if Tailwind is used
cat tailwind.config.* 2>/dev/null | head -5
ls src/index.css src/styles/globals.css 2>/dev/null
```

Read every file you find before writing any code.
Then apply the fixes below using the correct patterns for the detected stack.
For color values and component CSS, read `references/design-tokens.md`.

---

## Step 2 — Fix 1: Consolidate alert toasts

**Find:** Any code that calls a toast/notification function inside a loop,
inside a `.then()`, or once per frame result. Common patterns:

```js
// React — look for these patterns
toast("20 violation(s) detected")
showNotification(...)
setAlerts(prev => [...prev, newAlert])   // appending inside a loop
```

**Fix:** Call the toast exactly once, after all frames are processed:

```js
// After detection completes — call once only
const totalViolations = results.reduce((sum, f) => sum + f.violations, 0)
if (totalViolations > 0) {
  toast.error(`${totalViolations} PPE violation(s) detected across ${results.length} frames`)
}
```

Also replace the stacked orange toast UI with a single inline alert banner
directly below the page title:

```jsx
{violationCount > 0 && (
  <div className="violation-banner">
    <AlertTriangle size={16} />
    <span>{violationCount} PPE violations detected · {frameCount} frames analysed</span>
  </div>
)}
```

See `references/design-tokens.md` → Alert banner section for exact styles.

---

## Fix 2: Stat cards with visual hierarchy

Find the row of stat cards (Duration / Resolution / FPS / Frames / Violations).
All five cards currently share the same styles. Change the Violations card only:

```jsx
// Before — all cards identical
<StatCard label="Violations" value={violations} />

// After — violations card gets danger variant
<StatCard label="Violations" value={violations} variant="danger" />
```

If there is no `variant` prop, add it:

```jsx
function StatCard({ label, value, sub, variant }) {
  const isDanger = variant === 'danger'
  return (
    <div className={isDanger ? 'stat-card stat-card--danger' : 'stat-card'}>
      <p className="stat-label">{label}</p>
      <p className={isDanger ? 'stat-value stat-value--danger' : 'stat-value'}>{value}</p>
      {sub && <p className="stat-sub">{sub}</p>}
    </div>
  )
}
```

See `references/design-tokens.md` → Stat card section for CSS.

---

## Fix 3: Frame timeline active row highlight

Find the frame timeline component. The active/selected frame row currently uses
only an underline or a faint border. Replace with a full red-tinted background:

```jsx
// Before
className={`frame-row ${isActive ? 'frame-row--active' : ''}`}

// After — same class name, update the CSS
```

```css
.frame-row--active {
  background: #FCEBEB;          /* red tint */
}
.frame-row--active .frame-time {
  color: #A32D2D;
}
.frame-row--active .frame-thumb {
  background: #F7C1C1;
}
```

Also add a status dot to every row (right-aligned):

```jsx
<div className={hasViolation ? 'status-dot status-dot--violation' : 'status-dot status-dot--ok'} />
```

```css
.status-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; }
.status-dot--ok        { background: #639922; }
.status-dot--violation { background: #E24B4A; }
```

---

## Fix 4: Confidence bars in the detection table

Find the PPE item breakdown table (columns: PPE Item / Status / Detected / Confidence).
The confidence column currently renders plain text like `86.5%`.
Add an inline bar before each percentage:

```jsx
// Before
<td>{item.confidence}%</td>

// After
<td>
  <div className="conf-cell">
    <div className="conf-bar-wrap">
      <div
        className="conf-bar"
        style={{
          width: `${item.confidence}%`,
          background: item.status === 'VIOLATION' ? '#E24B4A' : '#639922'
        }}
      />
    </div>
    <span>{item.confidence}%</span>
  </div>
</td>
```

```css
.conf-cell     { display: flex; align-items: center; gap: 8px; justify-content: flex-end; }
.conf-bar-wrap { width: 80px; height: 5px; background: #E5E5E3; border-radius: 99px; overflow: hidden; }
.conf-bar      { height: 100%; border-radius: 99px; }
```

---

## Fix 5: Badge color system

Find every badge/pill/chip component used for PPE item labels. Apply a
consistent three-variant system:

| Badge type | Background | Text color | Use for |
|------------|-----------|------------|---------|
| ok | `#EAF3DE` | `#3B6D11` | Safety Vest, Hardhat, Mask (when present) |
| violation | `#FCEBEB` | `#A32D2D` | NO-Mask, NO-Vest, NO-Hardhat |
| neutral | surface-secondary | text-secondary | Person, Machinery, counts |

```jsx
function Badge({ label, type = 'neutral' }) {
  return <span className={`badge badge--${type}`}>{label}</span>
}

// Usage
<Badge label="Safety Vest: 2" type="ok" />
<Badge label="NO-Mask: 1"     type="violation" />
<Badge label="Person: 2"      type="neutral" />
```

```css
.badge            { display:inline-flex; align-items:center; gap:4px; padding:3px 10px; border-radius:999px; font-size:12px; font-weight:500; }
.badge--ok        { background:#EAF3DE; color:#3B6D11; }
.badge--violation { background:#FCEBEB; color:#A32D2D; }
.badge--neutral   { background:var(--surface-secondary,#F5F5F4); color:#5F5E5A; border:0.5px solid rgba(0,0,0,0.15); }
```

---

## Step 3 — Verify all 5 fixes

Run the dev server:

```bash
npm run dev      # or yarn dev / pnpm dev
```

Check each fix visually:
- [ ] Only ONE alert banner appears after detection finishes
- [ ] Violations stat card is red-tinted, other 4 cards are neutral
- [ ] Active frame row in timeline has full red background, not just underline
- [ ] Confidence column shows colored bars beside percentages
- [ ] NO-Mask / NO-Vest / NO-Hardhat badges are red, OK badges are green

If tests exist:
```bash
npm test -- --testPathPattern="video\|ppe\|violation\|detection"
```

---

## Step 4 — Report back

After all fixes are applied, summarise:
- Files modified (component name + path)
- Lines changed per fix
- Any new props or CSS classes added
- How to verify each fix in the browser