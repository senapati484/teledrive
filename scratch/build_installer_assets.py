#!/usr/bin/env python3
"""
build_installer_assets.py
-------------------------
Replaces the distorted/incorrect AI logo in the user's installer artwork with
the authentic, official TeleDrive logo from public/teledrive.png, and exports
all required installer window formats for both macOS (DMG) and Windows (NSIS).

Deliverables:
  macOS DMG:
    - src-tauri/icons/dmg-background@2x.png (1320 x 800, Retina 2x)
    - src-tauri/icons/dmg-background.png    (660 x 400, 1x)
    - src-tauri/icons/dmg-background.tiff   (Retina multi-resolution TIFF)
  Windows NSIS:
    - src-tauri/icons/nsis-sidebar.bmp      (164 x 314, 24-bit BMP)
    - src-tauri/icons/nsis-sidebar.png      (164 x 314, PNG)
    - src-tauri/icons/nsis-header.bmp       (150 x 57, 24-bit BMP)
    - src-tauri/icons/nsis-header.png       (150 x 57, PNG)
    - src-tauri/icons/installer-banner.png  (1320 x 800, PNG)
"""

import os
import subprocess
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SRC_IMG_PATH = "/Users/sayansenapati/.gemini/antigravity/brain/c03d469b-9d29-4704-a510-4bec50e00d8b/.user_uploaded/media_1794635819719_cd719daa.jpg"
OFFICIAL_LOGO_PATH = "/Volumes/MacSSD/Opensource/teledrvie/teledrive/public/teledrive.png"
OUTPUT_ICONS_DIR = "/Volumes/MacSSD/Opensource/teledrvie/teledrive/src-tauri/icons"
ARTIFACT_DIR = "/Users/sayansenapati/.gemini/antigravity/brain/c03d469b-9d29-4704-a510-4bec50e00d8b"

W_2X = 1320
H_2X = 800
W_1X = 660
H_1X = 400

def create_master_background():
    # 1. Load base user artwork and upscale to Retina 1320x800
    orig = Image.open(SRC_IMG_PATH).convert("RGBA")
    master = orig.resize((W_2X, H_2X), Image.Resampling.LANCZOS)

    # 2. Render razor-sharp replacement badge at 4x for ultimate Retina anti-aliasing
    SCALE = 4
    S = 120 * SCALE          # 480 px
    R_OUTER = 32 * SCALE     # Outer squircle radius
    BADGE_W = 88 * SCALE     # Inner white badge width
    R_INNER = 22 * SCALE     # Inner badge radius
    LOGO_W = 76 * SCALE      # Official logo width

    badge_hi = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    draw = ImageDraw.Draw(badge_hi)

    # Outer glass bezel with translucent dark navy fill & cyan glow border
    pad = (S - 112 * SCALE) // 2
    draw.rounded_rectangle(
        [pad, pad, S - pad, S - pad],
        radius=R_OUTER,
        fill=(8, 22, 52, 255),
        outline=(56, 189, 248, 175),
        width=3 * SCALE
    )

    # Inner crisp white squircle badge
    inner_pad = (S - BADGE_W) // 2
    draw.rounded_rectangle(
        [inner_pad, inner_pad, S - inner_pad, S - inner_pad],
        radius=R_INNER,
        fill=(255, 255, 255, 255)
    )

    # Composite authentic official TeleDrive logo
    official = Image.open(OFFICIAL_LOGO_PATH).convert("RGBA")
    logo_hi = official.resize((LOGO_W, LOGO_W), Image.Resampling.LANCZOS)
    logo_pad = (S - LOGO_W) // 2
    badge_hi.paste(logo_hi, (logo_pad, logo_pad), logo_hi)

    # Downsample badge to 1x target resolution (120x120)
    badge_target = badge_hi.resize((120, 120), Image.Resampling.LANCZOS)

    # 3. Ambient cyan glow layer behind the badge
    glow = Image.new("RGBA", (170, 170), (0, 0, 0, 0))
    g_draw = ImageDraw.Draw(glow)
    g_draw.rounded_rectangle([25, 25, 145, 145], radius=38, fill=(56, 189, 248, 90))
    glow = glow.filter(ImageFilter.GaussianBlur(14))

    # Paste badge onto glow
    glow_offset = (170 - 120) // 2
    glow.paste(badge_target, (glow_offset, glow_offset), badge_target)

    # 4. Composite over master at exact center: (457, 145)
    cx, cy = 457, 145
    pos_x = cx - glow.width // 2
    pos_y = cy - glow.height // 2

    master.paste(glow, (pos_x, pos_y), glow)
    return master

