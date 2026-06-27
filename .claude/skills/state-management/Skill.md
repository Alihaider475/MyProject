---
name: redux-toolkit-state-management
summary: Integrate Redux Toolkit into the SafeSite AI React frontend safely, using Redux only for shared/global state while preserving existing UI, routes, APIs, Supabase Auth, MJPEG streams, and WebSocket behavior.
Redux Toolkit State Management Skill for SafeSite AI
Use this skill when the user asks to improve state management, add Redux Toolkit, clean frontend state, remove prop drilling, organize global state, or refactor SafeSite AI frontend state.
Project Context
SafeSite AI is a React 18 + Vite + Tailwind CSS frontend connected to a FastAPI backend. It includes Supabase Auth, role-based routing, dashboard live camera monitoring, camera start/stop controls, MJPEG streams, WebSocket detection counts, violation history, charts with Recharts, worker management, fine configuration, and payroll reports.
The backend already exposes APIs for cameras, violations, analytics/reports, workers, fines, payroll, detection, authentication validation, MJPEG streaming, and WebSocket updates. Do not redesign backend architecture unless explicitly requested.
Primary Goal
Integrate Redux Toolkit professionally to improve shared/global frontend state management without breaking existing behavior.
Redux Toolkit should reduce prop drilling, centralize loading/error handling, make live dashboard updates cleaner, and keep shared data consistent across pages.
Strict Rules
Do not redesign the UI.
Do not remove working features.
Do not rename routes unless required by existing broken code.
Do not change backend API endpoints unless absolutely necessary.
Do not store MJPEG frames, images, videos, blobs, base64 data, or large binary data in Redux.
Do not put every form field in Redux.
Do not replace Supabase Auth logic with a custom auth system.
Do not break role-based redirects for admin and safety manager.
Do not add unnecessary libraries beyond Redux Toolkit and React Redux unless the user approves.
What Should Go in Redux
Use Redux Toolkit for global/shared state:
Auth session, user, role, isAuthenticated, auth loading, auth error
Camera list, active camera IDs, start/stop status, camera loading, camera errors
WebSocket detection counts per camera
Violation list, filters, pagination, loading, errors, CSV export status
Analytics/chart data, loading, errors
Worker list and worker CRUD loading/errors
Fine configuration list and update status
Payroll report data, selected period, loading/errors
Global notifications/toasts only if already used across multiple pages
What Should Stay Local
Keep these in component-level state:
Single-page input values
Temporary form validation state
Modal open/close state used only in one component
Dropdown state used only in one component
File upload selected file object
MJPEG stream URL rendering
Image/video preview data
Hover state and small UI-only state
Recommended Folder Structure
Create or adapt this structure:
```txt
src/
  app/
    store.js
  features/
    auth/
      authSlice.js
    cameras/
      camerasSlice.js
    violations/
      violationsSlice.js
    analytics/
      analyticsSlice.js
    workers/
      workersSlice.js
    fines/
      finesSlice.js
    payroll/
      payrollSlice.js
  services/
    api.js
    supabaseClient.js
```
If the project already has a better structure, preserve it and add Redux files consistently.
Required Implementation Steps
Inspect the current frontend structure first.
Identify current API service file, Supabase client, route guards, pages, and repeated state logic.
Install `@reduxjs/toolkit` and `react-redux` if missing.
Create `src/app/store.js` or adapt existing store location.
Wrap the React app with `<Provider store={store}>` in `main.jsx` or `main.tsx`.
Create slices incrementally instead of rewriting the whole frontend at once.
Start with auth, cameras, and violations because they are the highest-value shared states.
Then add analytics, workers, fines, and payroll slices.
Use `createAsyncThunk` for API requests that have loading/error/success states.
Reuse the existing axios/api service instead of duplicating API clients.
Add selectors for commonly used state.
Replace prop drilling with `useSelector` and `useDispatch` only where it improves clarity.
Keep MJPEG stream rendering inside components; Redux should store only camera metadata and active status.
Dispatch Redux actions from WebSocket handlers for live detection counts and newly logged violations.
Preserve existing loading indicators and error messages unless they are broken.
Run build and smoke tests after each major slice migration.
Slice Responsibilities
authSlice
State should include:
user
session
role
isAuthenticated
loading
error
Responsibilities:
Store Supabase session after login/register/OAuth callback.
Clear session on logout.
Preserve role-based routing.
Avoid storing secrets manually.
camerasSlice
State should include:
items
activeCameraIds
countsByCameraId
startStopLoadingById
loading
error
Responsibilities:
Fetch camera list.
Start camera.
Stop camera.
Update camera detection counts from WebSocket.
Track unavailable camera errors.
Never store stream frames in Redux. Components should build the MJPEG stream URL directly from camera ID.
violationsSlice
State should include:
items
filters
pagination
loading
error
exportLoading/exportError if CSV export exists
Responsibilities:
Fetch violation records.
Apply filters.
Clear filters.
Add a new violation from WebSocket if the backend sends live violation events.
Keep table data consistent after resolving/assigning violations if those actions exist.
analyticsSlice
State should include:
summary
violationTypeDistribution
timeSeriesTrend
loading
error
Responsibilities:
Fetch chart/analytics data.
Normalize chart data for Recharts.
Keep dashboard and charts page consistent.
workersSlice
State should include:
items
selectedWorker
loading
error
mutationLoading
Responsibilities:
Fetch workers.
Add/update/delete workers if supported.
Keep worker data available for admin pages and violation assignment.
finesSlice
State should include:
configs
loading
error
saving
Responsibilities:
Fetch fine configuration.
Save fine amounts per violation type.
Preserve existing validation.
payrollSlice
State should include:
selectedMonth
selectedYear
report
loading
error
updateStatusLoading
Responsibilities:
Generate payroll deduction report.
Update fine status if supported.
Preserve selected period between payroll page interactions if useful.
WebSocket Guidance
If the app has a WebSocket listener, centralize message handling where practical.
Expected behavior:
On detection count update, dispatch camera count update action.
On new violation event, dispatch violation add/update action.
On camera status message, dispatch camera status update action.
On WebSocket error/disconnect, set connection status but do not crash UI.
Do not create multiple duplicate WebSocket connections from repeated component renders.
Component Migration Guidance
For each page, migrate carefully:
Dashboard:
Use camerasSlice for camera list, active camera IDs, start/stop loading, counts.
Keep stream image tag/component local.
Violations Page:
Use violationsSlice for records, filters, pagination, loading, and errors.
Keep table row hover/menu UI local.
Charts Page:
Use analyticsSlice for data and loading/error.
Keep chart rendering logic in the page/components.
Workers Page:
Use workersSlice for worker list and mutations.
Keep file input and form values local until submit.
Fine Configuration Page:
Use finesSlice for existing configs and save status.
Keep current edit form state local unless shared.
Payroll Page:
Use payrollSlice for selected period and generated report if shared or reused.
Navbar/Auth Guard:
Use authSlice for user, role, and authentication status.
Testing Checklist
After implementation, verify:
`npm run build` passes.
Login still works.
Logout still works.
Role-based redirect still works.
Dashboard loads cameras.
Start camera works.
Stop camera works.
MJPEG stream still displays.
WebSocket counts still update.
Violations page loads records.
Filters still work.
CSV export still works if implemented.
Charts page loads analytics.
Worker management still saves workers.
Fine configuration still saves fine amounts.
Payroll report still generates.
No repeated API calls caused by bad `useEffect` dependencies.
No duplicate WebSocket connections.
No console errors during normal navigation.
Expected Final Response From Claude Code
After making changes, provide a concise summary with:
Files changed
New Redux slices added
State moved into Redux
State intentionally kept local
Any API assumptions
Any bugs found during migration
Build/test result
Preferred Implementation Style
Use small, safe commits or steps.
Prefer readable code over clever abstractions.
Keep existing names when possible.
Avoid large rewrites.
Make the Redux integration feel like a natural improvement to the existing project, not an AI-generated replacement.

---