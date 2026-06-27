---
name: ppe-dashboard-fix
description: >
  Redesigns and fixes the PPE Detection video dashboard UI. Use this skill
  whenever the user asks to improve, fix, redesign, or beautify the PPE
  detection dashboard, video upload results page, violation display, frame
  timeline, or any component of the PPE detection frontend. Also triggers when
  the user mentions fixing dashboard layout, making results look better, improving
  the video analysis UI, or cleaning up detection result cards.
---

# PPE Detection Dashboard — UI Fix Skill

You are redesigning a PPE (Personal Protective Equipment) detection dashboard
that displays video analysis results. The current UI has these known problems
that must be fixed in every run:

1. **Duplicate alert toasts** — three identical "20 violation(s) detected" banners
   stack on screen. Replace with a single consolidated alert banner.
2. **Flat stat row** — all five metric cards (Duration, Resolution, FPS, Frames,
   Violations) look identical. The Violations card must be visually distinct
   (danger/red tint) to draw immediate attention.
3. **Weak frame timeline** — active frame uses only a faint underline. Use a
   full red-tinted background for violation frames and a green dot / red dot
   indicator on each row.
4. **Dense violation table** — the PPE item breakdown table is cramped. Add
   confidence bars alongside percentage numbers.
5. **Badge inconsistency** — OK / VIOLATION badges need consistent color coding:
   green for OK, red for VIOLATION, neutral gray for counts.

---

## Step 1 — Locate the files

```bash
# Find the video page component
find . -type f \( -name "*.tsx" -o -name "*.jsx" -o -name "*.vue" -o -name "*.svelte" \) \
  | xargs grep -l -i "video\|ppe\|violation\|frame" 2>/dev/null | head -20

# Find stylesheets
find . -type f \( -name "*.css" -o -name "*.scss" -o -name "*.module.css" \) \
  | head -20
```

Read the files you find. Identify which framework is in use (React, Vue, Svelte,
plain HTML). Then proceed to Step 2.

---

## Step 2 — Apply the design fixes

Work through each fix in order. Read `references/design-tokens.md` for the
exact color values, spacing, and component patterns to use.

### Fix A — Consolidate alert toasts

Remove the repeated toast stack. Replace with a single banner component directly
below the page header:

```
┌─────────────────────────────────────────────────────┐
│  ⚠  20 PPE violations detected  ·  14 frames        │  ← red-tinted banner
└─────────────────────────────────────────────────────┘
```

If a toast system is used (e.g. react-hot-toast, sonner, notistack), call it
once after detection completes, not once per frame result.

### Fix B — Stat cards with visual hierarchy

Render five stat cards in a responsive grid (`repeat(auto-fit, minmax(120px, 1fr))`).
The Violations card gets a danger tint:

| Card       | Background         | Value color        |
|------------|--------------------|--------------------|
| Duration   | surface-secondary  | text-primary       |
| Resolution | surface-secondary  | text-primary       |
| FPS        | surface-secondary  | text-primary       |
| Frames     | surface-secondary  | text-primary       |
| Violations | danger-bg (#FCEBEB)| danger (#A32D2D)   |

Each card: label 11px uppercase muted → value 22px/500 → optional sub-label 12px muted.

### Fix C — Frame timeline rows

Each row in the timeline sidebar:

```
[thumb]  0:03 · #90          🔴   ← violation dot, right-aligned
         8 detections · 2p
```

- Active row: `background: #FCEBEB`, thumbnail tinted red
- Violation row (non-active): dot indicator `●` in `#E24B4A`
- Clean row: dot indicator `●` in `#639922`
- Hover: `background: surface-secondary`
- Border-bottom `0.5px` between rows, none on last child

### Fix D — Detection breakdown table

Replace plain percentage text with inline confidence bars:

```
PPE Item    Status      Detected              Confidence
──────────────────────────────────────────────────────
Hardhat     ✓ OK        2× hardhat     ████░░ 86.5%
Mask        ✗ VIOLATION 1× NO-Mask     ███░░░ 79.4%
Safety Vest ✓ OK        2× safety vest █████░ 90.3%
```

Bar: `width: 80px; height: 5px; border-radius: 99px`. Green fill for OK, red
fill for VIOLATION.

### Fix E — Badge system

Apply consistent badge classes across all badge usages:

```css
.badge-ok        { background: #EAF3DE; color: #3B6D11; }
.badge-violation { background: #FCEBEB; color: #A32D2D; }
.badge-neutral   { background: surface-secondary; color: text-secondary;
                   border: 0.5px solid border-tertiary; }
```

If using Tailwind, see `references/design-tokens.md` → Tailwind mappings section.

---

## Step 3 — Verify

After applying all fixes, run the dev server and check:

```bash
npm run dev      # or yarn dev / pnpm dev
```

Confirm:
- [ ] Only one alert banner appears after detection
- [ ] Violations stat card has red tint, others are neutral
- [ ] Active frame row is highlighted red in the timeline
- [ ] Confidence bars render next to percentages
- [ ] OK badges are green, VIOLATION badges are red

If the project has component tests:

```bash
npm test -- --testPathPattern="video|ppe|violation"
```

---

## Step 4 — Report

Summarise what you changed:
- Which files were modified
- Which components were affected
- Any breaking changes or prop additions
- How to verify in the browser

---

## Notes for edge cases

- **Dark mode**: All colors above are light-mode values. If the project has dark
  mode, read `references/design-tokens.md` → Dark mode section for the dark
  equivalents before writing any hardcoded hex values.
- **Tailwind projects**: Do not write custom CSS. Use only Tailwind utility
  classes from the mappings in `references/design-tokens.md`.
- **No framework / plain HTML**: Write vanilla CSS in a `<style>` block or
  existing stylesheet. Follow the class naming in Fix E above.
- **Vue / Svelte**: Apply the same logic inside `<style scoped>` blocks.