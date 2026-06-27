You are working on my SafeSite AI project.

Goal:
Implement proper backend authentication and authorization using Supabase JWT tokens.

Current stack:
- Frontend: React + Vite
- Backend: FastAPI
- Auth: Supabase Auth
- Database: SQLAlchemy with SQLite/PostgreSQL support

Tasks:
1. Inspect the existing backend auth structure, routes, and frontend Supabase auth context.
2. Add a reusable FastAPI dependency that:
   - Reads the Authorization: Bearer <token> header
   - Verifies the Supabase JWT token
   - Extracts user_id, email, and role
   - Rejects unauthenticated users with 401
3. Add role-based dependencies:
   - require_authenticated_user
   - require_admin_user
   - require_safety_manager_or_admin
4. Protect backend routes properly:
   - Cameras, dashboard, stream, violations, detect, video detect: authenticated users
   - Workers, fine configuration, payroll reports: admin users only
5. Do not rely only on frontend route protection.
6. Keep the current frontend login/signup flow working.
7. Do not break existing API response formats used by the frontend.
8. Add clear error messages for unauthorized and forbidden access.
9. Add tests or manual verification steps for:
   - No token
   - Invalid token
   - Valid safety manager token
   - Valid admin token

Important:
Do not rewrite the whole project. Modify only the required files and preserve the existing structure.