#!/bin/bash
# The nightly memory push on the development host (T-485; record, section 6, "Services"). The agents' memory folder
# loads into every session as standing instructions, so each change to it becomes one reviewable diff: a commit on
# the branch memory/dev-host of crow-private, under memory/dev-host/. A secret scan runs first; on a finding it
# pushes nothing and exits 1. It runs as the session user, from a launchd agent (macOS) or a systemd timer (Ubuntu).
set -euo pipefail
# launchd and systemd start jobs with a short PATH; Homebrew's tools (gitleaks) live outside it.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# The project path setup-user.sh used (--project); the launchd agent or the systemd unit passes it as $1.
PROJECT="${1:-$HOME/escrow}"
PRIVATE="$PROJECT/reports/crow-private"
# Claude Code names a project's folder after its path, each character other than a letter or digit turned into "-".
SLUG="$(printf '%s' "$PROJECT" | sed 's/[^A-Za-z0-9]/-/g')"
SOURCE="$HOME/.claude/projects/$SLUG/memory"
WORK="$HOME/.local/state/crow-memory/worktree"
BRANCH=memory/dev-host
stamp() { date -u +"%Y-%m-%d %H:%M UTC"; }

[ -d "$SOURCE" ] || { echo "$(stamp) memory-push: no memory folder yet"; exit 0; }
git -C "$PRIVATE" fetch --quiet origin
if [ ! -d "$WORK/.git" ] && [ ! -f "$WORK/.git" ]; then
  if git -C "$PRIVATE" rev-parse --verify --quiet "refs/remotes/origin/$BRANCH" >/dev/null; then
    git -C "$PRIVATE" worktree add --quiet -B "$BRANCH" "$WORK" "origin/$BRANCH"
  else
    git -C "$PRIVATE" worktree add --quiet -B "$BRANCH" "$WORK" origin/main
  fi
fi
git -C "$WORK" pull --quiet --ff-only origin "$BRANCH" 2>/dev/null || true
mkdir -p "$WORK/memory/dev-host"
rsync -a --delete --exclude '.DS_Store' "$SOURCE/" "$WORK/memory/dev-host/"
# gitleaks exits 3 on a finding (--exit-code) and 1 when it could not scan; either way nothing is pushed.
scan=0
gitleaks dir --no-banner --redact --exit-code 3 "$WORK/memory/dev-host" >/dev/null 2>&1 || scan=$?
if [ "$scan" = 3 ]; then
  echo "$(stamp) memory-push: the secret scan found something in the memory folder; nothing pushed. Run: gitleaks dir --redact $WORK/memory/dev-host"
  exit 1
elif [ "$scan" != 0 ]; then
  echo "$(stamp) memory-push: the secret scan could not run (exit $scan); nothing pushed"
  exit 1
fi
git -C "$WORK" add -A memory/dev-host
if git -C "$WORK" diff --cached --quiet; then echo "$(stamp) memory-push: no change"; exit 0; fi
git -C "$WORK" commit --quiet -m "memory: the dev host's memory folder on $(date -u +%Y-%m-%d)"
git -C "$WORK" push --quiet origin "$BRANCH"
echo "$(stamp) memory-push: pushed $(git -C "$WORK" rev-parse --short HEAD)"
