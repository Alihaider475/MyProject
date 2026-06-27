---
name: navbar-fix
description: "Use this skill when fixing or redesigning the top navbar/header in SafeSite AI. Triggers: navbar congestion, nav links squeezing, active item too tall, horizontal overflow, cramped header, adding new nav links, responsive navbar collapse, More dropdown, hamburger menu. Stack: React 18 + Vite + TailwindCSS + React Router. Do NOT rewrite the whole frontend, do NOT break existing routes or auth logic, Tailwind classes only."
---

# SafeSite AI — Navbar Fix Skill

## Role

Act as an Expert React + TailwindCSS UI Engineer.

---

## Goal

Fix the top navbar layout — currently congested and unprofessional after adding the CCTV Wall link. Nav items are squeezed, active item is too tall, right-side controls are cluttered.

**Scope: navbar/header only.** Do not rewrite anything else.

---

## Hard Rules (never violate)

- Do NOT rewrite the whole frontend
- Do NOT break existing routes or auth logic
- Do NOT use CSS modules — Tailwind classes only (unless project already uses CSS modules)
- Do NOT touch: Dashboard, Cameras, CCTV Wall, Violations, Alerts, Offenders, Charts, Detect, Video routes
- Do NOT break: Report button, theme toggle, user auth/avatar
- Do NOT start editing files without explicit approval

---

## Strict Workflow

1. Explore existing navbar-related files (see Phase 1)
2. Explain current navbar structure and why it's congested
3. Propose a file-by-file plan
4. **Wait for approval**
5. After approval: implement only approved files

---

## Phase 1 — Exploration

### Inspect these files

- App routing configuration
- Layout component
- Navbar / Header component
- Sidebar or navigation config
- Theme toggle component
- Report button component
- Online status badge component
- User avatar / menu component

### Report

- Where nav links are defined
- How active route styling works
- How right-side actions are rendered
- Why layout becomes congested after adding CCTV Wall

---

## Phase 2 — Required Nav Links

All 9 links must be present:

```
Dashboard | Cameras | CCTV Wall | Violations | Alerts | Offenders | Charts | Detect | Video
```

---

## Phase 3 — Layout Requirements

### 3-section layout (left / center / right)

```jsx
<header className="sticky top-0 z-50 border-b border-white/10 bg-[#05060a]/90 backdrop-blur">
  <div className="mx-auto flex h-20 w-full max-w-[1800px] items-center gap-4 px-6">
    <Brand />                          {/* Left — fixed width ~200–220px */}
    <nav className="flex min-w-0 flex-1 items-center justify-center">
      <NavLinks />                     {/* Center — flex-1, overflow-safe */}
    </nav>
    <div className="flex shrink-0 items-center gap-3">
      <ThemeToggle />
      <ReportButton />                 {/* Right — shrink-0, gap-3 */}
      <StatusBadge />
      <UserAvatar />
    </div>
  </div>
</header>
```

**Adapt to existing component structure — do not blindly replace.**

### Sizing targets

| Element         | Target size         |
|-----------------|---------------------|
| Header height   | 72px – 80px         |
| Brand width     | 200px – 220px       |
| Nav item height | 44px – 48px         |
| Avatar size     | 44px – 48px         |
| Right gap       | `gap-3` or `gap-4`  |

---

## Phase 4 — Active State Styling

- Active nav item: cyan text/border/glow — **compact, not oversized**
- All nav items same consistent height
- CCTV Wall active tab same height as all other tabs
- Use `NavLink` from React Router for active class logic

```jsx
<NavLink
  to="/cctv-wall"
  className={({ isActive }) =>
    isActive
      ? "text-cyan-400 border-b-2 border-cyan-400 px-3 py-2 text-sm font-medium"
      : "text-gray-400 hover:text-white px-3 py-2 text-sm font-medium transition"
  }
>
  CCTV Wall
</NavLink>
```

---

## Phase 5 — Responsive Behavior

| Screen    | Behavior                                                        |
|-----------|-----------------------------------------------------------------|
| Large     | Show all nav links                                              |
| Medium    | Move `Charts`, `Detect`, `Video`, `Offenders` into **More** dropdown |
| Small     | Collapse entire nav into hamburger/menu button                  |

### Navigation config array pattern

Create a nav config array if one doesn't exist:

```js
const NAV_LINKS = [
  { to: "/",           label: "Dashboard"  },
  { to: "/cameras",    label: "Cameras"    },
  { to: "/cctv-wall",  label: "CCTV Wall"  },
  { to: "/violations", label: "Violations" },
  { to: "/alerts",     label: "Alerts"     },
  { to: "/offenders",  label: "Offenders"  },
  { to: "/charts",     label: "Charts"     },
  { to: "/detect",     label: "Detect"     },
  { to: "/video",      label: "Video"      },
];
```

---

## Phase 6 — Visual Rules

**Must avoid:**
- Horizontal overflow / scrollbar
- Navbar wrapping into a second line
- Large empty gaps
- Cramped / overlapping nav items

**Must achieve:**
- Looks clean at 1366px, 1440px, and 1920px
- No stretched layout on ultrawide screens (`max-w-[1800px]` container)
- Dark theme consistent with rest of app
- Professional SaaS / security dashboard aesthetic

**Compact status badge:**
```
● Online · 0 active
```

---

## Testing Checklist

### Automated
```bash
npm run build
```

### Manual verification
- [ ] Navbar clean at 1366px width
- [ ] Navbar clean at 1920px width
- [ ] CCTV Wall active state styled correctly
- [ ] All 9 route links navigate correctly
- [ ] No horizontal scrollbar
- [ ] Right-side actions (toggle, report, badge, avatar) all visible
- [ ] Existing Dashboard layout not broken
- [ ] More dropdown works on medium screens (if implemented)
- [ ] Hamburger works on small screens (if implemented)

---

## Deliverables

1. Summary of navbar changes
2. Changed files list
3. Screens/resolutions tested
4. Commands run and results
5. Follow-up improvements recommended