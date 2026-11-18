#!/usr/bin/env bash
# Runs on a simulated party's machine, as root, sent over SSH by up.mjs:
#   ssh party@<machine> sudo bash -s -- --node-major <major> [--publish] < infra/party/provision.sh
# It installs Node at the major version the repository pins (.nvmrc, read by up.mjs), npm with it, the assistant's
# command-line tool, and Caddy for a seller that publishes. It writes nothing into the party user's home.
set -euo pipefail

major=""
publish=0
while [ $# -gt 0 ]; do
  case "$1" in
    --node-major) major="${2:-}"; shift 2 ;;
    --publish) publish=1; shift ;;
    *) echo "provision: unknown option" >&2; exit 2 ;;
  esac
done
case "$major" in ''|*[!0-9]*) echo "provision: --node-major takes a number" >&2; exit 2 ;; esac
[ "$(id -u)" = 0 ] || { echo "provision: run as root (sudo)" >&2; exit 2; }
# npm's cache and any tool's state go to root's home, never the party user's.
export HOME=/root
cd /root

arch="$(uname -m)"
case "$arch" in
  x86_64) narch=x64 ;;
  aarch64) narch=arm64 ;;
  *) echo "provision: no Node build for $arch" >&2; exit 2 ;;
esac

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
base="https://nodejs.org/dist/latest-v${major}.x"
curl -fsSL --proto '=https' --tlsv1.2 -o "$work/SHASUMS256.txt" "$base/SHASUMS256.txt"
file="$(grep -Eo "node-v${major}\.[0-9]+\.[0-9]+-linux-${narch}\.tar\.xz" "$work/SHASUMS256.txt" | head -n 1)"
[ -n "$file" ] || { echo "provision: no linux-${narch} tarball listed for Node ${major}" >&2; exit 1; }
curl -fsSL --proto '=https' --tlsv1.2 -o "$work/$file" "$base/$file"
(cd "$work" && grep " ${file}\$" SHASUMS256.txt | sha256sum -c --status) || { echo "provision: the Node tarball does not match its SHA-256" >&2; exit 1; }
tar -xJf "$work/$file" -C /usr/local --strip-components=1 --exclude='*/CHANGELOG.md' --exclude='*/README.md' --exclude='*/LICENSE'
node --version

npm install --global --no-fund --no-audit @anthropic-ai/claude-code >/dev/null
command -v claude >/dev/null || { echo "provision: the assistant's command-line tool did not install" >&2; exit 1; }

if [ "$publish" = 1 ]; then
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q caddy >/dev/null
  systemctl enable caddy >/dev/null
fi
echo "provision: done"
