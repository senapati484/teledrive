import os
import subprocess

REPO_ROOT = os.environ.get(
    "REPO_ROOT",
    os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if "__file__" in globals()
    else os.getcwd(),
)
ICONS_DIR = os.path.join(REPO_ROOT, "src-tauri", "icons")

volume_name = "TeleDrive"
format = "UDZO"
compression_level = 9
filesystem = "HFS+"

# Window configuration: ((x, y), (width, height))
window_rect = ((200, 120), (660, 400))
default_view = "icon-view"
show_toolbar = False
show_statusbar = False
show_pathbar = False
show_sidebar = False
show_tab_view = False

# Background configuration (dmgbuild auto-compiles with @2x.png into multi-res TIFF)
background = os.path.join(ICONS_DIR, "dmg-background.png")

# Content: dynamically pulled from TELEDRIVE_APP_PATH or fallback
app_path = os.environ.get("TELEDRIVE_APP_PATH", "/tmp/teledrive_dmg_staging/TeleDrive.app")
files = [app_path]
symlinks = {"Applications": "/Applications"}

# Icon size and positions
icon_size = 72.0
text_size = 12.0
icon_locations = {
    "TeleDrive.app": (165, 215),
    "Applications": (482, 215),
}

# Volume Icon
icon = os.path.join(ICONS_DIR, "icon.icns")
hide = [".VolumeIcon.icns"]


def create_hook(mount_point, options):
    vol = os.path.basename(mount_point)
    bg_tiff = os.path.join(mount_point, ".background.tiff")
    bg_png = os.path.join(mount_point, ".background.png")
    target_bg = bg_tiff if os.path.exists(bg_tiff) else bg_png

    # Hide any dotfiles explicitly
    for item in [
        ".VolumeIcon.icns",
        ".background.tiff",
        ".background.png",
        ".background",
        ".fseventsd",
    ]:
        target = os.path.join(mount_point, item)
        if os.path.exists(target):
            subprocess.call(["chflags", "hidden", target])
            subprocess.call(["/usr/bin/SetFile", "-a", "V", target])

    # If GUI session is available, script Finder to write modern pBBk bookmark
    script = f"""
    tell application "Finder"
        try
            tell disk "{vol}"
                open
                set theViewOptions to the icon view options of container window
                if exists file "{target_bg}" then
                    set background picture of theViewOptions to (POSIX file "{target_bg}")
                end if
                set position of item "TeleDrive.app" of container window to {{165, 215}}
                set position of item "Applications" of container window to {{482, 215}}
                update without registering applications
                delay 1
                close container window
            end tell
        end try
    end tell
    """
    try:
        subprocess.call(["osascript", "-e", script])
    except Exception:
        pass
