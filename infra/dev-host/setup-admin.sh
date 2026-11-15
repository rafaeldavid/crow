#!/bin/bash
# The Mac mini's administrator setup (T-485; decision record T-484, section 6, "The development host").
# Rafa runs it as the administrator, from a git archive of the commit he approved, copied from his own Mac into the
# administrator's home (infra/dev-host/README.md, "Set up the Mac mini"). It never runs from the session user's folder.
#
#   bash setup-admin.sh --hashes                                     the commit and the hashes only; changes nothing
#   bash setup-admin.sh --network <home|guest|own> --link <ethernet|wifi> [options]
#   bash setup-admin.sh --hand-over-token                            moves the service account's token to crow
#
# Options:
#   --session-user <name>        the Standard user for sessions (default crow)
#   --min-memory-gb <n>          refuse a Mac with less memory (default 16; the record's floor)
#   --min-macos <n>              refuse an older macOS (default 26)
#   --wifi-ssid <name>           with --link wifi: the one network the Mac mini may join (typed here, stored nowhere)
#   --authorized-key-file <f>    the public key of Rafa's own Mac; turns on Remote Login for the administrator only
#   --screen-sharing             turns on Screen Sharing for the administrator only (to log the session user in)
#
# It prints the commit and the SHA-256 of each file it runs and reads, and waits for a typed yes. Each step checks
# first and changes only what differs, so running it again is safe. It writes no secret anywhere.
set -euo pipefail

# shellcheck disable=SC2016 # git archive fills this in; the dollar signs are literal on purpose
COMMIT='$Format:%H$'
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
FILES=("$HERE/setup-admin.sh" "$HERE/managed-settings.json" "$ROOT/.nvmrc" "$ROOT/package.json" "$ROOT/.github/workflows/ci.yml")
MANAGED_DIR="/Library/Application Support/ClaudeCode"
TOKEN_STAGED="$HOME/.crow-op-token"

say() { printf '%s\n' "$*"; }
die() { printf 'setup-admin: %s\n' "$*" >&2; exit 1; }

session_user=crow
network=""
link=""
min_mem=16
min_macos=26
ssid=""
key_file=""
screen=0
mode=setup
while [ $# -gt 0 ]; do
  case "$1" in
    --hashes) mode=hashes; shift ;;
    --hand-over-token) mode=token; shift ;;
    --network) network="${2:-}"; shift 2 ;;
    --link) link="${2:-}"; shift 2 ;;
    --session-user) session_user="${2:-}"; shift 2 ;;
    --min-memory-gb) min_mem="${2:-}"; shift 2 ;;
    --min-macos) min_macos="${2:-}"; shift 2 ;;
    --wifi-ssid) ssid="${2:-}"; shift 2 ;;
    --authorized-key-file) key_file="${2:-}"; shift 2 ;;
    --screen-sharing) screen=1; shift ;;
    *) die "unknown option ${1:0:40}. Read the header of this file for the usage." ;;
  esac
done

# --- The commit and the hashes -------------------------------------------------------------------------------------
commit_of() {
  if printf '%s' "$COMMIT" | grep -Eq '^[0-9a-f]{40}$'; then
    printf '%s (git archive)' "$COMMIT"
  elif c="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null)"; then
    if [ -n "$(git -C "$ROOT" status --porcelain -- "${FILES[@]}" 2>/dev/null)" ]; then
      printf '%s (checkout, CHANGED since that commit)' "$c"
    else
      printf '%s (checkout)' "$c"
    fi
  else
    printf 'unknown'
  fi
}
attest() {
  local c f
  c="$(commit_of)"
  say "The Mac mini's administrator setup"
  say "  From commit: $c"
  say "  Files it runs and reads, SHA-256:"
  for f in "${FILES[@]}"; do
    [ -f "$f" ] || die "missing $f: copy the whole archive"
    say "    $(shasum -a 256 "$f" | cut -d' ' -f1)  ${f#"$ROOT"/}"
  done
  [ "$mode" = hashes ] && exit 0
  [ "$c" = unknown ] && die "the commit is unknown: run it from a git archive of the reviewed commit"
  [ -t 0 ] || die "standard input is not a terminal: run it in Terminal, as the administrator"
  local answer
  read -r -p "Type yes to run these files as the administrator: " answer
  [ "$answer" = yes ] || die "stopped: the answer was not yes"
}

