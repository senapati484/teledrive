#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

INCLUDE_BUNDLE_TOOLS=false
if [ "${1:-}" = "--bundle-tools" ]; then
  INCLUDE_BUNDLE_TOOLS=true
fi

# Switch away from degraded Azure Ubuntu mirrors that frequently stall apt downloads on GitHub runners.
rewrite_apt_mirrors() {
  local target_mirror="$1"
  local pattern="http://azure\.archive\.ubuntu\.com/ubuntu|http://[a-z]+\.archive\.ubuntu\.com/ubuntu|http://archive\.ubuntu\.com/ubuntu"
  sudo sed -E -i "s|${pattern}|${target_mirror}|g" /etc/apt/sources.list 2>/dev/null || true
  for f in /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
    [ -f "$f" ] || continue
    sudo sed -E -i "s|${pattern}|${target_mirror}|g" "$f" 2>/dev/null || true
  done
}

PACKAGES=(
  libwebkit2gtk-4.1-dev
  build-essential
  curl
  file
  libxdo-dev
  libssl-dev
  libayatana-appindicator3-dev
  librsvg2-dev
)

if [ "$INCLUDE_BUNDLE_TOOLS" = "true" ]; then
  PACKAGES+=(wget libfuse2 rpm)
fi

APT_OPTS=(
  -o "Acquire::ForceIPv4=true"
  -o "Acquire::http::Timeout=15"
  -o "Acquire::ftp::Timeout=15"
  -o "Acquire::Retries=3"
  -o "Dpkg::Options::=--force-confdef"
  -o "Dpkg::Options::=--force-confold"
)

MIRRORS=(
  "http://archive.ubuntu.com/ubuntu"
  "http://us.archive.ubuntu.com/ubuntu"
  "http://mirrors.kernel.org/ubuntu"
)

for attempt in 1 2 3; do
  mirror="${MIRRORS[$((attempt - 1))]}"
  echo "Installing Linux dependencies (attempt ${attempt}/3 via ${mirror})..."
  rewrite_apt_mirrors "$mirror"
  if sudo apt-get "${APT_OPTS[@]}" update && \
     sudo apt-get "${APT_OPTS[@]}" install -y --no-install-recommends "${PACKAGES[@]}"; then
    echo "Linux dependencies installed cleanly."
    exit 0
  fi
  sleep 5
done

echo "::error::Failed to install Linux dependencies after 3 attempts."
exit 1

