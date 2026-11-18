#!/bin/bash
# The session user's setup on the development host (T-485; decision record T-484, section 6).
# The session user (crow) runs it, at the Mac mini's screen, from ~/crow-setup, which setup-admin.sh copied there.
# It also runs on Ubuntu 24.04, so a rented Linux host stays the fallback (README, "Ubuntu instead").
#
#   bash setup-user.sh --hashes                            the commit and the hashes only; changes nothing
#   bash setup-user.sh --agents-login <login> [options]
#
# Options:
#   --public-repo <owner/name>     default rafaeldavid/holdback
#   --private-repo <owner/name>    default rafaeldavid/crow-private
#   --project <path>               where the public repository goes (default: escrow in this user's home, so
#                                  /Users/crow/escrow for the record's user crow). Each person's session user has its own.
#
# It runs in two passes. The first installs what needs no key, makes the SSH key for party machines and stops,
# printing how Rafa hands over the service account's token. The second, after the hand-over, moves the token into
# this user's Keychain (macOS) or a file only this user reads (Ubuntu), signs gh in as the agents' account from the
# vault, installs Foundry, clones both repositories and installs the nightly memory push. Each step checks first.
# It prints the commit and the SHA-256 of each file it runs, and waits for a typed yes.
set -euo pipefail

# shellcheck disable=SC2016 # git archive fills this in; the dollar signs are literal on purpose
COMMIT='$Format:%H$'
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
REFS="$ROOT/config/secrets/dev-host.refs"
FILES=("$HERE/setup-user.sh" "$HERE/settings.local.json" "$HERE/memory-push.sh" "$REFS" "$ROOT/.nvmrc" "$ROOT/package.json" "$ROOT/.github/workflows/ci.yml")
SERVICE=crow-op-service-account
INCOMING="$HOME/.config/crow/op-token.incoming"
TOKEN_FILE="$HOME/.config/crow/op-service-account"
PROJECT="$HOME/escrow"

say() { printf '%s\n' "$*"; }
die() { printf 'setup-user: %s\n' "$*" >&2; exit 1; }

login=""
public_repo=rafaeldavid/holdback
private_repo=rafaeldavid/crow-private
mode=setup
while [ $# -gt 0 ]; do
  case "$1" in
    --hashes) mode=hashes; shift ;;
    --agents-login) login="${2:-}"; shift 2 ;;
    --public-repo) public_repo="${2:-}"; shift 2 ;;
    --private-repo) private_repo="${2:-}"; shift 2 ;;
    --project) PROJECT="${2:-}"; shift 2 ;;
    *) die "unknown option ${1:0:40}. Read the header of this file for the usage." ;;
  esac
done

sha() { if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1" | cut -d' ' -f1; else sha256sum "$1" | cut -d' ' -f1; fi; }
commit_of() {
  if printf '%s' "$COMMIT" | grep -Eq '^[0-9a-f]{40}$'; then
    printf '%s (git archive)' "$COMMIT"
  elif c="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)"; then
    if [ -n "$(git -C "$ROOT" status --porcelain -- "${FILES[@]}" 2>/dev/null)" ]; then printf '%s (checkout, CHANGED since that commit)' "$c"; else printf '%s (checkout)' "$c"; fi
  else
    printf 'unknown'
  fi
}
c="$(commit_of)"
say "The session user's setup"
say "  From commit: $c"
say "  Files it runs and reads, SHA-256:"
for f in "${FILES[@]}"; do [ -f "$f" ] || die "missing $f"; say "    $(sha "$f")  ${f#"$ROOT"/}"; done
[ "$mode" = hashes ] && exit 0
[ "$c" = unknown ] && die "the commit is unknown: run it from the folder setup-admin.sh made, or a git archive"
[ -t 0 ] || die "standard input is not a terminal: run it in a terminal, as the session user"
read -r -p "Type yes to run these files as $(id -un): " answer
[ "$answer" = yes ] || die "stopped: the answer was not yes"

# --- Which system, and a Standard user ------------------------------------------------------------------------------
os=""
case "$(uname -s)" in
  Darwin) os=macos ;;
  Linux) if grep -qx 'ID=ubuntu' /etc/os-release && grep -qx 'VERSION_ID="24.04"' /etc/os-release; then os=ubuntu; fi ;;
esac
[ -n "$os" ] || die "this script runs on macOS or Ubuntu 24.04"
[ "$(id -u)" != 0 ] || die "run it as the session user, not root"
for g in $(id -Gn); do case "$g" in admin|sudo|wheel) die "$(id -un) is in the group $g: the session user must be a Standard user" ;; esac; done
[ -n "$login" ] || die "--agents-login <the agents' GitHub login> is required"
printf '%s' "$login" | grep -Eq '^[A-Za-z0-9-]{1,39}$' || die "--agents-login is not a GitHub login"

