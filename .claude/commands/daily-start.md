---
name: daily-start
description: Pulls latest main and creates a new feature branch to start the day
---

Start a new work session by syncing with main and creating a feature branch.

## Step 1 — Get branch name from user

Ask the user: "What are you working on today? Enter a short branch name (e.g. fix-camera-stream, add-email-alerts):"

Wait for their response. Sanitize it: lowercase, replace spaces with hyphens, strip special characters.
Store it as BRANCH_NAME.

## Step 2 — Check for uncommitted changes

Run: `git status --short`

If there are uncommitted changes, warn the user:
"You have uncommitted changes on the current branch. Stash them first with `git stash`, or commit them before switching."
Stop and do not proceed until the user confirms how to handle it.

## Step 3 — Switch to main and pull latest

Run these in order:
```
git checkout main
git pull origin main
```

Report the result. If pull fails (e.g. merge conflict or network error), stop and show the error to the user.

## Step 4 — Create and switch to feature branch

Run: `git checkout -b BRANCH_NAME`

If the branch already exists, inform the user and ask: "Branch already exists. Switch to it instead? (yes/no)"
- If yes: run `git checkout BRANCH_NAME`
- If no: ask for a different branch name and repeat Step 4

## Step 5 — Confirm ready

Print a summary:
- Current branch
- Last commit on main (run `git log --oneline -1`)
- Any reminders about the project (check CLAUDE.md for anything relevant)

Tell the user: "You're all set. Start coding!"
