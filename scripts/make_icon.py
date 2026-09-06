#!/usr/bin/env python3
"""生成 VoxStudio 应用图标：渐变圆角底 + 白色声波。纯标准库实现，无需 PIL。"""
import zlib
import struct
import math
import os

SIZE = 1024


def write_png(path, w, h, buf):
    raw = bytearray()
    stride = w * 4
    for y in range(h):
        raw.append(0)  # filter type 0
        raw += buf[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def lerp(a, b, t):
    return a + (b - a) * t


# 渐变端点：紫 → 蓝，呼应 Apple 的活力配色
TOP = (122, 106, 250)
BOTTOM = (10, 132, 255)

buf = bytearray(SIZE * SIZE * 4)

# 圆角矩形背景（带 2x2 超采样抗锯齿）
radius = 232.0
for y in range(SIZE):
    for x in range(SIZE):
        r = g = b = 0
        a_acc = 0.0
        for sy in range(2):
            for sx in range(2):
                px = x + sx * 0.5 + 0.25
                py = y + sy * 0.5 + 0.25
                # 到圆角矩形的距离场
                dx = max(radius - px, 0.0, px - (SIZE - radius))
                dy = max(radius - py, 0.0, py - (SIZE - radius))
                inside = math.hypot(dx, dy) <= radius
                if not inside:
                    continue
                t = py / SIZE
                r += int(lerp(TOP[0], BOTTOM[0], t))
                g += int(lerp(TOP[1], BOTTOM[1], t))
                b += int(lerp(TOP[2], BOTTOM[2], t))
                a_acc += 255.0
        i = (y * SIZE + x) * 4
        if a_acc > 0:
            buf[i] = min(255, int(r / 4))
            buf[i + 1] = min(255, int(g / 4))
            buf[i + 2] = min(255, int(b / 4))
            buf[i + 3] = int(a_acc / 4)


def draw_rounded_bar(cx, cy, w, h, rad, color):
    """用距离场在背景之上叠加一条圆角竖条"""
    half_w, half_h = w / 2.0, h / 2.0
    x0 = max(0, int(cx - half_w - 2))
    x1 = min(SIZE - 1, int(cx + half_w + 2))
    y0 = max(0, int(cy - half_h - 2))
    y1 = min(SIZE - 1, int(cy + half_h + 2))
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            # 4x4 超采样，边缘更干净
            hits = 0
            for sy in range(4):
                for sx in range(4):
                    px = x + sx * 0.25 + 0.125
                    py = y + sy * 0.25 + 0.125
                    dx = abs(px - cx)
                    dy = abs(py - cy)
                    qx = dx - (half_w - rad)
                    qy = dy - (half_h - rad)
                    if qx <= 0 or qy <= 0:
                        if dx <= half_w and dy <= half_h:
                            hits += 1
                    elif qx * qx + qy * qy <= rad * rad:
                        hits += 1
            if hits == 0:
                continue
            alpha = hits / 16.0
            i = (y * SIZE + x) * 4
            for c in range(3):
                buf[i + c] = int(buf[i + c] * (1 - alpha) + color[c] * alpha)
            buf[i + 3] = min(255, int(buf[i + 3] + 255 * alpha * (buf[i + 3] / 255.0)))


# 声波：五条竖条，中间最高，两侧递减
bars = [0.34, 0.62, 1.0, 0.62, 0.34]
bar_w = 62.0
gap = 46.0
total_w = len(bars) * bar_w + (len(bars) - 1) * gap
start_x = (SIZE - total_w) / 2.0 + bar_w / 2.0
max_h = 300.0
center_y = SIZE / 2.0

WHITE = (255, 255, 255)
for idx, ratio in enumerate(bars):
    h = max_h * ratio
    cx = start_x + idx * (bar_w + gap)
    draw_rounded_bar(cx, center_y, bar_w, h, bar_w / 2.0, WHITE)

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src-tauri", "icons", "icon.png")
out = os.path.abspath(out)
os.makedirs(os.path.dirname(out), exist_ok=True)
write_png(out, SIZE, SIZE, buf)
print("wrote", out)