# --- Tools the administrator installed (macOS) or the host provides (Ubuntu) ----------------------------------------
missing=""
for t in git node corepack gh gitleaks op ssh-keygen curl java; do command -v "$t" >/dev/null 2>&1 || missing="$missing $t"; done
[ -z "$missing" ] || die "missing:$missing. On macOS setup-admin.sh installs them; on Ubuntu see README, 'Ubuntu instead'."
# macOS ships a java stub that only offers to install Java; a real one answers -version.
java -version >/dev/null 2>&1 || die "java does not run: on macOS setup-admin.sh installs it; on Ubuntu see README, 'Ubuntu instead'"
node -e '
  const want = require(process.argv[1]).engines.node.replace(/^>=\s*/, "").split(".").map(Number);
  const have = process.versions.node.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((have[i] ?? 0) > (want[i] ?? 0)) process.exit(0); if ((have[i] ?? 0) < (want[i] ?? 0)) process.exit(1); }
' "$ROOT/package.json" || die "Node $(node --version) is older than package.json's engines field"

# --- PATH for this user: pnpm (corepack) and Foundry live in the user's own folders ---------------------------------
profile="$HOME/.zprofile"; [ "$os" = ubuntu ] && profile="$HOME/.profile"
mkdir -p "$HOME/.local/bin" "$HOME/.foundry/bin"
# shellcheck disable=SC2016 # the profile line is written literally, to expand at login
line='export PATH="$HOME/.local/bin:$HOME/.foundry/bin:$PATH"'
touch "$profile"
grep -qxF "$line" "$profile" || printf '\n# Crow dev host (infra/dev-host/setup-user.sh)\n%s\n' "$line" >> "$profile"
export PATH="$HOME/.local/bin:$HOME/.foundry/bin:$PATH"
corepack enable --install-directory "$HOME/.local/bin"

# --- The SSH key for party machines and the rehearsal pair ----------------------------------------------------------
install -d -m 700 "$HOME/.ssh"
if [ ! -f "$HOME/.ssh/crow-party" ]; then ssh-keygen -q -t ed25519 -N '' -C "crow-dev-host-parties" -f "$HOME/.ssh/crow-party"; fi
say "The SSH key for party machines. Add its public half to the team crow-parties in DigitalOcean's page:"
say "  $(cat "$HOME/.ssh/crow-party.pub")"
say "  fingerprint $(ssh-keygen -l -E md5 -f "$HOME/.ssh/crow-party.pub" | awk '{ print $2 }' | sed 's/^MD5://')"

# --- The service account's token ------------------------------------------------------------------------------------
have_token() {
  if [ "$os" = macos ]; then security find-generic-password -a "$(id -un)" -s "$SERVICE" >/dev/null 2>&1; else [ -s "$TOKEN_FILE" ]; fi
}
if [ -f "$INCOMING" ]; then
  if [ "$(wc -l < "$INCOMING" | tr -d ' ')" -gt 1 ] || ! head -c 4 "$INCOMING" | grep -qx 'ops_'; then die "the handed-over file does not look like one service account token; ask Rafa to hand it over again"; fi
  if [ "$os" = macos ]; then
    tok="$(tr -d '\n' < "$INCOMING")"
    # security -i reads the command from standard input, so the token is never an argument of a process.
    printf 'add-generic-password -U -a %s -s %s -w %s\n' "$(id -un)" "$SERVICE" "$tok" | security -i >/dev/null
    unset tok
    have_token || die "the token did not reach the Keychain: is this user logged in at the screen?"
    rm -P "$INCOMING"
  else
    install -m 600 "$INCOMING" "$TOKEN_FILE"
    shred -u "$INCOMING" 2>/dev/null || rm -f "$INCOMING"
  fi
  say "The service account's token: stored for $(id -un) only."
fi
if ! have_token; then
  say ""
  say "setup-user: first pass done. Next, Rafa hands over the service account's token (README, 'Hand over the token'):"
  say "  on his own Mac, with the Claude desktop app quit, he pipes it to the administrator over SSH,"
  say "  then runs 'bash setup-admin.sh --hand-over-token' as the administrator. Then run this script again."
  exit 3
fi
read_token() { if [ "$os" = macos ]; then security find-generic-password -a "$(id -un)" -s "$SERVICE" -w; else cat "$TOKEN_FILE"; fi; }

# --- The vault: the service account sees one vault, and the references resolve -------------------------------------
ref_of() { sed -n "s/^$1=\(op:\/\/[a-z0-9-]*\/[a-z0-9-]*\/credential\)\$/\1/p" "$REFS"; }
gh_ref="$(ref_of CROW_AGENTS_GITHUB_TOKEN)"
[ -n "$gh_ref" ] || die "config/secrets/dev-host.refs names no CROW_AGENTS_GITHUB_TOKEN"
# The one vault dev-host.refs names (scripts/secrets/refs.mjs, VAULTS); a second person's own vault is a new references file.
vault="$(printf '%s' "$gh_ref" | cut -d/ -f3)"
vaults="$(OP_SERVICE_ACCOUNT_TOKEN="$(read_token)" op vault list --format json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).map(v=>String(v.name).toLowerCase()).sort().join(",")))')"
[ "$vaults" = "$vault" ] || die "the service account sees the vaults [$vaults], not exactly [$vault]: make a service account for that one vault"
say "The service account sees one vault: $vault."

