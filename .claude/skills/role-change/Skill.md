You are working on my SafeSite AI frontend authentication and role-based routing.

Current issue:
The user assigned as admin can still access the normal dashboard pages. I do not want that. Admin users should only access admin pages. Safety Manager / normal users should access dashboard and monitoring pages, but not admin pages.

Goal:
Implement strict role-based route protection.

Required behavior:

1. Logged-out users:

   * Can access /, /login, /register, /forgot-password, /reset-password
   * Cannot access dashboard/admin pages
   * Redirect protected pages to /login

2. Admin users:

   * Allowed:
     /admin/register-workers
     /admin/fine-config
     /admin/payroll
     /admin/workers
     /settings if settings are admin-only
   * Not allowed:
     /dashboard
     /violations
     /charts
     /detect
     /video
     /top-offenders
   * If admin tries to open a normal dashboard route, redirect to /admin/register-workers or /admin

3. Safety Manager / normal users:

   * Allowed:
     /dashboard
     /violations
     /charts
     /detect
     /video
     /top-offenders
   * Not allowed:
     /admin/register-workers
     /admin/fine-config
     /admin/payroll
     /admin/workers
   * If normal user tries to open admin route, redirect to /dashboard

Implementation instructions:

1. First inspect the current AuthContext, login role check, App.jsx routes, ProtectedRoute/PrivateRoute components if any, Navbar, and role metadata usage.
2. Find the exact role values currently used, for example admin, system_admin, safety_manager, user.
3. Do not hardcode fake authentication.
4. Do not remove Supabase Auth.
5. Do not break existing login/register/password reset.
6. Create or update a clean role guard component, for example:

   * RequireAuth
   * RequireRole
   * AdminRoute
   * ManagerRoute
7. On login:

   * Admin should redirect to /admin/register-workers or /admin
   * Safety Manager should redirect to /dashboard
8. On direct URL access:

   * Admin opening /dashboard should be redirected to /admin/register-workers
   * Safety Manager opening /admin/register-workers should be redirected to /dashboard
9. Update Navbar so admin does not see normal dashboard links unless intentionally needed.
10. Update Navbar so normal users do not see admin-only links.
11. Keep all current UI styling.
12. Do not change backend APIs unless route role validation already exists and needs alignment.
13. Run npm run build after changes.
14. Leave changes uncommitted for review.

Also check backend security:

* If backend APIs are only protected by login but not role, report which endpoints should be admin-only.
* Do not implement risky backend changes unless clearly safe.
* At minimum, list admin-only endpoints that should be protected later.

Final report required:

* Files changed
* Role values detected
* Route access rules implemented
* Login redirect behavior
* Navbar changes
* Build result
* Any backend role-security gaps found
