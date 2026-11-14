#!/usr/bin/env bash
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive

INCLUDE_BUNDLE_TOOLS=false
if [ "${1:-}" = "--bundle-tools" ]; then
  INCLUDE_BUNDLE_TOOLS=true
fi

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
  -o "Acquire::http::Timeout=30"
  -o "Acquire::https::Timeout=30"
  -o "Acquire::ftp::Timeout=30"
  -o "Acquire::Retries=3"
  -o "Dpkg::Options::=--force-confdef"
  -o "Dpkg::Options::=--force-confold"
)

APT_UPDATE_OPTS=(
  "${APT_OPTS[@]}"
  -o "APT::Update::Error-Mode=any"
)

CODENAME="jammy"
if [ -r /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  CODENAME="${VERSION_CODENAME:-${UBUNTU_CODENAME:-jammy}}"
fi

# Ensure dpkg state is completely clean before starting
sudo dpkg --configure -a || true

# Attempt 1: Try default runner repositories first (fastest, Azure-internal Gigabit link)
echo "Attempting to install Linux dependencies via default runner repositories..."
if timeout 600 sudo apt-get "${APT_UPDATE_OPTS[@]}" update && \
   timeout 600 sudo apt-get "${APT_OPTS[@]}" install -y --no-install-recommends "${PACKAGES[@]}"; then
  echo "Linux dependencies installed cleanly via default runner repositories."
  exit 0
fi

echo "Default repository install failed or incomplete; repairing dpkg and falling back to alternative mirrors..."
sudo dpkg --configure -a || true
sudo apt-get install -f -y || true
sudo apt-get clean || true

rewrite_apt_mirrors() {
  local target_mirror="$1"
  local include_security="${2:-false}"

  if [ -f /etc/apt/apt-mirrors.txt ]; then
    echo "${target_mirror}" | sudo tee /etc/apt/apt-mirrors.txt >/dev/null
  fi

  local host_pattern="https?://(azure\.archive|us\.archive|[a-z]{2}\.archive|archive)\.ubuntu\.com/ubuntu"
  if [ "$include_security" = "true" ]; then
    host_pattern="https?://(azure\.archive|us\.archive|[a-z]{2}\.archive|archive|security)\.ubuntu\.com/ubuntu"
  fi

  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.list /etc/apt/sources.list.d/*.sources; do
    [ -f "$f" ] || continue
    # Replace mirror+file references in DEB822 files too when overriding mirrors cleanly.
    sudo sed -E -i \
      -e "s|mirror\+file:/etc/apt/apt-mirrors\.txt|${target_mirror}|g" \
      -e "s|${host_pattern}|${target_mirror}|g" \
      "$f" 2>/dev/null || true
  done
}

CANDIDATE_MIRRORS=(
  "http://azure.archive.ubuntu.com/ubuntu"
  "http://us.archive.ubuntu.com/ubuntu"
  "http://archive.ubuntu.com/ubuntu"
  "http://mirrors.kernel.org/ubuntu"
  "http://mirror.math.princeton.edu/pub/ubuntu"
)

WORKING_MIRRORS=()
echo "Probing Ubuntu mirrors for ${CODENAME}..."
for mirror in "${CANDIDATE_MIRRORS[@]}"; do
  if curl -4 -fsSIL --max-time 4 "${mirror}/dists/${CODENAME}/Release" >/dev/null 2>&1; then
    echo "  + reachable: ${mirror}"
    WORKING_MIRRORS+=("$mirror")
  else
    echo "  - unreachable/slow: ${mirror}"
  fi
done

if [ ${#WORKING_MIRRORS[@]} -eq 0 ]; then
  WORKING_MIRRORS=("${CANDIDATE_MIRRORS[@]}")
fi

attempt=0
for mirror in "${WORKING_MIRRORS[@]}"; do
  attempt=$((attempt + 1))
  echo "Installing Linux dependencies (attempt ${attempt}/${#WORKING_MIRRORS[@]} via ${mirror})..."
  sudo dpkg --configure -a || true
  rewrite_apt_mirrors "$mirror" "true"
  if timeout 600 sudo apt-get "${APT_UPDATE_OPTS[@]}" update && \
     timeout 600 sudo apt-get "${APT_OPTS[@]}" install -y --no-install-recommends "${PACKAGES[@]}"; then
    echo "Linux dependencies installed cleanly via ${mirror}."
    exit 0
  fi
  echo "Attempt ${attempt} via ${mirror} failed; repairing dpkg and cleaning partial apt state..."
  sudo dpkg --configure -a || true
  sudo apt-get install -f -y || true
  sudo apt-get clean || true
  sleep 2
done

echo "::error::Failed to install Linux dependencies across all candidate mirrors."
exit 1
