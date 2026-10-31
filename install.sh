#!/bin/bash
# ==============================================================================
# TeleDrive - Universal 1-Line Installer for macOS & Linux
# https://github.com/senapati484/teledrive
# ==============================================================================

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo ""
echo -e "${CYAN}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║                    TeleDrive Installer                        ║${NC}"
echo -e "${CYAN}║        Fast, unlimited cloud storage powered by Telegram      ║${NC}"
echo -e "${CYAN}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""

OS="$(uname -s)"
ARCH="$(uname -m)"

VERSION="0.1.2"
LATEST_RELEASE="https://github.com/senapati484/teledrive/releases/latest/download"
SF_DOWNLOAD="https://downloads.sourceforge.net/project/teledrive/v${VERSION}"

if [ "$OS" = "Darwin" ]; then
    echo -e "${BLUE}▶ Detected macOS ($ARCH)${NC}"
    echo -e "  Downloading latest TeleDrive Universal DMG..."

    TMP_DIR="$(mktemp -d)"
    DMG_PATH="$TMP_DIR/teledrive.dmg"
    MOUNT_DIR="$TMP_DIR/mount"

    # Download DMG (try GitHub releases first, fallback to SourceForge)
    if ! curl -fsSL "$LATEST_RELEASE/TeleDrive_${VERSION}_universal.dmg" -o "$DMG_PATH" 2>/dev/null; then
        echo -e "  Fetching from primary mirror..."
        curl -fsSL "$SF_DOWNLOAD/teledrive.dmg" -o "$DMG_PATH"
    fi

    echo -e "  Mounting disk image..."
    mkdir -p "$MOUNT_DIR"
    hdiutil attach "$DMG_PATH" -mountpoint "$MOUNT_DIR" -nobrowse -quiet

    echo -e "  Installing TeleDrive to /Applications..."
    if [ -d "/Applications/TeleDrive.app" ]; then
        rm -rf "/Applications/TeleDrive.app"
    fi
    cp -R "$MOUNT_DIR/TeleDrive.app" /Applications/TeleDrive.app

    echo -e "  Configuring macOS Gatekeeper authorization..."
    xattr -cr /Applications/TeleDrive.app 2>/dev/null || true
    codesign --force --deep --sign - /Applications/TeleDrive.app 2>/dev/null || true

    echo -e "  Cleaning up..."
    hdiutil detach "$MOUNT_DIR" -quiet 2>/dev/null || true
    rm -rf "$TMP_DIR"

    echo ""
    echo -e "${GREEN}✔ TeleDrive successfully installed to /Applications/TeleDrive.app${NC}"
    echo -e "${GREEN}✔ Gatekeeper quarantine bypassed — ready to launch!${NC}"
    echo ""
    
    # Prompt to launch
    read -p "Launch TeleDrive now? [Y/n]: " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]] || [[ -z $REPLY ]]; then
        open /Applications/TeleDrive.app
    fi

elif [ "$OS" = "Linux" ]; then
    echo -e "${BLUE}▶ Detected Linux ($ARCH)${NC}"
    INSTALL_DIR="$HOME/.local/bin"
    mkdir -p "$INSTALL_DIR"
    APPIMAGE_PATH="$INSTALL_DIR/teledrive.AppImage"

    echo -e "  Downloading latest TeleDrive AppImage..."
    if ! curl -fsSL "$LATEST_RELEASE/TeleDrive_${VERSION}_amd64.AppImage" -o "$APPIMAGE_PATH" 2>/dev/null; then
        curl -fsSL "$SF_DOWNLOAD/teledrive.AppImage" -o "$APPIMAGE_PATH"
    fi

    chmod +x "$APPIMAGE_PATH"

    echo ""
    echo -e "${GREEN}✔ TeleDrive AppImage installed to $APPIMAGE_PATH${NC}"
    echo -e "  You can run it directly: $APPIMAGE_PATH"
    echo ""

else
    echo -e "${RED}Unsupported operating system: $OS${NC}"
    echo "Please download the Windows installer (.exe) directly from https://sourceforge.net/projects/teledrive/"
    exit 1
fi
