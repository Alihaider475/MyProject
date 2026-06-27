---
name: save-work
description: Stages, commits, and pushes current work to the remote branch
---

Save and push all current work with a meaningful commit message.

## Step 1 — Show what has changed

Run: `git status --short`
Then run: `git diff --stat`

Display the output so the user can see exactly what will be committed.

## Step 2 — Check if there is anything to commit

If `git status --short` output is empty, tell the user: "Nothing to commit — working tree is clean." and stop.

## Step 3 — Ask for a commit message

Ask the user: "Enter a commit message describing what you did (leave blank to auto-generate from changed files):"

If the user provides a message, use it as COMMIT_MSG.

If the user leaves it blank, generate a short message automatically based on the changed file names and types of changes (added/modified/deleted). Format: "feat: update X and Y" or "fix: correct Z". Store as COMMIT_MSG.

## Step 4 — Stage all changes

Run: `git add -A`

Confirm staging with: `git status --short`

## Step 5 — Commit

Run: `git commit -m "COMMIT_MSG"`

If commit fails (e.g. pre-commit hook), show the error and stop. Do not retry automatically.

## Step 6 — Push to remote

Check current branch: `git branch --show-current`

If branch is `main`, warn the user: "You are pushing directly to main. Are you sure? (yes/no)"
- If no: stop.

Run: `git push origin CURRENT_BRANCH`

If the push fails because the remote branch doesn't exist yet, run:
`git push --set-upstream origin CURRENT_BRANCH`

## Step 7 — Confirm

Print:
- Branch pushed to
- Commit hash (run `git log --oneline -1`)
- Remote URL (run `git remote get-url origin`)

Tell the user: "Work saved and pushed successfully."
