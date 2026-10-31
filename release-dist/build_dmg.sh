#!/bin/bash
set -e

# ==============================================================================
# TeleDrive macOS DMG Generator
# Produces a clean, production-ready, Universal (Apple Silicon + Intel) DMG
# ==============================================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_VERSION=$(node -p "require('$PROJECT_DIR/package.json').version" 2>/dev/null || echo "0.1.3")
SRC_APP="$PROJECT_DIR/src-tauri/target/release/bundle/macos/TeleDrive.app"
DIST_DIR="$PROJECT_DIR/release-dist"
DIST_VER_DIR="$PROJECT_DIR/distribution/v$APP_VERSION"
OUTPUT_DMG="$DIST_VER_DIR/teledrive.dmg"
BUNDLE_DMG="$PROJECT_DIR/src-tauri/target/release/bundle/dmg/teledrive.dmg"
ICON_ICNS="$PROJECT_DIR/src-tauri/icons/icon.icns"
STAGE_DIR="/tmp/teledrive_dmg_staging_$$"

echo "=== [1/6] Cleaning up previous artifacts ==="
rm -rf "$STAGE_DIR"
mkdir -p "$STAGE_DIR"
mkdir -p "$DIST_VER_DIR"
mkdir -p "$(dirname "$BUNDLE_DMG")"

# Prefer freshly compiled app from target/release/bundle/macos
if [ -d "$SRC_APP" ]; then
    echo "=== [2/6] Copying freshly built TeleDrive.app from $SRC_APP ==="
    cp -R "$SRC_APP" "$STAGE_DIR/TeleDrive.app"
elif [ -f "$DIST_DIR/TeleDrive_universal.app.tar.gz" ]; then
    echo "=== [2/6] Extracting TeleDrive.app from universal tarball ==="
    tar -xzf "$DIST_DIR/TeleDrive_universal.app.tar.gz" -C "$STAGE_DIR/"
else
    echo "ERROR: Neither $SRC_APP nor tarball found."
    exit 1
fi

echo "=== [3/6] Setting permissions & stripping quarantine ==="
chmod -R u+w "$STAGE_DIR/TeleDrive.app"
chmod 755 "$STAGE_DIR/TeleDrive.app/Contents/MacOS/TeleDrive"
xattr -cr "$STAGE_DIR/TeleDrive.app" 2>/dev/null || true

echo "=== [4/6] Re-signing TeleDrive.app with clean ad-hoc signature ==="
codesign --force --deep --sign - "$STAGE_DIR/TeleDrive.app"
codesign --verify --deep --verbose "$STAGE_DIR/TeleDrive.app"

echo "=== [5/6] Adding installer helper files & Applications symlink ==="
ln -s /Applications "$STAGE_DIR/Applications"
cp "$DIST_DIR/Install TeleDrive.command" "$STAGE_DIR/Install TeleDrive.command"
chmod +x "$STAGE_DIR/Install TeleDrive.command"
cp "$DIST_DIR/How to Install.html" "$STAGE_DIR/How to Install.html"
cp "$DIST_DIR/README.txt" "$STAGE_DIR/README.txt"

if [ -f "$ICON_ICNS" ]; then
    cp "$ICON_ICNS" "$STAGE_DIR/.VolumeIcon.icns"
    if command -v SetFile >/dev/null 2>&1; then
        SetFile -a C "$STAGE_DIR" 2>/dev/null || true
    fi
fi

# Clean up unwanted DS_Store or dotfiles
find "$STAGE_DIR" -name ".DS_Store" -delete 2>/dev/null || true

echo "=== [6/6] Creating compressed UDZO disk image (teledrive.dmg) ==="
hdiutil create -volname "TeleDrive" \
               -srcfolder "$STAGE_DIR" \
               -ov \
               -format UDZO \
               "$OUTPUT_DMG"

cp "$OUTPUT_DMG" "$BUNDLE_DMG" 2>/dev/null || true

# If /Applications/TeleDrive.app exists, update it with the freshly signed app
if [ -d "/Applications/TeleDrive.app" ]; then
    echo "=== Updating /Applications/TeleDrive.app with latest build ==="
    rm -rf "/Applications/TeleDrive.app"
    cp -R "$STAGE_DIR/TeleDrive.app" "/Applications/TeleDrive.app"
    xattr -cr "/Applications/TeleDrive.app" 2>/dev/null || true
fi

# Clean up staging
rm -rf "$STAGE_DIR"

echo "=============================================================================="
echo "✅ Build complete!"
echo "📦 Output DMG: $OUTPUT_DMG"
echo "📦 Size: $(ls -lh "$OUTPUT_DMG" | awk '{print $5}')"
echo "=============================================================================="