# --- Preconditions -------------------------------------------------------------------------------------------------
[ "$(uname -s)" = Darwin ] || die "this script is for macOS; a Linux host follows infra/dev-host/README.md, 'Ubuntu instead'"
if [ "$mode" != hashes ]; then
  [ "$(id -u)" != 0 ] || die "run it as the administrator, not as root: it asks for sudo itself"
  id -Gn | tr ' ' '\n' | grep -qx admin || die "run it as the administrator (a member of the admin group)"
  [ "$(id -un)" != "$session_user" ] || die "run it as the administrator, not as $session_user"
fi

attest
ADMIN="$(id -un)"

if [ "$mode" = token ]; then
  # The token was piped from Rafa's own Mac into the administrator's home (README, "Hand over the token").
  [ -f "$TOKEN_STAGED" ] || die "no token at ~/.crow-op-token: pipe it from your own Mac first (README, 'Hand over the token')"
  [ "$(wc -l < "$TOKEN_STAGED" | tr -d ' ')" -le 1 ] || die "the staged file has more than one line; remove it and pipe the token again"
  head -c 4 "$TOKEN_STAGED" | grep -qx 'ops_' || die "the staged file does not start like a 1Password service account token; remove it and pipe it again"
  id "$session_user" >/dev/null 2>&1 || die "no user $session_user yet: run the setup first"
  sudo install -d -o "$session_user" -g staff -m 700 "/Users/$session_user/.config" "/Users/$session_user/.config/crow"
  sudo install -o "$session_user" -g staff -m 600 "$TOKEN_STAGED" "/Users/$session_user/.config/crow/op-token.incoming"
  rm -P "$TOKEN_STAGED"
  say "setup-admin: the token is in $session_user's folder for setup-user.sh, which moves it into $session_user's Keychain and removes the file."
  exit 0
fi

case "$network" in home|guest|own) ;; *) die "--network home, guest or own is required (record, question 5)" ;; esac
case "$link" in ethernet|wifi) ;; *) die "--link ethernet or wifi is required" ;; esac
[ "$link" = wifi ] && [ -z "$ssid" ] && die "--link wifi needs --wifi-ssid <the one network it may join>"
case "$min_mem$min_macos" in *[!0-9]*) die "--min-memory-gb and --min-macos take whole numbers" ;; esac

arch="$(uname -m)"
mem_gb=$(( $(sysctl -n hw.memsize) / 1073741824 ))
model="$(sysctl -n hw.model)"
macos="$(sw_vers -productVersion)"
say "This Mac: $model, $arch, ${mem_gb} GB, macOS $macos."
[ "$arch" = arm64 ] || die "an Intel Mac is not the development host the record assumes (section 4, 'What would change it')"
[ "$mem_gb" -ge "$min_mem" ] || die "${mem_gb} GB is under the ${min_mem} GB floor (--min-memory-gb)"
[ "${macos%%.*}" -ge "$min_macos" ] || die "macOS $macos is older than $min_macos (--min-macos)"

sudo -v
# Keep sudo's approval alive while the script runs; it stops when the script ends.
while true; do sudo -n true; sleep 50; kill -0 "$$" 2>/dev/null || exit; done 2>/dev/null &

# --- Versions, from the repository's own pins ----------------------------------------------------------------------
node_major="$(tr -d ' \nv' < "$ROOT/.nvmrc" | cut -d. -f1)"
java_major="$(sed -n "s/.*java-version: *'\{0,1\}\([0-9][0-9]*\)'\{0,1\}.*/\1/p" "$ROOT/.github/workflows/ci.yml" | head -n 1)"
case "$node_major" in ''|*[!0-9]*) die "could not read the Node major version from .nvmrc" ;; esac
case "$java_major" in ''|*[!0-9]*) die "could not read the Java version from .github/workflows/ci.yml" ;; esac
say "Versions from the repository: Node $node_major (.nvmrc), Java $java_major (ci.yml)."

# --- Apple's command-line tools and Homebrew -----------------------------------------------------------------------
if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install || true
  die "Apple's command-line tools are installing in a window: finish that, then run this script again"
