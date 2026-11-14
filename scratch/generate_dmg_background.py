#!/usr/bin/env python3
"""
Generate a high-resolution, Retina-ready DMG background image for TeleDrive.
Matches the aesthetic of modern macOS DMGs with:
  - Deep midnight / space-slate gradient with soft ambient blue glows
  - Centered TeleDrive logo badge and bold typography
  - Subtitle tagline: "Fast, unlimited cloud storage powered by Telegram"
  - Elegant curved dashed directional arrow pointing to Applications
  - Subtle drop-zone target pedestals (with proper alpha blending)
  - Footer installation hint
"""

import math
import os
import subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter

# ── Logical Dimensions ───────────────────────────────────────────────────────
WIDTH_1X = 660
HEIGHT_1X = 400
SCALE = 2
WIDTH = WIDTH_1X * SCALE   # 1320
HEIGHT = HEIGHT_1X * SCALE # 800

# Icon Centers in 1x points (macOS Finder will place icons here)
APP_CENTER_1X = (175, 225)
FOLDER_CENTER_1X = (485, 225)

# Icon Centers in 2x pixels
APP_X, APP_Y = APP_CENTER_1X[0] * SCALE, APP_CENTER_1X[1] * SCALE
FOLDER_X, FOLDER_Y = FOLDER_CENTER_1X[0] * SCALE, FOLDER_CENTER_1X[1] * SCALE

