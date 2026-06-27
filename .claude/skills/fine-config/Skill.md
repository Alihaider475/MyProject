---

name: safesite-fr15-fine-type
description: Implement SafeSite AI FR_15 Add Fine Type on the Fine Configuration page using existing backend routes, schemas, API client, and dashboard UI patterns.
--------------------------------------------------------------------------------------------------------------------------------------------------------------------

# SafeSite AI FR_15 Add Fine Type Skill

## Purpose

Use this skill when implementing or fixing **FR_15 Fine Configuration and Calculation** in the SafeSite AI project.

The goal is to add an **Add Fine Type** feature on the Fine Configuration page so an admin can create a new fine configuration for a PPE violation type.

## Project Context

SafeSite AI is a React + Vite frontend with a Python FastAPI backend. The system includes worker management, violation logging, fine configuration, payroll reports, and admin dashboard pages.

FR_13 Worker Edit/Delete is already completed. Do not modify or break worker edit/delete behavior.

## Required Feature

On the Fine Configuration page, implement an **Add Fine Type** button and form/modal.

The feature must allow an admin to create a fine configuration for a violation type.

## Before Coding

First inspect the existing project structure and identify:

* Fine Configuration frontend page/component
* Existing frontend API client methods
* Existing backend fine/fine-config routes
* Existing backend schemas
* Existing database models/tables related to fines, fine_config, violation_types, or violation types
* Existing styling/component patterns used in the admin dashboard

Reuse existing naming, structure, and UI patterns. Do not invent a new architecture if existing patterns already exist.

## UI Requirements

Add an **Add Fine Type** button on the Fine Configuration page.

When clicked, open either a clean modal or an inline form consistent with the current admin dashboard UI.

The form should include these fields:

* Violation type or name
* Fine amount
* Active status
* Description only if the backend/database already supports it

Use existing button, input, modal, card, table, toast, and loading styles if available.

## Validation Rules

Frontend validation:

* Violation type/name is required
* Fine amount is required
* Fine amount must be numeric
* Fine amount must be greater than 0
* Active status should default to active

Backend/API error handling:

* If duplicate violation type is rejected by the backend, show a clear error message
* If backend returns validation error, display it professionally
* If network/API fails, show a user-friendly error
* Do not silently fail

## Backend/API Requirements

Use the existing fine/fine-config API if available.

If a create endpoint already exists, connect the form to it.

If no create endpoint exists, add the smallest consistent backend implementation needed, following the existing route, schema, model, and database style.

Do not create duplicate tables or duplicate concepts if violation types/fine configs already exist.

Do not hardcode only NO-Hardhat, NO-Vest, and NO-Mask. The feature should support adding new violation types/fine types.

## Save Behavior

After successful save:

* Close the modal/form
* Reset the form fields
* Refresh the fine configuration table/list
* Show a success message
* New fine type should appear without requiring manual page refresh

## Safety Rules

Do not break:

* Existing Fine Configuration table
* Existing fine calculation behavior
* Payroll report page
* Worker management page
* Worker edit/delete feature
* Violation logging page
* Existing admin routing/layout

Do not remove existing functionality unless it is clearly dead or duplicated, and explain before doing it.

## Testing Requirements

After implementation, run available checks:

* Frontend build
* Frontend lint if configured
* Backend import/startup check if backend files were changed
* Relevant API/manual verification

Use commands already defined in the project such as:

```bash
npm run build
npm run lint
python -m uvicorn backend.main:app --reload
```

Only run commands that exist in the project. If a command is unavailable, mention it instead of forcing it.

## Acceptance Checklist

The task is complete only when:

* Add Fine Type button is visible
* Modal/form opens correctly
* Required fields validate properly
* Fine amount rejects invalid values
* API request saves the new fine type
* Duplicate backend error is displayed clearly
* Form closes/resets after success
* Fine configuration list refreshes after success
* Existing pages still build successfully
* No unrelated UI or backend changes are introduced

## Final Response Format

After coding, summarize:

1. Files changed
2. Backend/API behavior used or added
3. Frontend behavior added
4. Validation added
5. Commands run and their result
6. Any remaining issue or manual step
