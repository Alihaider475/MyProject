You are working in my SafeSite AI FastAPI backend.

Task:
Find the exact cause of the Swagger/OpenAPI error first. Do not fix anything yet.

Current problem:
Swagger UI opens at:

http://127.0.0.1:8000/docs

But it fails to load API definition because:

/openapi.json returns Internal Server Error.

The error from `python check_openapi.py` is:

PydanticUserError:
`TypeAdapter[typing.Annotated[ForwardRef('FileResponse'), FieldInfo(annotation=NoneType, required=True)]]` is not fully defined.

Before making any code changes:

1. Inspect only these files:

   * backend/api/routes/*.py
   * backend/main.py
   * backend/auth/supabase_auth.py only if needed
2. Search for problematic FastAPI route annotations:

   * `-> FileResponse`
   * `-> StreamingResponse`
   * `-> Response`
   * `FileResponse` used as a route parameter
   * `StreamingResponse` used as a route parameter
3. Run or reproduce the issue using:
   python check_openapi.py
4. Identify the exact file, route path, function name, and line causing `/openapi.json` to fail.
5. Explain why this breaks FastAPI OpenAPI generation.
6. Do not edit files yet.
7. Give me a small file-by-file fix plan and wait for my approval.

Rules:

* Do not implement a new feature.
* Do not modify frontend files.
* Do not modify database models.
* Do not remove authentication.
* Do not change route paths.
* Do not change API response formats.
* Only investigate and report the root cause first.

Expected response from you:

1. Exact error source
2. Exact file/function causing it
3. Why it happens
4. Minimal fix plan
5. Ask for approval before editing