def export_all():
    os.makedirs(OUTPUT_ICONS_DIR, exist_ok=True)
    os.makedirs(ARTIFACT_DIR, exist_ok=True)

    print("Building master 1320x800 background with official TeleDrive logo...")
    master_2x = create_master_background()

    # ── macOS DMG Assets ──────────────────────────────────────────────────────
    path_dmg_2x = os.path.join(OUTPUT_ICONS_DIR, "dmg-background@2x.png")
    master_2x.save(path_dmg_2x, "PNG", optimize=True)
    master_2x.save(os.path.join(ARTIFACT_DIR, "dmg-background@2x.png"), "PNG")
    print(f"✓ Saved: {path_dmg_2x} (1320x800)")

    master_1x = master_2x.resize((W_1X, H_1X), Image.Resampling.LANCZOS)
    path_dmg_1x = os.path.join(OUTPUT_ICONS_DIR, "dmg-background.png")
    master_1x.save(path_dmg_1x, "PNG", optimize=True)
    master_1x.save(os.path.join(ARTIFACT_DIR, "dmg-background.png"), "PNG")
    print(f"✓ Saved: {path_dmg_1x} (660x400)")

    # Multi-resolution TIFF for Retina macOS Finder
    path_dmg_tiff = os.path.join(OUTPUT_ICONS_DIR, "dmg-background.tiff")
    try:
        cmd = ["tiffutil", "-cathidpicheck", path_dmg_1x, path_dmg_2x, "-out", path_dmg_tiff]
        subprocess.run(cmd, check=True)
        subprocess.run(["cp", path_dmg_tiff, os.path.join(ARTIFACT_DIR, "dmg-background.tiff")], check=True)
        print(f"✓ Saved: {path_dmg_tiff} (Retina TIFF)")
    except Exception as e:
        print(f"Notice (tiffutil): {e}")

    # General Banner
    path_banner = os.path.join(OUTPUT_ICONS_DIR, "installer-banner.png")
    master_2x.save(path_banner, "PNG", optimize=True)
    master_2x.save(os.path.join(ARTIFACT_DIR, "installer-banner.png"), "PNG")
    print(f"✓ Saved: {path_banner} (1320x800)")

    # ── Windows NSIS Assets ───────────────────────────────────────────────────
    # 1. NSIS Sidebar (164 x 314) for Welcome & Finish Pages
    # Crop artistic left portion of the glowing cloudscape with the official logo badge
    sidebar_w, sidebar_h = 164, 314
    sidebar = Image.new("RGBA", (sidebar_w, sidebar_h), (5, 12, 28, 255))

    # Crop cloudscape background
    bg_slice = master_2x.crop((40, 20, 680, 780)).resize((sidebar_w, sidebar_h), Image.Resampling.LANCZOS)
    sidebar.paste(bg_slice, (0, 0))

    # Add dark vignette overlay to ensure text readability if needed
    overlay = Image.new("RGBA", (sidebar_w, sidebar_h), (0, 0, 0, 0))
    o_draw = ImageDraw.Draw(overlay)
    o_draw.rectangle([0, 0, sidebar_w, sidebar_h], fill=(2, 8, 20, 45))
    sidebar = Image.alpha_composite(sidebar, overlay)

    # Place official logo badge at the top
    official = Image.open(OFFICIAL_LOGO_PATH).convert("RGBA")
    sb_badge_size = 56
    sb_logo = official.resize((sb_badge_size, sb_badge_size), Image.Resampling.LANCZOS)
    sb_badge = Image.new("RGBA", (sb_badge_size + 8, sb_badge_size + 8), (0, 0, 0, 0))
    sb_draw = ImageDraw.Draw(sb_badge)
    sb_draw.rounded_rectangle([0, 0, sb_badge_size + 8, sb_badge_size + 8], radius=16, fill=(255, 255, 255, 240), outline=(56, 189, 248, 180), width=2)
    sb_badge.paste(sb_logo, (4, 4), sb_logo)
    sidebar.paste(sb_badge, (sidebar_w // 2 - sb_badge.width // 2, 28), sb_badge)

    # Save NSIS Sidebar as BMP (24-bit RGB) and PNG
    sidebar_rgb = sidebar.convert("RGB")
    path_sb_bmp = os.path.join(OUTPUT_ICONS_DIR, "nsis-sidebar.bmp")
    path_sb_png = os.path.join(OUTPUT_ICONS_DIR, "nsis-sidebar.png")
    sidebar_rgb.save(path_sb_bmp, "BMP")
    sidebar.save(path_sb_png, "PNG")
    sidebar_rgb.save(os.path.join(ARTIFACT_DIR, "nsis-sidebar.bmp"), "BMP")
    sidebar.save(os.path.join(ARTIFACT_DIR, "nsis-sidebar.png"), "PNG")
    print(f"✓ Saved: {path_sb_bmp} (164x314 BMP)")

    # 2. NSIS Header (150 x 57) for inner installer pages
    header_w, header_h = 150, 57
    hdr = Image.new("RGBA", (header_w, header_h), (6, 16, 36, 255))
    hdr_bg = master_2x.crop((200, 40, 700, 230)).resize((header_w, header_h), Image.Resampling.LANCZOS)
    hdr.paste(hdr_bg, (0, 0))

    # Add small badge on right
    hdr_badge_size = 40
    hdr_logo = official.resize((hdr_badge_size, hdr_badge_size), Image.Resampling.LANCZOS)
    hdr_badge = Image.new("RGBA", (hdr_badge_size + 4, hdr_badge_size + 4), (0, 0, 0, 0))
    hdr_draw = ImageDraw.Draw(hdr_badge)
    hdr_draw.rounded_rectangle([0, 0, hdr_badge_size + 4, hdr_badge_size + 4], radius=10, fill=(255, 255, 255, 240), outline=(56, 189, 248, 160), width=1)
    hdr_badge.paste(hdr_logo, (2, 2), hdr_logo)
    hdr.paste(hdr_badge, (header_w - hdr_badge.width - 8, (header_h - hdr_badge.height) // 2), hdr_badge)

    # Save NSIS Header as BMP (24-bit RGB) and PNG
    hdr_rgb = hdr.convert("RGB")
    path_hdr_bmp = os.path.join(OUTPUT_ICONS_DIR, "nsis-header.bmp")
    path_hdr_png = os.path.join(OUTPUT_ICONS_DIR, "nsis-header.png")
    hdr_rgb.save(path_hdr_bmp, "BMP")
    hdr.save(path_hdr_png, "PNG")
    hdr_rgb.save(os.path.join(ARTIFACT_DIR, "nsis-header.bmp"), "BMP")
    hdr.save(os.path.join(ARTIFACT_DIR, "nsis-header.png"), "PNG")
    print(f"✓ Saved: {path_hdr_bmp} (150x57 BMP)")

    print("\nAll installer assets successfully exported across macOS and Windows formats!")

if __name__ == "__main__":
    export_all()
