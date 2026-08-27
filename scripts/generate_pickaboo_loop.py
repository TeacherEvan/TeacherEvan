"""
PickaBoo Engine v3.0 — Dark Academia Edition
Theme:    gold / crimson / deep indigo / parchment
Animation: Colorful firework burst with trailing sparks on 4s self-destruct
Width: 900 x 280 px | FPS: 25 | Duration: 6s seamless loop
"""

import math, os, random, subprocess
from PIL import Image, ImageDraw, ImageFont

# ── Config ─────────────────────────────────────────────────────────────────────
W, H       = 900, 280
FPS        = 25
DURATION   = 6.0
N_FRAMES   = int(FPS * DURATION)
FRAMES_DIR = "/tmp/pb3_frames"
os.makedirs(FRAMES_DIR, exist_ok=True)

# ── Fonts ──────────────────────────────────────────────────────────────────────
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
REG  = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
f_badge = ImageFont.truetype(BOLD, 12)
f_hud   = ImageFont.truetype(BOLD, 13)
f_boom  = ImageFont.truetype(BOLD, 30)
f_tiny  = ImageFont.truetype(REG,  10)

# ── Dark Academia Palette ──────────────────────────────────────────────────────
BG        = (14, 12, 22)        # near-black indigo
SURFACE   = (26, 22, 42)        # deep slate
BORDER    = (62, 52, 88)        # muted violet
GOLD      = (212, 175,  55)     # antique gold
CRIMSON   = (185,  26,  53)     # deep crimson
AMBER     = (255, 160,   0)     # warm amber
INDIGO    = ( 90,  72, 180)     # rich indigo
PARCHMENT = (245, 230, 180)     # warm parchment / off-white
IVORY     = (255, 248, 220)
GREEN_DIM = ( 52, 160,  80)     # muted sage
ROSE      = (220,  60, 110)

# Firework palette — colorful & celebratory
FW_COLORS = [
    (255, 215,   0),   # gold
    (220,  20,  60),   # crimson
    (148, 103, 189),   # violet
    ( 46, 204, 113),   # emerald
    (231,  76,  60),   # tomato
    (255, 140,   0),   # dark orange
    ( 52, 152, 219),   # steel blue
    (255, 200, 100),   # light gold
    (255, 100, 150),   # rose
    (200, 230, 255),   # ice
]

random.seed(42)

# ── Physics particles (pre-seeded) ─────────────────────────────────────────────
N_PARTICLES = 140
particles = []
for _ in range(N_PARTICLES):
    angle = random.uniform(0, 2*math.pi)
    speed = random.uniform(70, 440)
    size  = random.uniform(3, 9)
    col   = random.choice(FW_COLORS)
    trail = random.randint(3, 8)
    shape = random.choice(["circle","star","spark","ring"])
    particles.append(dict(angle=angle, speed=speed, size=size,
                           color=col, trail=trail, shape=shape))

# ── Cursor path (smooth figure-8 Lissajous) ───────────────────────────────────
def cursor(t):
    a = (t / DURATION) * 2*math.pi
    cx = W/2 + 240*math.sin(a)
    cy = H/2 +  50*math.sin(2*a) + 10
    return cx, cy

# ── Timeline ──────────────────────────────────────────────────────────────────
#  0.0 – 0.6  : sprite peacefully chases cursor
#  0.6 – 3.4  : contact → 4-second countdown w/ pulse + dashed leash
#  3.4 – 4.6  : FIREWORK explosion (burst + trails + sparks + BANG text)
#  4.6 – 6.0  : debris settles, baby sprite respawns → seamless loop
T_CONTACT = 0.6
T_EXPLODE = 3.4
T_END     = 6.0

# ── Helper drawing routines ────────────────────────────────────────────────────
def draw_star(d, x, y, r, col):
    pts = []
    for i in range(10):
        radius = r if i%2==0 else r*0.45
        a = i*math.pi/5 - math.pi/2
        pts.append((x + radius*math.cos(a), y + radius*math.sin(a)))
    d.polygon(pts, fill=col)