# --- gh, signed in as the agents' account from the vault ------------------------------------------------------------
if [ "$(gh api user --jq .login 2>/dev/null || true)" != "$login" ]; then
  OP_SERVICE_ACCOUNT_TOKEN="$(read_token)" op read "$gh_ref" | gh auth login --hostname github.com --with-token
fi
[ "$(gh api user --jq .login)" = "$login" ] || die "gh is signed in as another account than $login"
gh auth setup-git --hostname github.com
uid="$(gh api user --jq .id)"
git config --global user.name "$login"
git config --global user.email "${uid}+${login}@users.noreply.github.com"
say "gh: signed in as $login; git commits as $login with GitHub's no-reply address."

# --- Foundry, at the version CI pins --------------------------------------------------------------------------------
fv="$(awk '/foundry-rs\/foundry-toolchain@/ { f = 1; next } f && /version:/ { gsub(/[^v0-9.]/, "", $2); print $2; exit }' "$ROOT/.github/workflows/ci.yml")"
printf '%s' "$fv" | grep -Eq '^v[0-9]+\.[0-9]+\.[0-9]+$' || die "could not read Foundry's version from .github/workflows/ci.yml"
if ! "$HOME/.foundry/bin/forge" --version 2>/dev/null | grep -q "${fv#v}"; then
  case "$os/$(uname -m)" in
    macos/arm64) plat=darwin_arm64 ;;
    ubuntu/x86_64) plat=linux_amd64 ;;
    ubuntu/aarch64) plat=linux_arm64 ;;
    *) die "no Foundry build for this machine" ;;
  esac
  work="$(mktemp -d)"
  gh release download "$fv" --repo foundry-rs/foundry --pattern "foundry_${fv}_${plat}.tar.gz" --dir "$work"
  gh attestation verify "$work/foundry_${fv}_${plat}.tar.gz" --repo foundry-rs/foundry >/dev/null || die "Foundry's archive has no attestation that GitHub can verify; stop and tell the coordinator"
  tar -xzf "$work/foundry_${fv}_${plat}.tar.gz" -C "$HOME/.foundry/bin"
  rm -rf "$work"
fi
say "Foundry: $("$HOME/.foundry/bin/forge" --version | head -n 1)."

# --- Both repositories ----------------------------------------------------------------------------------------------
[ -d "$PROJECT/.git" ] || gh repo clone "$public_repo" "$PROJECT"
[ -d "$PROJECT/reports/crow-private/.git" ] || gh repo clone "$private_repo" "$PROJECT/reports/crow-private"
mkdir -p "$PROJECT/.worktrees" "$PROJECT/reports/scratch" "$PROJECT/.claude"
[ -f "$PROJECT/.claude/settings.local.json" ] || install -m 644 "$HERE/settings.local.json" "$PROJECT/.claude/settings.local.json"
( cd "$PROJECT" && pnpm install --frozen-lockfile )
say "Repositories: $PROJECT and $PROJECT/reports/crow-private; dependencies installed."

# --- The nightly memory push ----------------------------------------------------------------------------------------
if [ "$os" = macos ]; then
  plist="$HOME/Library/LaunchAgents/direct.crow.memory-push.plist"
  mkdir -p "$HOME/Library/LaunchAgents"
  cat > "$plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>direct.crow.memory-push</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$PROJECT/infra/dev-host/memory-push.sh</string><string>$PROJECT</string></array>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$HOME/.local/state/crow-memory/push.log</string>
  <key>StandardErrorPath</key><string>$HOME/.local/state/crow-memory/push.log</string>
</dict></plist>
PLIST
  mkdir -p "$HOME/.local/state/crow-memory"
  launchctl bootout "gui/$(id -u)/direct.crow.memory-push" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$plist"
else
  mkdir -p "$HOME/.config/systemd/user" "$HOME/.local/state/crow-memory"
  printf '[Unit]\nDescription=Crow memory push\n[Service]\nType=oneshot\nExecStart=/bin/bash %s/infra/dev-host/memory-push.sh %s\n' "$PROJECT" "$PROJECT" > "$HOME/.config/systemd/user/crow-memory-push.service"
  printf '[Unit]\nDescription=Crow memory push, nightly\n[Timer]\nOnCalendar=*-*-* 03:30\nPersistent=true\n[Install]\nWantedBy=timers.target\n' > "$HOME/.config/systemd/user/crow-memory-push.timer"
  systemctl --user daemon-reload
  systemctl --user enable --now crow-memory-push.timer
fi
say "The memory push: nightly at 03:30 local time, to the branch memory/dev-host of $private_repo."

say ""
say "setup-user: done. Next (README): sign the Claude desktop app in to the Crow account, turn on 'Keep computer awake',"
say "and add the app as a login item. Then Rafa runs the host check from the reviewed commit, before any agent"
say "session exists here (README, 'The check')."
