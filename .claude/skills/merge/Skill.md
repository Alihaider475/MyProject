You are working in my SafeSite AI repository.

Current Git situation:
I am on branch `dev`.
I ran `git pull origin dev` and now the repository is in a merge-conflict state.

Current conflict files:

* backend/routes/dashboard.py
* backend/routes/violations.py

Important context:
The project has recently been refactored:

* old route folder: backend/api/routes/
* new route folder: backend/routes/
* old DB folder: backend/db/
* new DB folder: backend/database/
* dependencies moved toward backend/core/dependencies.py
* detection modules moved toward backend/detection/

There are many staged changes from the merge, but only these files are unmerged:

* backend/routes/dashboard.py
* backend/routes/violations.py

Task:
Resolve the merge conflicts safely and complete the merge process.

Before editing:

1. Inspect current Git status.
2. Inspect only the conflicted files first:

   * backend/routes/dashboard.py
   * backend/routes/violations.py
3. If needed, inspect only these supporting files:

   * backend/core/dependencies.py
   * backend/auth/supabase_auth.py
   * backend/database/models.py
   * backend/schemas/dashboard.py
   * backend/schemas/violation.py
   * backend/main.py
4. Explain what is conflicting in each file.
5. Identify which side uses the newer refactored structure.
6. Identify which side contains important backend JWT/auth protection.
7. Create a minimal conflict-resolution plan.
8. Wait for my approval before editing.

Conflict resolution rules:

* Resolve only backend/routes/dashboard.py and backend/routes/violations.py unless an import check proves another file must be touched.
* Do not modify unrelated frontend files.
* Do not modify Docker files.
* Do not modify requirements unless absolutely required.
* Do not rewrite files from scratch.
* Preserve the new refactored import structure:

  * backend/routes
  * backend/database
  * backend/core/dependencies
  * backend/detection
* Preserve backend JWT/auth protection.
* Preserve existing route paths and API response formats.
* Preserve dashboard and violation functionality.
* Remove all Git conflict markers:

  * <<<<<<<
  * =======
  * > > > > > > >
* Do not delete working logic from either side without explaining why.
* If both sides contain useful logic, combine them cleanly.

After editing:

1. Run:
   git status
2. Run:
   Select-String -Path backend/routes/dashboard.py,backend/routes/violations.py -Pattern "<<<<<<<|=======|>>>>>>>"
3. If no conflict markers remain, run:
   python check_openapi.py
4. If check_openapi.py does not exist, create a temporary check_openapi.py with:
   from backend.main import app
   import traceback

   print("Generating OpenAPI...")

   try:
   app.openapi()
   print("OpenAPI OK")
   except Exception:
   traceback.print_exc()
5. Run:
   python -m py_compile backend/routes/dashboard.py
   python -m py_compile backend/routes/violations.py
6. Run backend startup check if possible:
   python -m uvicorn backend.main:app --reload
7. Verify:

   * http://127.0.0.1:8000/openapi.json returns JSON
   * http://127.0.0.1:8000/docs loads successfully

After verification:

1. Show me the final diff summary.
2. List exactly which files were changed.
3. Tell me the exact commands I should run to complete the merge commit:
   git add backend/routes/dashboard.py backend/routes/violations.py
   git commit -m "Resolve dev merge conflicts"
4. Do not run git commit unless I explicitly approve.