def draw_sparkle(d, x, y, r, col):
    for i in range(4):
        a = i*math.pi/2
        x1, y1 = x + r*math.cos(a), y + r*math.sin(a)
        x2, y2 = x - r*math.cos(a), y - r*math.sin(a)
        d.line([(x1,y1),(x2,y2)], fill=col, width=2)

def glow_rect(d, x0, y0, x1, y1, r, fill, border, bw=1):
    d.rounded_rectangle([x0,y0,x1,y1], radius=r, fill=fill, outline=border, width=bw)

# ── PickaBoo character ─────────────────────────────────────────────────────────
def draw_ghost(d, cx, cy, size, col, mood="happy", jitter=0, pulse=0):
    jx = (random.random()-0.5)*jitter
    jy = (random.random()-0.5)*jitter
    cx, cy = cx+jx, cy+jy
    s = size

    # Outer glow layers
    for gl, alpha in [(1.80, 30), (1.45, 55), (1.15, 80)]:
        gc = tuple(min(255, int(c*0.6)) for c in col) + (alpha,)
        tmp = Image.new("RGBA", (W, H), (0,0,0,0))
        td  = ImageDraw.Draw(tmp)
        r = s*gl
        td.ellipse([cx-r, cy-r, cx+r, cy+r], fill=gc)
        d._image.alpha_composite(tmp)

    # Body: dome + rectangle
    d.pieslice([cx-s, cy-s, cx+s, cy], 180, 360, fill=col)
    d.rectangle([cx-s, cy, cx+s, cy+s*0.68], fill=col)

    # Wavy tentacles (3)
    w = (s*2)/3
    for i in range(3):
        fx = cx - s + i*w
        d.ellipse([fx, cy+s*0.40, fx+w, cy+s*0.92], fill=col)

    # Antenna stalk + orb
    d.line([(cx, cy-s), (cx, cy-s-8)], fill=IVORY, width=2)
    d.ellipse([cx-4, cy-s-13, cx+4, cy-s-5], fill=GOLD, outline=IVORY, width=1)

    # Face
    ex, ey = s*0.40, cy - s*0.10
    er = max(2.5, s*0.20)

    if mood == "alarm":
        # Wide white shock eyes + O-mouth
        for sign in (-1, 1):
            d.ellipse([cx+sign*ex-er*1.4, ey-er*1.4, cx+sign*ex+er*1.4, ey+er*1.4], fill=IVORY)
            d.ellipse([cx+sign*ex-1.5, ey-1.5, cx+sign*ex+1.5, ey+1.5], fill=(10,8,20))
        d.ellipse([cx-4, cy+s*0.24, cx+4, cy+s*0.46], fill=(10,8,20))
        # Sweat drop
        d.polygon([(cx+s*0.80, cy-s*0.50),
                   (cx+s*0.70, cy-s*0.20),
                   (cx+s*0.90, cy-s*0.20)], fill=(100,180,255))
        d.ellipse([cx+s*0.70, cy-s*0.28, cx+s*0.90, cy-s*0.08], fill=(100,180,255))
    elif mood == "happy":
        for sign in (-1, 1):
            d.arc([cx+sign*ex-er, ey-er, cx+sign*ex+er, ey+er], 180, 360, fill=(10,8,20), width=3)
            d.ellipse([cx+sign*ex-3, ey+4, cx+sign*ex+3, ey+9], fill=ROSE)
        d.arc([cx-5, cy+s*0.18, cx+5, cy+s*0.40], 0, 180, fill=(10,8,20), width=3)
    else:
        for sign in (-1, 1):
            d.ellipse([cx+sign*ex-er, ey-er, cx+sign*ex+er, ey+er], fill=(10,8,20))
            d.ellipse([cx+sign*ex-1.8, ey-er+1, cx+sign*ex+0.5, ey-1], fill=IVORY)
            d.ellipse([cx+sign*ex-3, ey+4, cx+sign*ex+3, ey+9], fill=ROSE)
        d.arc([cx-4, cy+s*0.18, cx+4, cy+s*0.38], 0, 180, fill=(10,8,20), width=2)

