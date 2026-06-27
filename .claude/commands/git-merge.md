---
name: git-merge
description: Merges current feature branch into main and cleans up the branch
---

Merge your feature branch into main, push, and clean up.

## Step 1 — Show current state

Run: `git branch --show-current`
Run: `git log main..HEAD --oneline`

Show the user which branch they are on and how many commits ahead of main it is.

If current branch is already `main`, tell the user: "You are already on main. Nothing to merge." and stop.

If there are no commits ahead of main, tell the user: "This branch has no new commits ahead of main. Nothing to merge." and stop.

## Step 2 — Confirm intent

Ask the user: "Ready to merge [CURRENT_BRANCH] into main. This will:
1. Switch to main
2. Pull latest main
3. Merge your branch
4. Push main to remote
5. Delete the feature branch locally and remotely

Proceed? (yes/no)"

If no: stop.

## Step 3 — Make sure work is saved

Run: `git status --short`

If there are uncommitted changes, stop and tell the user:
"You have uncommitted changes. Run /save-work first to commit and push them before merging."

## Step 4 — Switch to main and pull latest

Run:
```
git checkout main
git pull origin main
```

If pull fails, show the error and stop.

## Step 5 — Merge the feature branch

Run: `git merge FEATURE_BRANCH --no-ff -m "Merge branch 'FEATURE_BRANCH' into main"`

Using `--no-ff` preserves branch history with a merge commit.

If merge fails due to conflicts:
- Run `git diff --name-only --diff-filter=U` to list conflicted files
- Show the list to the user
- Tell them: "Merge conflicts found in the above files. Resolve them manually, then run `git add .` and `git commit` to complete the merge."
- Stop.

## Step 6 — Push main

Run: `git push origin main`

If push fails, show the error. Do not force push. Stop and ask the user how to proceed.

## Step 7 — Delete the feature branch

Ask the user: "Delete the feature branch [FEATURE_BRANCH] locally and from remote? (yes/no)"

If yes:
```
git branch -d FEATURE_BRANCH
git push origin --delete FEATURE_BRANCH
```

If the local delete fails (branch not fully merged warning), tell the user and skip — do not force delete.
If remote delete fails because it doesn't exist remotely, skip silently.

## Step 8 — Summary

Print:
- Merged branch name
- Final commit on main (run `git log --oneline -1`)
- Whether branch was deleted

Tell the user: "Merge complete. You are now on main."
