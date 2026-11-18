#!/usr/bin/env bash
# The on-machine half of the party's check (infra/party/check.mjs), sent over SSH and run as the party user:
#   ssh party@<machine> bash -s -- <node-major> < infra/party/probe.sh
# Each line is "ok <check>", "fail <check>" or "echo <address>". It prints names, never a file's content.
set -u
major="${1:-}"
say() { printf '%s %s\n' "$1" "$2"; }

# The home holds the skeleton files and the SSH key only.
extra=0
for f in "$HOME"/.[!.]* "$HOME"/..?* "$HOME"/*; do
  [ -e "$f" ] || continue
  case "${f##*/}" in
    .bashrc|.profile|.bash_logout|.ssh|.sudo_as_admin_successful|.cache) ;;
    *) extra=1 ;;
  esac
done
for f in "$HOME"/.ssh/*; do
  [ -e "$f" ] || continue
  case "${f##*/}" in authorized_keys) ;; *) extra=1 ;; esac
done
if [ -d "$HOME/.cache" ] && [ -n "$(find "$HOME/.cache" -mindepth 1 ! -name motd.legal-displayed -print -quit 2>/dev/null)" ]; then extra=1; fi
if [ "$extra" = 0 ]; then say ok home-empty; else say fail home-empty; fi

# No path holds a file of the project: by name in the places a user or a tool writes, and by content for a
# reference, a token or the project's domain. The cloud-init copy under /var/lib/cloud is the reviewed public file.
places=(/home /root /etc /opt /srv /tmp /var/tmp /usr/local/bin /usr/local/etc /mnt)
hits="$(sudo -n find "${places[@]}" -xdev \( -iname '*holdback*' -o -iname '*crow*' -o -name '.env' -o -name '.env.*' -o -name '*.refs' -o -iname 'keystore*' -o -name 'UTC--*' \) -print 2>/dev/null | head -n 5)"
if [ -z "$hits" ]; then say ok no-project-file-by-name; else say fail no-project-file-by-name; fi
hits="$(sudo -n grep -rIlE 'op://|dop_v1_|ops_ey|crow\.direct|holdback' "${places[@]}" 2>/dev/null | head -n 5)"
if [ -z "$hits" ]; then say ok no-project-file-by-content; else say fail no-project-file-by-content; fi

# No cloud token in the environment, and none in the file the metadata service hands out.
if env | grep -q -E '^(DIGITALOCEAN|DO_)'; then say fail no-cloud-token-in-environment; else say ok no-cloud-token-in-environment; fi
ud="$(curl -fsS --max-time 5 http://169.254.169.254/metadata/v1/user-data 2>/dev/null || true)"
if printf '%s' "$ud" | grep -q -E 'dop_v1_|sk-ant-|ops_ey|op://|PRIVATE KEY'; then say fail user-data-holds-no-secret; else say ok user-data-holds-no-secret; fi

# Logins: password and root logins are off.
cfg="$(sudo -n sshd -T 2>/dev/null)"
if printf '%s\n' "$cfg" | grep -qx 'passwordauthentication no' && printf '%s\n' "$cfg" | grep -qx 'kbdinteractiveauthentication no' && printf '%s\n' "$cfg" | grep -qx 'permitrootlogin no'; then
  say ok password-and-root-login-off
else
  say fail password-and-root-login-off
fi

# Security updates install themselves.
if systemctl is-enabled --quiet unattended-upgrades 2>/dev/null && apt-config dump 2>/dev/null | grep -q 'APT::Periodic::Unattended-Upgrade "1"'; then
  say ok security-updates-on
else
  say fail security-updates-on
fi

# The tools the party runs.
nv="$(node --version 2>/dev/null || true)"
case "$nv" in "v${major}."*) say ok node-at-pinned-major ;; *) say fail node-at-pinned-major ;; esac
if command -v claude >/dev/null 2>&1; then say ok assistant-tool-installed; else say fail assistant-tool-installed; fi

# The outbound address, as an address-echo service sees it. check.mjs compares it with the cloud's records.
addr="$(curl -4 -fsS --max-time 10 https://icanhazip.com 2>/dev/null | tr -d '[:space:]')"
case "$addr" in
  *[!0-9.]*|'') say echo none ;;
  *) say echo "$addr" ;;
esac