def draw_cursor(d, x, y, pulse=0.0):
    # Animated crosshair reticle
    r = 12 + pulse*5
    d.ellipse([x-r, y-r, x+r, y+r], outline=GOLD, width=1)
    d.line([(x-r-4, y), (x-4, y)], fill=GOLD, width=1)
    d.line([(x+4,   y), (x+r+4, y)], fill=GOLD, width=1)
    d.line([(x, y-r-4), (x, y-4)], fill=GOLD, width=1)
    d.line([(x, y+4), (x, y+r+4)], fill=GOLD, width=1)
    if pulse > 0.3:
        r2 = r*2.0
        d.ellipse([x-r2, y-r2, x+r2, y+r2], outline=CRIMSON, width=1)

# ── Render ─────────────────────────────────────────────────────────────────────
print("Rendering PickaBoo v3 — Dark Academia Edition...")

lx, ly = W*0.28, H*0.52  # Lead sprite position (mutable)

for fi in range(N_FRAMES):
    t = fi / FPS
    img = Image.new("RGBA", (W, H), BG)
    d   = ImageDraw.Draw(img)
    d._image = img   # for alpha_composite in glow helper

    # ── 1. Decorative background ──────────────────────────────────────────────
    # Dot grid
    for gx in range(22, W, 34):
        for gy in range(22, H, 34):
            d.rectangle([gx, gy, gx+1, gy+1], fill=(28, 24, 44))

    # Floating academic motifs (subtle) — small book & quill shapes
    book_a = 0.6*math.sin(t*1.2 + 0.5)
    d.line([(52, 70+book_a), (52, 90+book_a)], fill=(62,52,88), width=2)
    d.line([(52, 70+book_a), (70, 70+book_a)], fill=(62,52,88), width=2)
    d.line([(70, 70+book_a), (70, 90+book_a)], fill=(62,52,88), width=2)
    d.line([(52, 90+book_a), (70, 90+book_a)], fill=(62,52,88), width=2)
    for r in range(3):
        d.line([(55, 74+book_a+r*5), (67, 74+book_a+r*5)], fill=(62,52,88), width=1)

    # ── 2. Outer container card ───────────────────────────────────────────────
    glow_rect(d, 10, 10, W-10, H-10, 14, None, BORDER, 1)

    # ── 3. Header badges ──────────────────────────────────────────────────────
    glow_rect(d, 22, 20, 230, 48, 8, SURFACE, BORDER, 1)
    d.ellipse([32,30,42,40], fill=GREEN_DIM)
    d.text((50, 27), "PICKABOO ENGINE  v3.0", fill=PARCHMENT, font=f_badge)

    glow_rect(d, W-258, 20, W-22, 48, 8, SURFACE, BORDER, 1)
    d.ellipse([W-246, 30, W-236, 40], fill=GOLD)
    d.text((W-228, 27), "DARK ACADEMIA  ·  4s LOOP", fill=PARCHMENT, font=f_badge)

    # ── 4. Ambient roaming sprites ────────────────────────────────────────────
    roamers = [
        (160, 150, 0.0, INDIGO,  16),
        (W-160, 140, 1.8, CRIMSON, 15),
        (W-120, 210, 3.1, AMBER,   14),
        (110,   230, 4.4, (130,100,200), 13),
        (W//2,  240, 5.6, (80, 140, 90), 13),
    ]
    for rx, ry, ph, rcol, rsize in roamers:
        fx = rx + math.cos(t*2.1+ph)*11
        fy = ry + math.sin(t*3.2+ph)*12
        draw_ghost(d, fx, fy, rsize, rcol, mood="happy")

    # ── 5. Cursor ─────────────────────────────────────────────────────────────
    cx, cy = cursor(t)

    # ── 6. Lead PickaBoo state machine ───────────────────────────────────────
    if t < T_EXPLODE:
        # Smooth pursuit
        lx += (cx - lx)*0.12
        ly += (cy - ly)*0.12

        in_countdown = t >= T_CONTACT

        if in_countdown:
            progress  = (t - T_CONTACT) / (T_EXPLODE - T_CONTACT)  # 0→1
            time_left = 4.0*(1.0 - progress)
            jitter    = progress**2 * 14
            pulse     = math.sin(t*(8 + progress*18))*0.5 + 0.5

            # Color: indigo → amber → crimson
            if time_left > 2.6:
                sc = INDIGO
            elif time_left > 1.2:
                sc = AMBER
            else:
                sc = CRIMSON

            # Dashed magnetic leash to cursor
            leash_len = math.hypot(cx-lx, cy-ly)
            if leash_len > 1:
                steps = int(leash_len/10)
                for si in range(steps):
                    if si%2==0:
                        frac = si/max(steps,1)
                        px_ = lx + (cx-lx)*frac
                        py_ = ly + (cy-ly)*frac
                        d.ellipse([px_-2, py_-2, px_+2, py_+2], fill=sc)

            draw_ghost(d, lx, ly, 25, sc, mood="alarm", jitter=jitter, pulse=pulse)

            # Countdown HUD
            hw, hh = 160, 28
            hx = lx - hw/2
            hy = ly - 62
            glow_rect(d, hx, hy, hx+hw, hy+hh, 7, (10,8,22), sc, 2)
            d.ellipse([hx+10, hy+9, hx+20, hy+19], fill=sc)
            d.text((hx+26, hy+6), f"DETONATE: {time_left:4.2f}s", fill=IVORY, font=f_hud)

            draw_cursor(d, cx, cy, pulse=pulse)
        else:
            draw_ghost(d, lx, ly, 25, INDIGO, mood="happy")
            draw_cursor(d, cx, cy, pulse=0.0)

    else:
        # FIREWORK DETONATION PHASE ─────────────────────────────────────────
        exp_t    = t - T_EXPLODE
        exp_end  = T_END - T_EXPLODE          # 1.6 s detonation window
        exp_norm = min(1.0, exp_t / exp_end)  # 0→1

        draw_cursor(d, cx, cy, pulse=0.0)

        # ── Shockwave rings (expand & fade)
        for ring_r, ring_col, ring_max in [
            (exp_norm*350, GOLD,    350),
            (exp_norm*220, CRIMSON, 220),
            (exp_norm*130, INDIGO,  130),
        ]:
            alpha = max(0, int((1 - ring_r/ring_max)*200))
            if alpha > 10:
                tmp = Image.new("RGBA", (W, H), (0,0,0,0))
                td  = ImageDraw.Draw(tmp)
                td.ellipse([lx-ring_r, ly-ring_r, lx+ring_r, ly+ring_r],
                            outline=ring_col+(alpha,), width=3)
                img.alpha_composite(tmp)

        # ── Firework particle burst with trails
        for p in particles:
            dist = p["speed"] * (exp_norm**0.60)
            px   = lx + math.cos(p["angle"])*dist
            py   = ly + math.sin(p["angle"])*dist + exp_norm*38  # gravity

            # Alpha fade-out in second half
            fade = max(0.0, 1.0 - exp_norm*0.85)
            if fade < 0.05:
                continue

            ps = max(1.5, p["size"]*(1 - exp_norm*0.65))
            col = p["color"]

            # Trail (3–6 trailing dots behind each particle)
            for tr in range(p["trail"]):
                t_frac = tr / p["trail"]
                trail_dist = dist * (1 - t_frac*0.35)
                tpx = lx + math.cos(p["angle"])*trail_dist
                tpy = ly + math.sin(p["angle"])*trail_dist + (exp_norm*38)*(1-t_frac*0.4)
                tr_size = max(0.5, ps * (1 - t_frac*0.8))
                tr_alpha = int(fade*200*(1-t_frac))
                if tr_alpha > 10:
                    tmp = Image.new("RGBA", (W, H), (0,0,0,0))
                    td  = ImageDraw.Draw(tmp)
                    td.ellipse([tpx-tr_size, tpy-tr_size, tpx+tr_size, tpy+tr_size],
                                fill=col+(tr_alpha,))
                    img.alpha_composite(tmp)

            # Head particle
            tmp = Image.new("RGBA", (W, H), (0,0,0,0))
            td  = ImageDraw.Draw(tmp)
            alpha = int(fade*255)
            if p["shape"] == "star":
                draw_star(td, px, py, ps, col+(alpha,))
            elif p["shape"] == "ring":
                td.ellipse([px-ps, py-ps, px+ps, py+ps], outline=col+(alpha,), width=2)
            elif p["shape"] == "spark":
                draw_sparkle(td, px, py, ps, col+(alpha,))
            else:
                td.ellipse([px-ps, py-ps, px+ps, py+ps], fill=col+(alpha,))
            img.alpha_composite(tmp)

        # ── BANG! comic banner (appears and fades)
        if exp_norm < 0.65:
            banner_alpha = int((1 - exp_norm/0.65)*230)
            tmp = Image.new("RGBA", (W, H), (0,0,0,0))
            td  = ImageDraw.Draw(tmp)
            bw, bh = 310, 54
            bx, by = lx - bw/2, ly - bh/2 - 10
            td.rounded_rectangle([bx, by, bx+bw, by+bh], radius=10,
                                   fill=(14,10,24,banner_alpha),
                                   outline=GOLD+(banner_alpha,), width=3)
            td.text((bx+20, by+10), "💥  PICKABOO  BANG!  💥",
                    fill=GOLD+(banner_alpha,), font=f_boom)
            img.alpha_composite(tmp)

        # Sparkle crown at explosion center (early frames)
        if exp_norm < 0.30:
            for a in range(0, 360, 45):
                r  = 12 + exp_norm*30
                sx = lx + r*math.cos(math.radians(a))
                sy = ly + r*math.sin(math.radians(a))
                d.ellipse([sx-3, sy-3, sx+3, sy+3], fill=GOLD)

        # ── Seamless respawn (baby ghost grows back in)
        if exp_norm > 0.55:
            rf = (exp_norm - 0.55)/0.45
            lx_r = W*0.28
            ly_r = H*0.52
            lx   = lx + (lx_r - lx)*0.08   # drift back to spawn
            ly   = ly + (ly_r - ly)*0.08
            draw_ghost(d, lx, ly, 25*rf, INDIGO, mood="happy")

    # ── Save frame ───────────────────────────────────────────────────────────
    img.save(os.path.join(FRAMES_DIR, f"frame_{fi:04d}.png"))

print(f"✓ {N_FRAMES} frames rendered. Encoding GIF...")

PALETTE = "/tmp/pb3_palette.png"
OUTPUT  = "assets/pickaboo-loop.gif"

subprocess.run([
    "ffmpeg", "-y", "-framerate", str(FPS),
    "-i", f"{FRAMES_DIR}/frame_%04d.png",
    "-vf", "palettegen=max_colors=256:reserve_transparent=0",
    PALETTE,
], check=True, capture_output=True)

subprocess.run([
    "ffmpeg", "-y", "-framerate", str(FPS),
    "-i", f"{FRAMES_DIR}/frame_%04d.png",
    "-i", PALETTE,
    "-lavfi", "paletteuse=dither=sierra2_4a",
    OUTPUT,
], check=True, capture_output=True)

size_kb = os.path.getsize(OUTPUT) // 1024
print(f"✓ Done! {OUTPUT}  ({size_kb} KB)")