fi
BREW=/opt/homebrew/bin/brew
if [ ! -x "$BREW" ]; then
  work="$(mktemp -d)"
  curl -fsSL --proto '=https' -o "$work/release.json" https://api.github.com/repos/Homebrew/brew/releases/latest
  url="$(plutil -extract assets.0.browser_download_url raw "$work/release.json" 2>/dev/null || true)"
  case "$url" in https://github.com/Homebrew/brew/releases/download/*.pkg) ;; *) die "could not find Homebrew's installer package in its latest release" ;; esac
  curl -fsSL --proto '=https' -o "$work/Homebrew.pkg" "$url"
  say "Homebrew's installer: ${url##*/}. Its signature:"
  pkgutil --check-signature "$work/Homebrew.pkg" | sed 's/^/    /'
  pkgutil --check-signature "$work/Homebrew.pkg" | grep -q 'Developer ID Installer' || die "the package is not signed with a Developer ID"
  read -r -p "Type yes if the signature above names Homebrew's maintainer: " answer
  [ "$answer" = yes ] || die "stopped before installing Homebrew"
  sudo installer -pkg "$work/Homebrew.pkg" -target /
  rm -rf "$work"
fi
[ -x "$BREW" ] || die "Homebrew is not at /opt/homebrew"
# The administrator owns Homebrew's folder, so the session user cannot change a program the administrator runs.
if [ "$(stat -f %Su /opt/homebrew)" != "$ADMIN" ]; then sudo chown -R "$ADMIN" /opt/homebrew; fi
sudo chmod -R go-w /opt/homebrew
eval "$("$BREW" shellenv)"

brew update --quiet
for f in "node@$node_major" gh gitleaks doctl; do brew list --formula "$f" >/dev/null 2>&1 || brew install --quiet "$f"; done
brew link --overwrite --force "node@$node_major" >/dev/null
for c in 1password-cli "temurin@$java_major" claude; do brew list --cask "$c" >/dev/null 2>&1 || brew install --quiet --cask "$c"; done
node -e '
  const want = require(process.argv[1]).engines.node.replace(/^>=\s*/, "").split(".").map(Number);
  const have = process.versions.node.split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((have[i] ?? 0) > (want[i] ?? 0)) process.exit(0); if ((have[i] ?? 0) < (want[i] ?? 0)) process.exit(1); }
' "$ROOT/package.json" || die "Node $(node --version) is older than package.json's engines field"
say "Installed: Node $(node --version), gh, gitleaks, doctl, op, Java $java_major, the Claude desktop app."

# --- The managed settings: root-owned, read by every session, deny rules in every mode ------------------------------
sudo install -d -o root -g wheel -m 755 "$MANAGED_DIR"
sudo install -o root -g wheel -m 644 "$HERE/managed-settings.json" "$MANAGED_DIR/managed-settings.json"
[ "$(shasum -a 256 < "$MANAGED_DIR/managed-settings.json")" = "$(shasum -a 256 < "$HERE/managed-settings.json")" ] || die "the installed managed settings differ from the reviewed file"
say "Managed settings: $MANAGED_DIR/managed-settings.json, root-owned."

# --- The administrator's home: no other user may list or read it ----------------------------------------------------
chmod 700 "$HOME"

# --- Power: never sleep, restart after a power failure ---------------------------------------------------------------
sudo pmset -a sleep 0 disksleep 0 displaysleep 15 powernap 0 autorestart 1 womp 1
sudo systemsetup -setrestartfreeze on >/dev/null 2>&1 || say "Note: 'restart after a freeze' needs Full Disk Access for Terminal; set it in System Settings if you want it."

# --- FileVault -----------------------------------------------------------------------------------------------------
if ! fdesetup status | grep -q 'FileVault is On'; then
  say "FileVault: turning it on. It prints a recovery key: save it in your vault Crow, then clear this window."
  sudo fdesetup enable -user "$ADMIN"
fi

# --- The macOS firewall --------------------------------------------------------------------------------------------
FW=/usr/libexec/ApplicationFirewall/socketfilterfw
sudo "$FW" --setglobalstate on >/dev/null
sudo "$FW" --setstealthmode on >/dev/null

# --- The session user: a Standard user, never an administrator -----------------------------------------------------
if ! id "$session_user" >/dev/null 2>&1; then
  say "Creating the Standard user $session_user. Type the password you generated for it in your vault Crow (not the administrator's)."
  sudo sysadminctl -addUser "$session_user" -fullName "Crow sessions" -shell /bin/zsh -home "/Users/$session_user" -password -
  sudo createhomedir -c -u "$session_user" >/dev/null
fi
if dseditgroup -o checkmember -m "$session_user" admin >/dev/null 2>&1; then die "$session_user is an administrator: make it a Standard user in System Settings, then run this again"; fi

