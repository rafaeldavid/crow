#!/bin/bash
# Runs one command with the development host's keys (T-485). It reads the service account's token from the session
# user's Keychain (macOS) or its file (Ubuntu), and gives it to `op run` only, which resolves
# config/secrets/dev-host.refs into that one command's environment. The command itself never sees the token.
#
#   infra/dev-host/with-keys.sh [--yes] node infra/party/up.mjs --role buyer --run <id> --yes
#
# It prints the commit and the SHA-256 of itself, the references file and the command's file when that file is in
# the repository, and waits for a typed yes; a session, which has no terminal, passes --yes.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
REFS="$ROOT/config/secrets/dev-host.refs"
SERVICE=crow-op-service-account
TOKEN_FILE="$HOME/.config/crow/op-service-account"
die() { printf 'with-keys: %s\n' "$*" >&2; exit 1; }

yes=0
if [ "${1:-}" = --yes ]; then yes=1; shift; fi
[ $# -gt 0 ] || die "usage: infra/dev-host/with-keys.sh [--yes] <command> [arguments]"

files=("$HERE/with-keys.sh" "$REFS")
for a in "$@"; do
  case "$a" in -*) continue ;; esac
  p="$a"; case "$p" in /*) ;; *) p="$PWD/$p" ;; esac
  case "$p" in "$ROOT"/*) [ -f "$p" ] && files+=("$p") ;; esac
done
sha() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi; }
commit="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || echo unknown)"
changed="$(git -C "$ROOT" status --porcelain -- "${files[@]}" 2>/dev/null || true)"
{
  echo "with-keys: the development host's keys, for one command"
  echo "  From commit: $commit${changed:+ (CHANGED since that commit)}"
  echo "  Files, SHA-256:"
  for f in "${files[@]}"; do echo "    $(sha "$f")  ${f#"$ROOT"/}"; done
} >&2
[ "$commit" != unknown ] || die "the commit is unknown: run it from a checkout"
if [ "$yes" = 0 ]; then
  [ -t 0 ] || die "standard input is not a terminal: read the lines above, then pass --yes"
  read -r -p "Type yes to run this command with the keys: " answer
  [ "$answer" = yes ] || die "stopped: the answer was not yes"
fi

case "$(uname -s)" in
  Darwin) tok="$(security find-generic-password -a "$(id -un)" -s "$SERVICE" -w 2>/dev/null)" || die "no service account token in this user's Keychain (setup-user.sh)" ;;
  *) [ -s "$TOKEN_FILE" ] || die "no service account token at $TOKEN_FILE (setup-user.sh)"; tok="$(cat "$TOKEN_FILE")" ;;
esac
OP_SERVICE_ACCOUNT_TOKEN="$tok" exec op run --env-file="$REFS" -- /usr/bin/env -u OP_SERVICE_ACCOUNT_TOKEN "$@"
