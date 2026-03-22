# GitHub CLI — Recommended Workflow for ægentic.js / WRANGLERBASE

This document provides optimised GitHub CLI (`gh`) patterns for day-to-day repository
management of this project. All commands assume the `gh` CLI is authenticated
(`gh auth login`) and the working directory is the repository root.

---

## Table of contents

1. [Repository setup](#1-repository-setup)
2. [Branch management](#2-branch-management)
3. [Pull requests](#3-pull-requests)
4. [Issues](#4-issues)
5. [Actions / CI](#5-actions--ci)
6. [Releases](#6-releases)
7. [Aliases (time-savers)](#7-aliases-time-savers)
8. [Scripting tips](#8-scripting-tips)

---

## 1. Repository setup

### Create the ægentic.js repository

> **Note:** The repository name intentionally uses the `æ` ligature. GitHub supports
> Unicode characters in repository names, but some older Git clients or file systems
> may not handle them correctly. As a fallback you can use `aegentic.js` instead.

```bash
# Public repo, MIT licence, with a generated README
gh repo create MYaelMendez/ægentic.js \
  --public \
  --license MIT \
  --description "æ>_ WRANGLERBASE v7.5 — superb iteration on Agentic.js" \
  --add-readme \
  --clone

# Fallback: ASCII-safe alternative name
# gh repo create MYaelMendez/aegentic.js --public --license MIT --add-readme --clone
```

### Clone the existing Agentic.js repo

```bash
gh repo clone MYaelMendez/Agentic.js
```

### View repository details at a glance

```bash
gh repo view --web          # open in browser
gh repo view                # inline summary
```

### Update repository settings without opening the browser

```bash
gh repo edit \
  --description "æ>_ WRANGLERBASE v7.5" \
  --homepage "https://myaelmendez.github.io/ægentic.js" \
  --enable-issues \
  --enable-projects \
  --delete-branch-on-merge   # auto-delete merged branches
```

---

## 2. Branch management

### Create a feature branch and push it immediately

```bash
git switch -c feature/my-feature
git push -u origin feature/my-feature
# or, using gh (sets upstream automatically):
gh repo sync
```

### List branches with their status

```bash
gh api repos/{owner}/{repo}/branches --jq '.[].name'
```

### Delete a remote branch after merge

```bash
git push origin --delete feature/my-feature
```

---

## 3. Pull requests

### Create a PR with a detailed description

```bash
gh pr create \
  --title "feat: optimise WRANGLERBASE overlay rendering" \
  --body-file .github/PULL_REQUEST_TEMPLATE.md \
  --label "enhancement" \
  --assignee "@me" \
  --draft                  # open as draft until ready for review
```

### Promote draft to ready-for-review

```bash
gh pr ready
```

### Check out a PR locally for review

```bash
gh pr checkout 42
```

### View PR status and CI checks inline

```bash
gh pr status                 # summary of your open PRs
gh pr checks 42              # live CI check status for PR #42
gh pr view 42 --web          # open in browser
```

### Merge strategies

```bash
# Squash merge (recommended for feature branches)
gh pr merge 42 --squash --delete-branch

# Rebase merge (preserves commits linearly)
gh pr merge 42 --rebase --delete-branch

# Standard merge commit
gh pr merge 42 --merge
```

### Auto-merge when all checks pass

```bash
gh pr merge 42 --squash --auto --delete-branch
```

---

## 4. Issues

### Create a well-labelled issue

```bash
gh issue create \
  --title "Bug: scan-line animation flickers on Firefox" \
  --body "Steps to reproduce…" \
  --label "bug,frontend" \
  --assignee "@me" \
  --milestone "v7.5.1"
```

### List open issues filtered by label

```bash
gh issue list --label "enhancement" --state open
```

### Close an issue with a comment

```bash
gh issue close 17 --comment "Fixed in PR #42."
```

### Link an issue to a PR (via comment)

```bash
gh issue comment 17 --body "Tracked in PR #42."
```

---

## 5. Actions / CI

### Trigger a workflow manually

```bash
gh workflow run ci.yml --ref main
```

### Watch a live run

```bash
gh run watch                    # most recent run
gh run watch $(gh run list --limit 1 --json databaseId -q '.[0].databaseId')
```

### List recent runs with status

```bash
gh run list --limit 10
```

### Download logs from a failed run

```bash
gh run download <run-id>        # downloads all artifacts
gh run view <run-id> --log-failed   # print only failed step logs
```

### Re-run failed jobs only

```bash
gh run rerun <run-id> --failed
```

---

## 6. Releases

### Create a release from a tag (auto-generate notes)

```bash
git tag -a v7.5.0 -m "WRANGLERBASE v7.5 initial release"
git push origin v7.5.0

gh release create v7.5.0 \
  --title "æ>_ WRANGLERBASE v7.5" \
  --generate-notes \
  --latest
```

### Upload build artefacts to a release

```bash
gh release upload v7.5.0 dist/wranglerbase-v7.5.0.zip
```

### List all releases

```bash
gh release list
```

---

## 7. Aliases (time-savers)

Add these to your shell profile or `~/.config/gh/config.yml` to speed up
repeated operations:

```bash
# One-liner to open the current branch's PR
gh alias set pr-open 'pr view --web'

# Create a draft PR from current branch
gh alias set pr-draft 'pr create --draft --assignee "@me"'

# Show only failed CI checks for the current PR
gh alias set ci-fail 'pr checks --fail-only'

# Quick issue triage
gh alias set triage 'issue list --state open --label "needs-triage"'
```

Verify aliases:

```bash
gh alias list
```

---

## 8. Scripting tips

### Batch-label stale issues (older than 30 days, no activity)

```bash
gh issue list --state open --json number,updatedAt \
  --jq '.[] | select(.updatedAt < (now - 2592000 | todate)) | .number' \
  | xargs -I{} gh issue edit {} --add-label "stale"
```

### Check if a PR is mergeable before merging

```bash
MERGEABLE=$(gh pr view 42 --json mergeable -q '.mergeable')
if [ "$MERGEABLE" = "MERGEABLE" ]; then
  gh pr merge 42 --squash --delete-branch
else
  echo "PR #42 is not mergeable: $MERGEABLE"
fi
```

### Export issue list to CSV

```bash
gh issue list --state all --json number,title,state,labels,createdAt \
  --jq '.[] | [.number, .title, .state, (.labels | map(.name) | join(";")), .createdAt] | @csv' \
  > issues.csv
```

### Sync a fork's default branch with upstream

```bash
gh repo sync MYaelMendez/Agentic.js --source huggingface/transformers.js --branch main
```

---

> **Tip:** Run `gh help <command>` for full flag reference, or `gh <command> --help`
> for a specific sub-command (e.g. `gh pr create --help`).