def create_background():
    # Base gradient image
    base = Image.new("RGBA", (WIDTH, HEIGHT), (10, 15, 26, 255))
    draw = ImageDraw.Draw(base)

    # Vertical gradient: #0b1120 -> #050811
    for y in range(HEIGHT):
        ratio = y / HEIGHT
        r = int(12 * (1 - ratio) + 5 * ratio)
        g = int(20 * (1 - ratio) + 8 * ratio)
        b = int(38 * (1 - ratio) + 16 * ratio)
        draw.line([(0, y), (WIDTH, y)], fill=(r, g, b, 255))

    # Glow layer
    glow = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)

    # Center ambient blue glow
    cx, cy = WIDTH // 2, int(HEIGHT * 0.48)
    for r in range(500, 0, -10):
        alpha = int(32 * (1 - r / 500) ** 1.8)
        glow_draw.ellipse(
            [cx - r, cy - int(r * 0.6), cx + r, cy + int(r * 0.6)],
            fill=(11, 87, 208, alpha)
        )

    # App icon landing spotlight (Telegram Cyan)
    for r in range(160, 0, -8):
        alpha = int(25 * (1 - r / 160) ** 2)
        glow_draw.ellipse(
            [APP_X - r, APP_Y - r, APP_X + r, APP_Y + r],
            fill=(56, 189, 248, alpha)
        )

    # Applications folder landing spotlight (Google Drive Blue)
    for r in range(160, 0, -8):
        alpha = int(25 * (1 - r / 160) ** 2)
        glow_draw.ellipse(
            [FOLDER_X - r, FOLDER_Y - r, FOLDER_X + r, FOLDER_Y + r],
            fill=(37, 99, 235, alpha)
        )

    base = Image.alpha_composite(base, glow)

    # Subtle drop pedestals (alpha blended)
    pedestals = Image.new("RGBA", (WIDTH, HEIGHT), (0, 0, 0, 0))
    p_draw = ImageDraw.Draw(pedestals)

    for px, py in [(APP_X, APP_Y), (FOLDER_X, FOLDER_Y)]:
        w, h = 180, 180
        # Soft translucent background
        p_draw.rounded_rectangle(
            [px - w // 2, py - h // 2, px + w // 2, py + h // 2],
            radius=40,
            fill=(255, 255, 255, 10),
            outline=(255, 255, 255, 30),
            width=2
        )
        # Inner dashed-style accent ring
        iw, ih = 156, 156
        p_draw.rounded_rectangle(
            [px - iw // 2, py - ih // 2, px + iw // 2, py + ih // 2],
            radius=32,
            outline=(56, 189, 248, 20),
            width=1
        )

    base = Image.alpha_composite(base, pedestals)
    return base

def draw_dashed_curved_arrow(draw, start_x, end_x, center_y):
    """Draw an elegant dashed curved arrow matching Consynki / modern macOS style."""
    num_dashes = 14
    dash_length = 0.55  # fraction of each period that is drawn

    points = []
    total_steps = 200
    for i in range(total_steps + 1):
        t = i / total_steps
        px = start_x + (end_x - start_x) * t
        # Graceful arc dipping upward then toward Applications
        py = (center_y - 12) - 42 * math.sin(t * math.pi)
        points.append((px, py))

    # Draw dashed segments with gradient
    step_per_dash = total_steps / num_dashes
    for d in range(num_dashes):
        start_step = int(d * step_per_dash)
        end_step = int((d + dash_length) * step_per_dash)
        for i in range(start_step, min(end_step, len(points) - 1)):
            t = i / len(points)
            r = int(56 * (1 - t) + 147 * t)
            g = int(189 * (1 - t) + 197 * t)
            b = int(248 * (1 - t) + 253 * t)
            draw.line([points[i], points[i + 1]], fill=(r, g, b, 240), width=5)

    # Arrowhead at end_x
    last_pt = points[-1]
    prev_pt = points[-8]
    angle = math.atan2(last_pt[1] - prev_pt[1], last_pt[0] - prev_pt[0])

    head_len = 26
    head_width = 16

    tip = last_pt
    left_wing = (
        tip[0] - head_len * math.cos(angle - 0.5),
        tip[1] - head_len * math.sin(angle - 0.5)
    )
    notch = (
        tip[0] - (head_len - 8) * math.cos(angle),
        tip[1] - (head_len - 8) * math.sin(angle)
    )
    right_wing = (
        tip[0] - head_len * math.cos(angle + 0.5),
        tip[1] - head_len * math.sin(angle + 0.5)
    )

    draw.polygon([tip, left_wing, notch, right_wing], fill=(147, 197, 253, 255))
    draw.line([tip, left_wing, notch, right_wing, tip], fill=(255, 255, 255, 240), width=2)

def generate(output_dir):
    os.makedirs(output_dir, exist_ok=True)
    img = create_background()
    draw = ImageDraw.Draw(img)

    # Fonts
    try:
        font_title = ImageFont.truetype("/System/Library/Fonts/HelveticaNeue.ttc", 58, index=1)
        font_subtitle = ImageFont.truetype("/System/Library/Fonts/HelveticaNeue.ttc", 26, index=0)
        font_pill = ImageFont.truetype("/System/Library/Fonts/HelveticaNeue.ttc", 22, index=1)
        font_footer = ImageFont.truetype("/System/Library/Fonts/HelveticaNeue.ttc", 22, index=0)
    except Exception:
        font_title = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 58)
        font_subtitle = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 26)
        font_pill = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 22)
        font_footer = ImageFont.truetype("/System/Library/Fonts/SFNS.ttf", 22)

    # ── Centered Header ──────────────────────────────────────────────────────
    # Load TeleDrive icon
    icon_path = "/Volumes/MacSSD/Opensource/teledrvie/teledrive/public/teledrive.png"
    icon_size = 90
    if os.path.exists(icon_path):
        app_icon = Image.open(icon_path).convert("RGBA")
        app_icon = app_icon.resize((icon_size, icon_size), Image.Resampling.LANCZOS)
        
        mask = Image.new("L", (icon_size, icon_size), 0)
        mask_draw = ImageDraw.Draw(mask)
        mask_draw.rounded_rectangle([0, 0, icon_size, icon_size], radius=20, fill=255)
        
        # Calculate centered header layout: [Icon]  TELEDRIVE
        title_bbox = draw.textbbox((0, 0), "TELEDRIVE", font=font_title)
        title_w = title_bbox[2] - title_bbox[0]
        title_h = title_bbox[3] - title_bbox[1]

        total_header_w = icon_size + 24 + title_w
        start_x = (WIDTH - total_header_w) // 2
        header_y = 52

        icon_x = start_x
        icon_y = header_y
        img.paste(app_icon, (icon_x, icon_y), mask)

        # Icon glowing outline
        draw.rounded_rectangle(
            [icon_x, icon_y, icon_x + icon_size, icon_y + icon_size],
            radius=20,
            outline=(56, 189, 248, 70),
            width=2
        )

        title_x = icon_x + icon_size + 24
        title_y = header_y + (icon_size - title_h) // 2 - 8
        draw.text((title_x, title_y), "TELEDRIVE", font=font_title, fill=(255, 255, 255, 255))
    else:
        title_bbox = draw.textbbox((0, 0), "TELEDRIVE", font=font_title)
        title_w = title_bbox[2] - title_bbox[0]
        draw.text(((WIDTH - title_w) // 2, 60), "TELEDRIVE", font=font_title, fill=(255, 255, 255, 255))

    # Centered Tagline Subtitle
    subtitle_text = "Fast, unlimited cloud storage powered by Telegram"
    sub_bbox = draw.textbbox((0, 0), subtitle_text, font=font_subtitle)
    sub_w = sub_bbox[2] - sub_bbox[0]
    draw.text(((WIDTH - sub_w) // 2, 160), subtitle_text, font=font_subtitle, fill=(148, 163, 184, 255))

    # ── Center Directional Arrow & Pill ──────────────────────────────────────
    arrow_start = APP_X + 115
    arrow_end = FOLDER_X - 115
    draw_dashed_curved_arrow(draw, arrow_start, arrow_end, APP_Y)

    # "Drag to Install" Pill
    pill_text = "Drag to Applications"
    pill_bbox = draw.textbbox((0, 0), pill_text, font=font_pill)
    pill_w = pill_bbox[2] - pill_bbox[0] + 36
    pill_h = pill_bbox[3] - pill_bbox[1] + 18
    pill_x = (WIDTH - pill_w) // 2
    pill_y = APP_Y + 54

    # Frosted pill background
    draw.rounded_rectangle(
        [pill_x, pill_y, pill_x + pill_w, pill_y + pill_h],
        radius=14,
        fill=(15, 23, 42, 230),
        outline=(56, 189, 248, 90),
        width=2
    )
    draw.text(
        (pill_x + 18, pill_y + 8),
        pill_text,
        font=font_pill,
        fill=(224, 242, 254, 255)
    )

    # ── Bottom Footer ────────────────────────────────────────────────────────
    footer_text = "Universal Binary  •  Apple Silicon & Intel  •  macOS 10.15+"
    f_bbox = draw.textbbox((0, 0), footer_text, font=font_footer)
    f_w = f_bbox[2] - f_bbox[0]
    draw.text(((WIDTH - f_w) // 2, HEIGHT - 52), footer_text, font=font_footer, fill=(100, 116, 139, 230))

    # ── 1. Save 2x Retina PNG (1320 x 800) ───────────────────────────────────
    path_2x = os.path.join(output_dir, "dmg-background@2x.png")
    img.save(path_2x, "PNG", optimize=True)
    print("Saved 2x image:", path_2x)

    # ── 2. Downsample to 1x PNG (660 x 400) ──────────────────────────────────
    img_1x = img.resize((WIDTH_1X, HEIGHT_1X), Image.Resampling.LANCZOS)
    path_1x = os.path.join(output_dir, "dmg-background.png")
    img_1x.save(path_1x, "PNG", optimize=True)
    print("Saved 1x image:", path_1x)

    # ── 3. Combine into multi-resolution TIFF via tiffutil ────────────────────
    path_tiff = os.path.join(output_dir, "dmg-background.tiff")
    try:
        cmd = ["tiffutil", "-cathidpicheck", path_1x, path_2x, "-out", path_tiff]
        subprocess.run(cmd, check=True)
        print("Generated Retina multi-resolution TIFF:", path_tiff)
    except Exception as e:
        print("tiffutil error (non-fatal):", e)

    return path_1x, path_2x, path_tiff

if __name__ == "__main__":
    generate("/Volumes/MacSSD/Opensource/teledrvie/teledrive/src-tauri/icons")