# --- Remote Login and Screen Sharing: the administrator only --------------------------------------------------------
ensure_access_group() { # <group> : the access group exists, holds the administrator, and not the session user
  sudo dseditgroup -o read "$1" >/dev/null 2>&1 || sudo dseditgroup -o create -q "$1"
  sudo dseditgroup -o edit -a "$ADMIN" -t user "$1"
  sudo dseditgroup -o edit -d "$session_user" -t user "$1" >/dev/null 2>&1 || true
}
if [ -n "$key_file" ]; then
  grep -Eq '^(ssh-ed25519|ecdsa-sha2-nistp256|sk-ssh-ed25519@openssh.com|sk-ecdsa-sha2-nistp256@openssh.com) ' "$key_file" || die "$key_file is not one OpenSSH public key line"
  install -d -m 700 "$HOME/.ssh"
  touch "$HOME/.ssh/authorized_keys"; chmod 600 "$HOME/.ssh/authorized_keys"
  grep -qxF "$(head -n 1 "$key_file")" "$HOME/.ssh/authorized_keys" || head -n 1 "$key_file" >> "$HOME/.ssh/authorized_keys"
  ensure_access_group com.apple.access_ssh
  conf="$(mktemp)"
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin no\nAllowUsers %s\n' "$ADMIN" > "$conf"
  sudo install -o root -g wheel -m 644 "$conf" /etc/ssh/sshd_config.d/100-crow-dev-host.conf
  rm -f "$conf"
  sudo systemsetup -setremotelogin on >/dev/null 2>&1 || { sudo launchctl enable system/com.openssh.sshd; sudo launchctl bootstrap system /System/Library/LaunchDaemons/ssh.plist 2>/dev/null || true; }
  say "Remote Login: on, for $ADMIN only, with your key only."
else
  say "Remote Login: left as it is (no --authorized-key-file). The token hand-over and SSH unlock need it."
fi
if [ "$screen" = 1 ]; then
  ensure_access_group com.apple.access_screensharing
  sudo launchctl enable system/com.apple.screensharing
  sudo launchctl bootstrap system /System/Library/LaunchDaemons/com.apple.screensharing.plist 2>/dev/null || true
  say "Screen Sharing: on, for $ADMIN only."
fi

# --- Wi-Fi: off, or one network, and only an administrator may change it --------------------------------------------
wifi="$(networksetup -listallhardwareports | awk '/Hardware Port: (Wi-Fi|AirPort)/ { getline; print $2; exit }')"
if [ -n "$wifi" ]; then
  if [ -x /usr/libexec/airportd ]; then
    sudo /usr/libexec/airportd prefs RequireAdminNetworkChange=YES RequireAdminPowerToggle=YES RequireAdminIBSS=YES >/dev/null
  else
    say "Note: /usr/libexec/airportd is missing on this macOS; the check shows whether a Standard user can change Wi-Fi."
  fi
  if [ "$link" = ethernet ]; then
    sudo networksetup -setairportpower "$wifi" off
    say "Wi-Fi ($wifi): off; turning it on needs an administrator."
  else
    sudo networksetup -setairportpower "$wifi" on
    networksetup -listpreferredwirelessnetworks "$wifi" | tail -n +2 | sed 's/^[[:space:]]*//' | while IFS= read -r n; do
      [ "$n" = "$ssid" ] || sudo networksetup -removepreferredwirelessnetwork "$wifi" "$n" >/dev/null
    done
    say "Wi-Fi ($wifi): on; every remembered network but the one you named is removed. Join it in System Settings if it is not joined."
  fi
fi

# --- The files the session user's setup needs ----------------------------------------------------------------------
dest="/Users/$session_user/crow-setup"
sudo rm -rf "$dest"
for p in infra .nvmrc package.json .github/workflows/ci.yml config/secrets/dev-host.refs scripts/secrets/refs.mjs; do
  [ -e "$ROOT/$p" ] || die "missing $p in the archive"
  sudo install -d "$dest/$(dirname "$p")"
  sudo ditto "$ROOT/$p" "$dest/$p"
done
sudo chown -R "$session_user":staff "$dest"

say ""
say "setup-admin: done. Network: $network, link: $link."
say "Next (README, 'Set up the Mac mini'): log out, log in as $session_user at the Mac mini's screen, and run"
say "  bash ~/crow-setup/infra/dev-host/setup-user.sh --agents-login <the agents' GitHub login>"
